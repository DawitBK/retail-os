import { Inject, Injectable } from '@nestjs/common';
import { conflict, notFound, ProblemException, toPage, unprocessable } from '@retail/kit';
import { and, asc, count, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { ACCOUNT, postJournalEntry, type JournalLineInput } from '../accounting/ledger.js';
import { recordAudit } from '../common/audit.js';
import type { Principal } from '../common/auth.js';
import { businessDate } from '../common/time.js';
import { DB, type Database, type Tx } from '../db/db.module.js';
import {
  outboxEvents,
  products,
  stockAuditItems,
  stockAudits,
  type StockAuditRow,
} from '../db/schema.js';
import { applyMovement, averageCost } from '../inventory/inventory.js';
import type {
  AuditDto,
  CreateAudit,
  ListAuditsQuery,
  SubmitCounts,
} from './operations.contract.js';

const SHRINKAGE_ACCOUNT = '6120';

@Injectable()
export class AuditsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** Start a count of a set of products. */
  async start(actor: Principal, input: CreateAudit): Promise<AuditDto> {
    return this.db.transaction(async (tx) => {
      const ids = [...new Set(input.productIds)];
      const found = await tx
        .select({ id: products.id })
        .from(products)
        .where(and(inArray(products.id, ids), isNull(products.deletedAt)));
      if (found.length !== ids.length) {
        throw unprocessable('product-missing', 'A product in the count does not exist');
      }
      const seq = await tx.execute<{ n: string }>(
        sql`select nextval('stock_audit_number_seq') as n`,
      );
      const number = `AUD-${String(seq.rows[0]!.n).padStart(6, '0')}`;
      const [audit] = await tx
        .insert(stockAudits)
        .values({ number, notes: input.notes ?? null, startedBy: actor.userId })
        .returning();
      await tx
        .insert(stockAuditItems)
        .values(ids.map((productId) => ({ auditId: audit!.id, productId })));
      const dto = await this.read(tx, audit!.id);
      await recordAudit(tx, {
        actor: actor.userId,
        action: 'stock-audit.started',
        entityType: 'stock-audit',
        entityId: dto.id,
        after: { number, products: ids.length },
      });
      return dto;
    });
  }

  /**
   * Record what was physically counted. Each count remembers what the system said at that moment
   * (read under a row lock), so the variance is exact even if sales go on during the count.
   */
  async count(actor: Principal, id: string, input: SubmitCounts): Promise<AuditDto> {
    return this.db.transaction(async (tx) => {
      const audit = await this.lock(tx, id);
      if (audit.status !== 'IN_PROGRESS') {
        throw conflict('audit-not-counting', 'This count is no longer open', audit.status);
      }
      const ordered = [...input.counts].sort((a, b) => a.productId.localeCompare(b.productId));
      for (const c of ordered) {
        const [item] = await tx
          .select({ id: stockAuditItems.id })
          .from(stockAuditItems)
          .where(and(eq(stockAuditItems.auditId, id), eq(stockAuditItems.productId, c.productId)));
        if (!item) {
          throw unprocessable(
            'not-in-count',
            'That product is not part of this count',
            c.productId,
          );
        }
        const [product] = await tx
          .select({ stock: products.currentStock })
          .from(products)
          .where(eq(products.id, c.productId))
          .for('update');
        await tx
          .update(stockAuditItems)
          .set({
            systemQty: product!.stock,
            physicalQty: c.physicalQty,
            countedBy: actor.userId,
            countedAt: sql`now()`,
          })
          .where(eq(stockAuditItems.id, item.id));
      }
      return this.read(tx, id);
    });
  }

  async submit(actor: Principal, id: string): Promise<AuditDto> {
    return this.db.transaction(async (tx) => {
      const audit = await this.lock(tx, id);
      if (audit.status !== 'IN_PROGRESS') {
        throw conflict('audit-not-counting', 'This count is no longer open', audit.status);
      }
      const [{ missing } = { missing: 0 }] = await tx
        .select({ missing: count() })
        .from(stockAuditItems)
        .where(and(eq(stockAuditItems.auditId, id), isNull(stockAuditItems.physicalQty)));
      if (missing > 0) {
        throw unprocessable(
          'uncounted-items',
          'Some products have not been counted',
          `${missing} still to count`,
        );
      }
      await tx
        .update(stockAudits)
        .set({
          status: 'PENDING_APPROVAL',
          submittedAt: sql`now()`,
          version: sql`${stockAudits.version} + 1`,
        })
        .where(eq(stockAudits.id, id));
      const dto = await this.read(tx, id);
      await recordAudit(tx, {
        actor: actor.userId,
        action: 'stock-audit.submitted',
        entityType: 'stock-audit',
        entityId: id,
        after: { number: dto.number },
      });
      return dto;
    });
  }

  /**
   * Apply the count: shortages leave stock at cost and overages come in at the average cost, all
   * in one entry against shrinkage. The adjustment is the counted variance, not "set to physical",
   * so sales made since the count are not undone. The starter cannot approve their own count.
   */
  async approve(actor: Principal, id: string): Promise<AuditDto> {
    return this.db.transaction(async (tx) => {
      const audit = await this.lock(tx, id);
      if (audit.status !== 'PENDING_APPROVAL') {
        throw conflict('audit-not-pending', 'Only a submitted count can be approved', audit.status);
      }
      if (audit.startedBy === actor.userId) {
        throw new ProblemException(
          403,
          'self-approval',
          'You cannot approve your own count',
          'Another manager or the owner has to approve it',
        );
      }
      const items = await tx
        .select()
        .from(stockAuditItems)
        .where(eq(stockAuditItems.auditId, id))
        .orderBy(asc(stockAuditItems.productId));
      let net = 0;
      for (const item of items) {
        const variance = (item.physicalQty ?? 0) - (item.systemQty ?? 0);
        let value = 0;
        if (variance < 0) {
          const moved = await applyMovement(tx, {
            productId: item.productId,
            type: 'STOCK_ADJUSTMENT_DECREASE',
            quantity: -variance,
            referenceType: 'STOCK_AUDIT',
            referenceId: id,
            createdBy: actor.userId,
          });
          value = -moved.costMinor;
        } else if (variance > 0) {
          const [p] = await tx
            .select({ stock: products.currentStock, value: products.stockValueMinor })
            .from(products)
            .where(eq(products.id, item.productId))
            .for('update');
          // Found stock is valued at the average cost of what is already there (nothing if none is).
          const scaled = averageCost(p!.value, p!.stock, variance);
          await applyMovement(tx, {
            productId: item.productId,
            type: 'STOCK_ADJUSTMENT_INCREASE',
            quantity: variance,
            totalCostMinor: scaled,
            referenceType: 'STOCK_AUDIT',
            referenceId: id,
            createdBy: actor.userId,
          });
          value = scaled;
        }
        await tx
          .update(stockAuditItems)
          .set({ adjustmentValueMinor: value })
          .where(eq(stockAuditItems.id, item.id));
        net += value;
      }
      if (net !== 0) {
        const lines: JournalLineInput[] =
          net < 0
            ? [
                { accountCode: SHRINKAGE_ACCOUNT, debitMinor: -net },
                { accountCode: ACCOUNT.INVENTORY, creditMinor: -net },
              ]
            : [
                { accountCode: ACCOUNT.INVENTORY, debitMinor: net },
                { accountCode: SHRINKAGE_ACCOUNT, creditMinor: net },
              ];
        await postJournalEntry(tx, {
          date: businessDate(),
          description: `Stock count ${audit.number}`,
          referenceType: 'STOCK_AUDIT',
          referenceId: id,
          createdBy: actor.userId,
          lines,
        });
      }
      await tx
        .update(stockAudits)
        .set({
          status: 'APPROVED',
          approvedBy: actor.userId,
          approvedAt: sql`now()`,
          version: sql`${stockAudits.version} + 1`,
        })
        .where(eq(stockAudits.id, id));
      const dto = await this.read(tx, id);
      await recordAudit(tx, {
        actor: actor.userId,
        action: 'stock-audit.approved',
        entityType: 'stock-audit',
        entityId: id,
        after: { number: audit.number, netAdjustmentMinor: net },
      });
      await tx.insert(outboxEvents).values({
        topic: 'stock-audit.approved',
        payload: { auditId: id, netAdjustmentMinor: net },
      });
      return dto;
    });
  }

  async cancel(actor: Principal, id: string): Promise<AuditDto> {
    return this.db.transaction(async (tx) => {
      const audit = await this.lock(tx, id);
      if (audit.status === 'APPROVED' || audit.status === 'CANCELLED') {
        throw conflict('audit-closed', 'This count is already closed', audit.status);
      }
      await tx
        .update(stockAudits)
        .set({ status: 'CANCELLED', version: sql`${stockAudits.version} + 1` })
        .where(eq(stockAudits.id, id));
      const dto = await this.read(tx, id);
      await recordAudit(tx, {
        actor: actor.userId,
        action: 'stock-audit.cancelled',
        entityType: 'stock-audit',
        entityId: id,
        after: { number: dto.number },
      });
      return dto;
    });
  }

  async get(id: string): Promise<AuditDto> {
    return this.read(this.db, id);
  }

  async list(query: ListAuditsQuery) {
    const where: SQL[] = [];
    if (query.status) where.push(eq(stockAudits.status, query.status));
    const [rows, totals] = await Promise.all([
      this.db
        .select()
        .from(stockAudits)
        .where(and(...where))
        .orderBy(desc(stockAudits.createdAt), asc(stockAudits.id))
        .limit(query.limit)
        .offset(query.offset),
      this.db
        .select({ total: count() })
        .from(stockAudits)
        .where(and(...where)),
    ]);
    const items = [];
    for (const r of rows) {
      const { items: _items, ...summary } = await this.read(this.db, r.id);
      items.push(summary);
    }
    return toPage(items, totals[0]?.total ?? 0, query);
  }

  private async lock(tx: Tx, id: string): Promise<StockAuditRow> {
    const [row] = await tx.select().from(stockAudits).where(eq(stockAudits.id, id)).for('update');
    if (!row) throw notFound(`Stock count ${id} does not exist`);
    return row;
  }

  private async read(executor: Pick<Database, 'select'>, id: string): Promise<AuditDto> {
    const [audit] = await executor.select().from(stockAudits).where(eq(stockAudits.id, id));
    if (!audit) throw notFound(`Stock count ${id} does not exist`);
    const rows = await executor
      .select({ item: stockAuditItems, name: products.name })
      .from(stockAuditItems)
      .innerJoin(products, eq(products.id, stockAuditItems.productId))
      .where(eq(stockAuditItems.auditId, id))
      .orderBy(asc(products.name), asc(stockAuditItems.productId));
    const items = rows.map(({ item, name }) => ({
      productId: item.productId,
      productName: name,
      systemQty: item.systemQty,
      physicalQty: item.physicalQty,
      variance:
        item.systemQty === null || item.physicalQty === null
          ? null
          : item.physicalQty - item.systemQty,
      adjustmentValueMinor: item.adjustmentValueMinor,
    }));
    return {
      id: audit.id,
      number: audit.number,
      status: audit.status,
      notes: audit.notes,
      startedBy: audit.startedBy,
      approvedBy: audit.approvedBy,
      items,
      shortageUnits: items.reduce(
        (s, i) => s + (i.variance !== null && i.variance < 0 ? -i.variance : 0),
        0,
      ),
      overageUnits: items.reduce(
        (s, i) => s + (i.variance !== null && i.variance > 0 ? i.variance : 0),
        0,
      ),
      version: audit.version,
      createdAt: audit.createdAt.toISOString(),
    };
  }
}
