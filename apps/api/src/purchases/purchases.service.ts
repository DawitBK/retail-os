import { Inject, Injectable } from '@nestjs/common';
import { conflict, notFound, toPage, unprocessable } from '@retail/kit';
import { and, asc, count, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { ACCOUNT, postJournalEntry, settlementAccount } from '../accounting/ledger.js';
import { recordAudit } from '../common/audit.js';
import type { Principal } from '../common/auth.js';
import { businessDate, now } from '../common/time.js';
import { DB, type Database, type Tx } from '../db/db.module.js';
import {
  outboxEvents,
  products,
  purchaseItems,
  purchases,
  settlements,
  suppliers,
  type PurchaseRow,
} from '../db/schema.js';
import { applyMovement } from '../inventory/inventory.js';
import type {
  CreatePurchase,
  CreateSupplierPayment,
  ListPurchasesQuery,
  PurchaseDto,
  ReceivePurchase,
  SupplierPaymentDto,
} from './purchases.contract.js';

type ItemWithName = typeof purchaseItems.$inferSelect & { productName: string };

const toDto = (row: PurchaseRow, items: ItemWithName[]): PurchaseDto => ({
  id: row.id,
  number: row.number,
  supplierId: row.supplierId,
  status: row.status,
  orderDate: row.orderDate,
  expectedDate: row.expectedDate,
  receivedDate: row.receivedDate,
  totalMinor: row.totalMinor,
  receivedValueMinor: row.receivedValueMinor,
  paidMinor: row.paidMinor,
  payableMinor: row.receivedValueMinor - row.paidMinor,
  paymentStatus: row.paymentStatus,
  items: items.map((i) => ({
    id: i.id,
    productId: i.productId,
    productName: i.productName,
    orderedQty: i.orderedQty,
    receivedQty: i.receivedQty,
    unitCostMinor: i.unitCostMinor,
  })),
  notes: row.notes,
  version: row.version,
  createdAt: row.createdAt.toISOString(),
});

/** Paid in full only once everything has arrived and been paid for; any payment before that is partial. */
function paymentStatusOf(status: PurchaseRow['status'], received: number, paid: number) {
  if (paid === 0) return 'UNPAID' as const;
  return status === 'RECEIVED' && paid >= received ? ('PAID' as const) : ('PARTIAL' as const);
}

async function enqueue(tx: Tx, topic: string, payload: Record<string, unknown>): Promise<void> {
  await tx.insert(outboxEvents).values({ topic, payload });
}

@Injectable()
export class PurchasesService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async create(actor: Principal, input: CreatePurchase): Promise<PurchaseDto> {
    return this.db.transaction(async (tx) => {
      const [supplier] = await tx
        .select({ id: suppliers.id })
        .from(suppliers)
        .where(and(eq(suppliers.id, input.supplierId), isNull(suppliers.deletedAt)));
      if (!supplier) throw unprocessable('supplier-missing', 'Supplier does not exist');
      const ids = input.items.map((i) => i.productId);
      if (new Set(ids).size !== ids.length) {
        throw unprocessable('duplicate-product', 'A product appears twice', 'Combine the lines');
      }
      const found = await tx
        .select({ id: products.id })
        .from(products)
        .where(and(inArray(products.id, ids), isNull(products.deletedAt)));
      if (found.length !== ids.length) {
        throw unprocessable('product-missing', 'A product does not exist');
      }
      const total = input.items.reduce((s, i) => s + i.orderedQty * i.unitCostMinor, 0);
      const seq = await tx.execute<{ n: string }>(sql`select nextval('purchase_number_seq') as n`);
      const number = `PO-${String(seq.rows[0]!.n).padStart(6, '0')}`;
      const [row] = await tx
        .insert(purchases)
        .values({
          number,
          supplierId: input.supplierId,
          orderDate: businessDate(),
          expectedDate: input.expectedDate ?? null,
          totalMinor: total,
          notes: input.notes ?? null,
          createdBy: actor.userId,
        })
        .returning();
      await tx.insert(purchaseItems).values(
        input.items.map((i) => ({
          purchaseId: row!.id,
          productId: i.productId,
          orderedQty: i.orderedQty,
          unitCostMinor: i.unitCostMinor,
        })),
      );
      const dto = await this.read(tx, row!.id);
      await recordAudit(tx, {
        actor: actor.userId,
        action: 'purchase.created',
        entityType: 'purchase',
        entityId: dto.id,
        after: dto,
      });
      return dto;
    });
  }

  async get(id: string): Promise<PurchaseDto> {
    return this.read(this.db, id);
  }

  async list(query: ListPurchasesQuery) {
    const where: SQL[] = [];
    if (query.supplierId) where.push(eq(purchases.supplierId, query.supplierId));
    if (query.status) where.push(eq(purchases.status, query.status));
    if (query.paymentStatus) where.push(eq(purchases.paymentStatus, query.paymentStatus));
    const [rows, totals] = await Promise.all([
      this.db
        .select()
        .from(purchases)
        .where(and(...where))
        .orderBy(desc(purchases.createdAt), asc(purchases.id))
        .limit(query.limit)
        .offset(query.offset),
      this.db
        .select({ total: count() })
        .from(purchases)
        .where(and(...where)),
    ]);
    const ids = rows.map((r) => r.id);
    const items = ids.length ? await this.itemsOf(this.db, ids) : [];
    return toPage(
      rows.map((r) =>
        toDto(
          r,
          items.filter((i) => i.purchaseId === r.id),
        ),
      ),
      totals[0]?.total ?? 0,
      query,
    );
  }

  /**
   * Receive goods. Stock comes in at the order's unit cost (the weighted average moves with it),
   * and we now owe the supplier for exactly what arrived: debit inventory, credit payables.
   */
  async receive(actor: Principal, id: string, input: ReceivePurchase): Promise<PurchaseDto> {
    return this.db.transaction(async (tx) => {
      const purchase = await this.lock(tx, id);
      if (purchase.status === 'CANCELLED' || purchase.status === 'RECEIVED') {
        throw conflict(
          'purchase-not-receivable',
          'Nothing more can be received',
          `The order is ${purchase.status}`,
        );
      }
      const items = await this.itemsOf(tx, [id]);
      const byId = new Map(items.map((i) => [i.id, i]));
      const wanted = new Map<string, number>();
      for (const line of input.items) {
        if (wanted.has(line.itemId)) {
          throw unprocessable('duplicate-line', 'A line appears twice', line.itemId);
        }
        const item = byId.get(line.itemId);
        if (!item) throw unprocessable('line-missing', 'Not a line of this order', line.itemId);
        const outstanding = item.orderedQty - item.receivedQty;
        if (line.quantity > outstanding) {
          throw unprocessable(
            'over-receipt',
            'More than was ordered',
            `"${item.productName}": ${outstanding} still to come, ${line.quantity} received`,
          );
        }
        wanted.set(line.itemId, line.quantity);
      }

      let value = 0;
      // Fixed product order, so a receipt and a sale touching the same products never deadlock.
      const ordered = [...wanted.entries()]
        .map(([itemId, quantity]) => ({ item: byId.get(itemId)!, quantity }))
        .sort((a, b) => a.item.productId.localeCompare(b.item.productId));
      for (const { item, quantity } of ordered) {
        const cost = quantity * item.unitCostMinor;
        await applyMovement(tx, {
          productId: item.productId,
          type: 'PURCHASE_RECEIPT',
          quantity,
          totalCostMinor: cost,
          referenceType: 'PURCHASE',
          referenceId: id,
          createdBy: actor.userId,
        });
        await tx
          .update(purchaseItems)
          .set({ receivedQty: sql`${purchaseItems.receivedQty} + ${quantity}` })
          .where(eq(purchaseItems.id, item.id));
        value += cost;
      }
      if (value > 0) {
        await postJournalEntry(tx, {
          date: businessDate(),
          description: `Goods received on ${purchase.number}`,
          referenceType: 'PURCHASE_RECEIPT',
          referenceId: id,
          createdBy: actor.userId,
          lines: [
            { accountCode: ACCOUNT.INVENTORY, debitMinor: value },
            { accountCode: ACCOUNT.PAYABLE, creditMinor: value },
          ],
        });
      }
      const fresh = await this.itemsOf(tx, [id]);
      const complete = fresh.every((i) => i.receivedQty === i.orderedQty);
      const status = complete ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
      const received = purchase.receivedValueMinor + value;
      await tx
        .update(purchases)
        .set({
          status,
          receivedValueMinor: received,
          receivedDate: businessDate(),
          paymentStatus: paymentStatusOf(status, received, purchase.paidMinor),
          version: sql`${purchases.version} + 1`,
          updatedAt: now(),
        })
        .where(eq(purchases.id, id));
      const after = await this.read(tx, id);
      await recordAudit(tx, {
        actor: actor.userId,
        action: 'purchase.received',
        entityType: 'purchase',
        entityId: id,
        before: toDto(purchase, items),
        after,
      });
      await enqueue(tx, 'purchase.received', { purchaseId: id, number: purchase.number, status });
      return after;
    });
  }

  /** Cancel an order nothing has arrived for. */
  async cancel(actor: Principal, id: string): Promise<PurchaseDto> {
    return this.db.transaction(async (tx) => {
      const purchase = await this.lock(tx, id);
      if (purchase.status !== 'ORDERED') {
        throw conflict(
          'purchase-not-cancellable',
          'Only an order with nothing received can be cancelled',
          `The order is ${purchase.status}`,
        );
      }
      await tx
        .update(purchases)
        .set({ status: 'CANCELLED', version: sql`${purchases.version} + 1`, updatedAt: now() })
        .where(eq(purchases.id, id));
      const after = await this.read(tx, id);
      await recordAudit(tx, {
        actor: actor.userId,
        action: 'purchase.cancelled',
        entityType: 'purchase',
        entityId: id,
        after,
      });
      return after;
    });
  }

  /** Pay a supplier: settles payables, never more than has been received and not yet paid for. */
  async pay(
    actor: Principal,
    id: string,
    input: CreateSupplierPayment,
  ): Promise<SupplierPaymentDto> {
    return this.db.transaction(async (tx) => {
      const purchase = await this.lock(tx, id);
      const owed = purchase.receivedValueMinor - purchase.paidMinor;
      if (input.amountMinor > owed) {
        throw unprocessable(
          'overpayment',
          'More than is owed',
          `Owed ${owed} for goods received, paying ${input.amountMinor}`,
        );
      }
      const entry = await postJournalEntry(tx, {
        date: businessDate(),
        description: `Payment to supplier for ${purchase.number}`,
        referenceType: 'SUPPLIER_PAYMENT',
        referenceId: id,
        createdBy: actor.userId,
        lines: [
          { accountCode: ACCOUNT.PAYABLE, debitMinor: input.amountMinor },
          { accountCode: settlementAccount(input.method), creditMinor: input.amountMinor },
        ],
      });
      const [row] = await tx
        .insert(settlements)
        .values({
          kind: 'SUPPLIER_PAYMENT',
          purchaseId: id,
          amountMinor: input.amountMinor,
          method: input.method,
          journalEntryId: entry.id,
          recordedBy: actor.userId,
        })
        .returning();
      const paid = purchase.paidMinor + input.amountMinor;
      await tx
        .update(purchases)
        .set({
          paidMinor: paid,
          paymentStatus: paymentStatusOf(purchase.status, purchase.receivedValueMinor, paid),
          version: sql`${purchases.version} + 1`,
          updatedAt: now(),
        })
        .where(eq(purchases.id, id));
      const dto: SupplierPaymentDto = {
        id: row!.id,
        purchaseId: id,
        amountMinor: row!.amountMinor,
        method: row!.method,
        paidAt: row!.paidAt.toISOString(),
        payableMinor: owed - input.amountMinor,
      };
      await recordAudit(tx, {
        actor: actor.userId,
        action: 'purchase.paid',
        entityType: 'purchase',
        entityId: id,
        after: dto,
      });
      return dto;
    });
  }

  private async lock(tx: Tx, id: string): Promise<PurchaseRow> {
    const [row] = await tx.select().from(purchases).where(eq(purchases.id, id)).for('update');
    if (!row) throw notFound(`Purchase ${id} does not exist`);
    return row;
  }

  private async itemsOf(
    executor: Pick<Database, 'select'>,
    purchaseIds: string[],
  ): Promise<(ItemWithName & { purchaseId: string })[]> {
    const rows = await executor
      .select({ item: purchaseItems, productName: products.name })
      .from(purchaseItems)
      .innerJoin(products, eq(products.id, purchaseItems.productId))
      .where(inArray(purchaseItems.purchaseId, purchaseIds))
      .orderBy(asc(products.name), asc(purchaseItems.id));
    return rows.map((r) => ({ ...r.item, productName: r.productName }));
  }

  private async read(executor: Pick<Database, 'select'>, id: string): Promise<PurchaseDto> {
    const [row] = await executor.select().from(purchases).where(eq(purchases.id, id));
    if (!row) throw notFound(`Purchase ${id} does not exist`);
    return toDto(row, await this.itemsOf(executor, [id]));
  }
}
