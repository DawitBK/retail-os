import { Inject, Injectable } from '@nestjs/common';
import { conflict, notFound, ProblemException, toPage, unprocessable } from '@retail/kit';
import { and, asc, count, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { ACCOUNT, postJournalEntry } from '../accounting/ledger.js';
import { recordAudit } from '../common/audit.js';
import type { Principal } from '../common/auth.js';
import { businessDate, now } from '../common/time.js';
import { DB, type Database, type Tx } from '../db/db.module.js';
import { damageRecords, outboxEvents, products, type DamageRow } from '../db/schema.js';
import { applyMovement } from '../inventory/inventory.js';
import type {
  CreateDamage,
  DamageDto,
  DecideDamage,
  ListDamageQuery,
  RejectDamage,
} from './operations.contract.js';

const toDto = (r: DamageRow): DamageDto => ({
  id: r.id,
  number: r.number,
  productId: r.productId,
  kind: r.kind,
  quantity: r.quantity,
  cause: r.cause,
  status: r.status,
  reportedBy: r.reportedBy,
  decidedBy: r.decidedBy,
  decidedAt: r.decidedAt?.toISOString() ?? null,
  decisionNote: r.decisionNote,
  lossMinor: r.lossMinor,
  version: r.version,
  createdAt: r.createdAt.toISOString(),
});

@Injectable()
export class DamageService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** Anyone on the floor can report damaged goods. Nothing changes in stock or in the books until it is approved. */
  async report(actor: Principal, input: CreateDamage): Promise<DamageDto> {
    return this.db.transaction(async (tx) => {
      const [product] = await tx
        .select({ id: products.id, stock: products.currentStock })
        .from(products)
        .where(and(eq(products.id, input.productId), isNull(products.deletedAt)));
      if (!product) throw unprocessable('product-missing', 'Product does not exist');
      const seq = await tx.execute<{ n: string }>(sql`select nextval('damage_number_seq') as n`);
      const number = `DMG-${String(seq.rows[0]!.n).padStart(6, '0')}`;
      const [row] = await tx
        .insert(damageRecords)
        .values({
          number,
          productId: input.productId,
          kind: input.kind,
          quantity: input.quantity,
          cause: input.cause,
          reportedBy: actor.userId,
        })
        .returning();
      const dto = toDto(row!);
      await recordAudit(tx, {
        actor: actor.userId,
        action: 'damage.reported',
        entityType: 'damage',
        entityId: dto.id,
        after: dto,
      });
      await tx
        .insert(outboxEvents)
        .values({ topic: 'damage.reported', payload: { damageId: dto.id, number } });
      return dto;
    });
  }

  async list(query: ListDamageQuery) {
    const where: SQL[] = [];
    if (query.status) where.push(eq(damageRecords.status, query.status));
    if (query.productId) where.push(eq(damageRecords.productId, query.productId));
    const [rows, totals] = await Promise.all([
      this.db
        .select()
        .from(damageRecords)
        .where(and(...where))
        .orderBy(desc(damageRecords.createdAt), asc(damageRecords.id))
        .limit(query.limit)
        .offset(query.offset),
      this.db
        .select({ total: count() })
        .from(damageRecords)
        .where(and(...where)),
    ]);
    return toPage(rows.map(toDto), totals[0]?.total ?? 0, query);
  }

  async get(id: string): Promise<DamageDto> {
    const [row] = await this.db.select().from(damageRecords).where(eq(damageRecords.id, id));
    if (!row) throw notFound(`Damage record ${id} does not exist`);
    return toDto(row);
  }

  /**
   * Sign a loss off: the goods leave stock at their cost and the loss is booked (damage or
   * write-off). The person who reported it cannot approve it; the database enforces that too.
   */
  async approve(actor: Principal, id: string, input: DecideDamage): Promise<DamageDto> {
    return this.db.transaction(async (tx) => {
      const record = await this.lockPending(tx, id, actor);
      const moved = await applyMovement(tx, {
        productId: record.productId,
        type: record.kind === 'WRITE_OFF' ? 'WRITE_OFF' : 'DAMAGE_LOSS',
        quantity: record.quantity,
        referenceType: 'DAMAGE',
        referenceId: id,
        notes: record.cause,
        createdBy: actor.userId,
      });
      let entryId: string | null = null;
      if (moved.costMinor > 0) {
        const entry = await postJournalEntry(tx, {
          date: businessDate(),
          description: `${record.kind === 'WRITE_OFF' ? 'Write-off' : 'Damage'} ${record.number}: ${record.cause}`,
          referenceType: 'DAMAGE',
          referenceId: id,
          createdBy: actor.userId,
          lines: [
            {
              accountCode: record.kind === 'WRITE_OFF' ? '6110' : '6100',
              debitMinor: moved.costMinor,
            },
            { accountCode: ACCOUNT.INVENTORY, creditMinor: moved.costMinor },
          ],
        });
        entryId = entry.id;
      }
      const [row] = await tx
        .update(damageRecords)
        .set({
          status: 'APPROVED',
          decidedBy: actor.userId,
          decidedAt: now(),
          decisionNote: input.note ?? null,
          lossMinor: moved.costMinor,
          journalEntryId: entryId,
          version: sql`${damageRecords.version} + 1`,
        })
        .where(eq(damageRecords.id, id))
        .returning();
      const dto = toDto(row!);
      await recordAudit(tx, {
        actor: actor.userId,
        action: 'damage.approved',
        entityType: 'damage',
        entityId: id,
        before: toDto(record),
        after: dto,
      });
      return dto;
    });
  }

  async reject(actor: Principal, id: string, input: RejectDamage): Promise<DamageDto> {
    return this.db.transaction(async (tx) => {
      const record = await this.lockPending(tx, id, actor);
      const [row] = await tx
        .update(damageRecords)
        .set({
          status: 'REJECTED',
          decidedBy: actor.userId,
          decidedAt: now(),
          decisionNote: input.note,
          version: sql`${damageRecords.version} + 1`,
        })
        .where(eq(damageRecords.id, id))
        .returning();
      const dto = toDto(row!);
      await recordAudit(tx, {
        actor: actor.userId,
        action: 'damage.rejected',
        entityType: 'damage',
        entityId: id,
        before: toDto(record),
        after: dto,
      });
      return dto;
    });
  }

  private async lockPending(tx: Tx, id: string, actor: Principal): Promise<DamageRow> {
    const [record] = await tx
      .select()
      .from(damageRecords)
      .where(eq(damageRecords.id, id))
      .for('update');
    if (!record) throw notFound(`Damage record ${id} does not exist`);
    if (record.status !== 'PENDING') {
      throw conflict('damage-already-decided', 'This report was already decided', record.status);
    }
    if (record.reportedBy === actor.userId) {
      throw new ProblemException(
        403,
        'self-approval',
        'You cannot decide your own report',
        'Another manager or the owner has to approve or reject it',
      );
    }
    return record;
  }
}
