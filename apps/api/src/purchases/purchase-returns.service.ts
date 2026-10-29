import { Inject, Injectable } from '@nestjs/common';
import { conflict, notFound, toPage, unprocessable } from '@retail/kit';
import { and, asc, count, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import {
  ACCOUNT,
  postJournalEntry,
  settlementAccount,
  type JournalLineInput,
} from '../accounting/ledger.js';
import { recordAudit } from '../common/audit.js';
import type { Principal } from '../common/auth.js';
import { businessDate, now } from '../common/time.js';
import { DB, type Database } from '../db/db.module.js';
import {
  outboxEvents,
  purchaseItems,
  purchaseReturnItems,
  purchaseReturns,
  purchases,
} from '../db/schema.js';
import { applyMovement } from '../inventory/inventory.js';
import type {
  CreatePurchaseReturn,
  ListPurchaseReturnsQuery,
  PurchaseReturnDto,
} from './purchase-returns.contract.js';

/** The account that absorbs the difference between the credit given and what the goods were worth. */
const PURCHASE_RETURNS_ACCOUNT = '5100';

type ReturnRow = typeof purchaseReturns.$inferSelect;
type ReturnItemRow = typeof purchaseReturnItems.$inferSelect;

const toDto = (row: ReturnRow, items: ReturnItemRow[]): PurchaseReturnDto => ({
  id: row.id,
  number: row.number,
  purchaseId: row.purchaseId,
  reason: row.reason,
  valueMinor: row.valueMinor,
  creditAppliedMinor: row.creditAppliedMinor,
  refundMinor: row.valueMinor - row.creditAppliedMinor,
  refundMethod: row.refundMethod,
  items: items.map((i) => ({
    purchaseItemId: i.purchaseItemId,
    productId: i.productId,
    quantity: i.quantity,
    valueMinor: i.valueMinor,
    stockCostMinor: i.stockCostMinor,
  })),
  createdAt: row.createdAt.toISOString(),
});

function paymentStatusOf(status: string, received: number, paid: number) {
  if (paid === 0) return 'UNPAID' as const;
  return status === 'RECEIVED' && paid >= received ? ('PAID' as const) : ('PARTIAL' as const);
}

@Injectable()
export class PurchaseReturnsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Send received goods back. The supplier credits each unit at the price we paid; the units leave
   * our shelf at their average cost; any difference goes to "Purchase Returns". The credit first
   * cancels what we still owe on the order, and only the excess comes back as money, so the order
   * can never end up overpaid (which the database also refuses).
   */
  async create(
    actor: Principal,
    purchaseId: string,
    input: CreatePurchaseReturn,
  ): Promise<PurchaseReturnDto> {
    return this.db.transaction(async (tx) => {
      const [purchase] = await tx
        .select()
        .from(purchases)
        .where(eq(purchases.id, purchaseId))
        .for('update');
      if (!purchase) throw notFound(`Purchase ${purchaseId} does not exist`);
      if (purchase.status === 'CANCELLED') {
        throw conflict('purchase-not-returnable', 'A cancelled order has nothing to return');
      }
      const ids = input.items.map((i) => i.purchaseItemId);
      if (new Set(ids).size !== ids.length) {
        throw unprocessable('duplicate-line', 'An order line appears twice');
      }
      // Fixed product order, so a return and a sale touching the same products never deadlock.
      const lines = await tx
        .select()
        .from(purchaseItems)
        .where(and(eq(purchaseItems.purchaseId, purchaseId), inArray(purchaseItems.id, ids)))
        .orderBy(asc(purchaseItems.productId))
        .for('update');
      const found = new Set(lines.map((l) => l.id));
      for (const id of ids) {
        if (!found.has(id)) throw unprocessable('line-missing', 'Not a line of this order', id);
      }
      const prepared = lines.map((line) => {
        const item = input.items.find((i) => i.purchaseItemId === line.id)!;
        const available = line.receivedQty - line.returnedQty;
        if (item.quantity > available) {
          throw unprocessable(
            'over-return',
            'More than was received',
            `${available} units of this line can still go back, ${item.quantity} offered`,
          );
        }
        return { line, quantity: item.quantity, value: item.quantity * line.unitCostMinor };
      });
      const value = prepared.reduce((s, p) => s + p.value, 0);
      if (value <= 0) throw unprocessable('nothing-to-credit', 'These goods carry no credit');

      // The credit first cancels what we still owe; only the rest is money coming back.
      const owed = purchase.receivedValueMinor - purchase.paidMinor;
      const credit = Math.min(value, Math.max(owed, 0));
      const refund = value - credit;
      if (refund > 0 && !input.refundMethod) {
        throw unprocessable(
          'refund-method-required',
          'Say how the supplier pays back the money',
          `${refund} was already paid and comes back`,
        );
      }

      const returnId = crypto.randomUUID();
      const seq = await tx.execute<{ n: string }>(
        sql`select nextval('purchase_return_number_seq') as n`,
      );
      const number = `PRET-${String(seq.rows[0]!.n).padStart(6, '0')}`;

      // The goods leave the shelf at their average cost, which may differ from the credit.
      let stockCost = 0;
      const costs = new Map<string, number>();
      for (const p of prepared) {
        const moved = await applyMovement(tx, {
          productId: p.line.productId,
          type: 'PURCHASE_RETURN',
          quantity: p.quantity,
          referenceType: 'PURCHASE_RETURN',
          referenceId: returnId,
          notes: input.reason,
          createdBy: actor.userId,
        });
        costs.set(p.line.id, moved.costMinor);
        stockCost += moved.costMinor;
      }
      const difference = value - stockCost;

      const journal: JournalLineInput[] = [];
      if (credit > 0) journal.push({ accountCode: ACCOUNT.PAYABLE, debitMinor: credit });
      if (refund > 0) {
        journal.push({ accountCode: settlementAccount(input.refundMethod!), debitMinor: refund });
      }
      if (stockCost > 0) journal.push({ accountCode: ACCOUNT.INVENTORY, creditMinor: stockCost });
      if (difference > 0) {
        journal.push({ accountCode: PURCHASE_RETURNS_ACCOUNT, creditMinor: difference });
      }
      if (difference < 0) {
        journal.push({ accountCode: PURCHASE_RETURNS_ACCOUNT, debitMinor: -difference });
      }
      const entry = await postJournalEntry(tx, {
        date: businessDate(),
        description: `Return ${number} on ${purchase.number}`,
        referenceType: 'PURCHASE_RETURN',
        referenceId: returnId,
        lines: journal,
        createdBy: actor.userId,
      });

      const [row] = await tx
        .insert(purchaseReturns)
        .values({
          id: returnId,
          number,
          purchaseId,
          reason: input.reason,
          valueMinor: value,
          creditAppliedMinor: credit,
          refundMethod: refund > 0 ? input.refundMethod! : null,
          journalEntryId: entry.id,
          processedBy: actor.userId,
        })
        .returning();
      const itemRows = await tx
        .insert(purchaseReturnItems)
        .values(
          prepared.map((p) => ({
            returnId,
            purchaseItemId: p.line.id,
            productId: p.line.productId,
            quantity: p.quantity,
            valueMinor: p.value,
            stockCostMinor: costs.get(p.line.id) ?? 0,
          })),
        )
        .returning();
      for (const p of prepared) {
        await tx
          .update(purchaseItems)
          .set({ returnedQty: sql`${purchaseItems.returnedQty} + ${p.quantity}` })
          .where(eq(purchaseItems.id, p.line.id));
      }
      // What was received and what was paid both fall by the amounts the books moved.
      const received = purchase.receivedValueMinor - value;
      const paid = purchase.paidMinor - refund;
      await tx
        .update(purchases)
        .set({
          receivedValueMinor: received,
          paidMinor: paid,
          paymentStatus: paymentStatusOf(purchase.status, received, paid),
          version: sql`${purchases.version} + 1`,
          updatedAt: now(),
        })
        .where(eq(purchases.id, purchaseId));

      const dto = toDto(row!, itemRows);
      await recordAudit(tx, {
        actor: actor.userId,
        action: 'purchase.return-processed',
        entityType: 'purchase',
        entityId: purchaseId,
        after: dto,
      });
      await tx.insert(outboxEvents).values({
        topic: 'purchase.returned',
        payload: { purchaseId, returnId, valueMinor: value },
      });
      return dto;
    });
  }

  async list(query: ListPurchaseReturnsQuery) {
    const where: SQL[] = [];
    if (query.purchaseId) where.push(eq(purchaseReturns.purchaseId, query.purchaseId));
    const [rows, totals] = await Promise.all([
      this.db
        .select()
        .from(purchaseReturns)
        .where(and(...where))
        .orderBy(desc(purchaseReturns.createdAt), asc(purchaseReturns.id))
        .limit(query.limit)
        .offset(query.offset),
      this.db
        .select({ total: count() })
        .from(purchaseReturns)
        .where(and(...where)),
    ]);
    const ids = rows.map((r) => r.id);
    const items = ids.length
      ? await this.db
          .select()
          .from(purchaseReturnItems)
          .where(inArray(purchaseReturnItems.returnId, ids))
      : [];
    return toPage(
      rows.map((r) =>
        toDto(
          r,
          items.filter((i) => i.returnId === r.id),
        ),
      ),
      totals[0]?.total ?? 0,
      query,
    );
  }
}
