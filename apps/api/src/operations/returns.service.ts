import { Inject, Injectable } from '@nestjs/common';
import { conflict, notFound, toPage, unprocessable } from '@retail/kit';
import { and, asc, count, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import {
  ACCOUNT,
  cogsAccount,
  postJournalEntry,
  settlementAccount,
  type JournalLineInput,
} from '../accounting/ledger.js';
import { recordAudit } from '../common/audit.js';
import type { Principal } from '../common/auth.js';
import { businessDate } from '../common/time.js';
import { DB, type Database } from '../db/db.module.js';
import {
  outboxEvents,
  saleItems,
  saleReturnItems,
  saleReturns,
  sales,
  type SaleItemRow,
} from '../db/schema.js';
import { applyMovement } from '../inventory/inventory.js';
import type { CreateReturn, ListReturnsQuery, SaleReturnDto } from './operations.contract.js';

/** Integer division rounded half up, in BigInt so large amounts never lose a santim. */
const roundDiv = (numerator: number, denominator: number): number =>
  Number((BigInt(numerator) * 2n + BigInt(denominator)) / (BigInt(denominator) * 2n));

/**
 * The share of a line (its revenue or its cost) that `qty` more returned units carry, given how many
 * were returned before. Computed cumulatively, so returning a line in pieces adds up to exactly the
 * whole line, with no santim lost or invented.
 */
export const shareOfLine = (
  lineAmount: number,
  lineQty: number,
  returnedBefore: number,
  qty: number,
) =>
  roundDiv(lineAmount * (returnedBefore + qty), lineQty) -
  roundDiv(lineAmount * returnedBefore, lineQty);

type ReturnRow = typeof saleReturns.$inferSelect;
type ReturnItemRow = typeof saleReturnItems.$inferSelect;

const toDto = (row: ReturnRow, items: ReturnItemRow[]): SaleReturnDto => ({
  id: row.id,
  number: row.number,
  saleId: row.saleId,
  reason: row.reason,
  refundMinor: row.refundMinor,
  appliedToReceivableMinor: row.appliedToReceivableMinor,
  cashRefundMinor: row.refundMinor - row.appliedToReceivableMinor,
  refundMethod: row.refundMethod,
  items: items.map((i) => ({
    saleItemId: i.saleItemId,
    productId: i.productId,
    quantity: i.quantity,
    restockable: i.restockable,
    refundMinor: i.refundMinor,
    costMinor: i.costMinor,
  })),
  createdAt: row.createdAt.toISOString(),
});

@Injectable()
export class ReturnsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Take goods back from a customer. Revenue is reversed for what is refunded. Goods fit to sell
   * again also come back into stock at the cost they left at (and that cost of goods sold is
   * reversed); scrap does not, because the cost of a sale that is never recovered stays a cost.
   * If the customer still owed money on the sale, the refund first cancels that debt.
   */
  async create(actor: Principal, saleId: string, input: CreateReturn): Promise<SaleReturnDto> {
    return this.db.transaction(async (tx) => {
      const [sale] = await tx.select().from(sales).where(eq(sales.id, saleId)).for('update');
      if (!sale) throw notFound(`Sale ${saleId} does not exist`);
      if (sale.status !== 'COMPLETED') {
        throw conflict('sale-not-returnable', 'Only a completed sale can have goods returned');
      }
      const ids = input.items.map((i) => i.saleItemId);
      if (new Set(ids).size !== ids.length) {
        throw unprocessable('duplicate-line', 'A sale line appears twice');
      }
      const lines = await tx
        .select()
        .from(saleItems)
        .where(and(eq(saleItems.saleId, saleId), inArray(saleItems.id, ids)))
        .orderBy(asc(saleItems.productId))
        .for('update');
      const byId = new Map<string, SaleItemRow>(lines.map((l) => [l.id, l]));

      const prepared = input.items.map((item) => {
        const line = byId.get(item.saleItemId);
        if (!line) throw unprocessable('line-missing', 'Not a line of this sale', item.saleItemId);
        const remaining = line.quantity - line.returnedQty;
        if (item.quantity > remaining) {
          throw unprocessable(
            'over-return',
            'More than was sold',
            `"${line.productName}": ${remaining} left to return, ${item.quantity} offered`,
          );
        }
        return {
          line,
          item,
          refund: shareOfLine(line.lineTotalMinor, line.quantity, line.returnedQty, item.quantity),
          cost: shareOfLine(line.lineCogsMinor, line.quantity, line.returnedQty, item.quantity),
        };
      });
      const refund = prepared.reduce((s, p) => s + p.refund, 0);
      if (refund <= 0) {
        throw unprocessable('nothing-to-refund', 'These goods carry no refund');
      }

      // A refund cancels what the customer still owes before any cash goes back.
      const owed = sale.paymentMethod === 'CREDIT' ? sale.totalMinor - sale.amountPaidMinor : 0;
      const applied = Math.min(refund, owed);
      const cashOut = refund - applied;
      if (cashOut > 0 && !input.refundMethod) {
        throw unprocessable(
          'refund-method-required',
          'Say how the refund is paid out',
          `${cashOut} goes back to the customer`,
        );
      }

      const returnId = crypto.randomUUID();
      const seq = await tx.execute<{ n: string }>(sql`select nextval('return_number_seq') as n`);
      const number = `RET-${String(seq.rows[0]!.n).padStart(6, '0')}`;
      const journal: JournalLineInput[] = [{ accountCode: '4100', debitMinor: refund }];
      if (applied > 0) journal.push({ accountCode: ACCOUNT.RECEIVABLE, creditMinor: applied });
      if (cashOut > 0) {
        journal.push({
          accountCode: settlementAccount(input.refundMethod!),
          creditMinor: cashOut,
        });
      }

      for (const p of prepared) {
        if (p.item.restockable && p.cost > 0) {
          journal.push({ accountCode: ACCOUNT.INVENTORY, debitMinor: p.cost });
          journal.push({ accountCode: cogsAccount(p.line.categoryType), creditMinor: p.cost });
        }
      }
      for (const p of prepared) {
        if (p.item.restockable) {
          await applyMovement(tx, {
            productId: p.line.productId,
            type: 'SALE_RETURN',
            quantity: p.item.quantity,
            totalCostMinor: p.cost,
            referenceType: 'SALE_RETURN',
            referenceId: returnId,
            notes: input.reason,
            createdBy: actor.userId,
          });
        }
      }
      const entry = await postJournalEntry(tx, {
        date: businessDate(),
        description: `Return ${number} on sale ${sale.number}`,
        referenceType: 'SALE_RETURN',
        referenceId: returnId,
        lines: journal,
        createdBy: actor.userId,
      });

      const [row] = await tx
        .insert(saleReturns)
        .values({
          id: returnId,
          number,
          saleId,
          reason: input.reason,
          refundMinor: refund,
          appliedToReceivableMinor: applied,
          refundMethod: cashOut > 0 ? input.refundMethod! : null,
          journalEntryId: entry.id,
          processedBy: actor.userId,
        })
        .returning();
      const itemRows = await tx
        .insert(saleReturnItems)
        .values(
          prepared.map((p) => ({
            returnId,
            saleItemId: p.line.id,
            productId: p.line.productId,
            quantity: p.item.quantity,
            restockable: p.item.restockable,
            refundMinor: p.refund,
            costMinor: p.cost,
          })),
        )
        .returning();
      for (const p of prepared) {
        await tx
          .update(saleItems)
          .set({ returnedQty: sql`${saleItems.returnedQty} + ${p.item.quantity}` })
          .where(eq(saleItems.id, p.line.id));
      }
      if (applied > 0) {
        await tx
          .update(sales)
          .set({
            amountPaidMinor: sql`${sales.amountPaidMinor} + ${applied}`,
            version: sql`${sales.version} + 1`,
          })
          .where(eq(sales.id, saleId));
      }
      const dto = toDto(row!, itemRows);
      await recordAudit(tx, {
        actor: actor.userId,
        action: 'sale.return-processed',
        entityType: 'sale',
        entityId: saleId,
        after: dto,
      });
      await tx
        .insert(outboxEvents)
        .values({ topic: 'sale.returned', payload: { saleId, returnId, refundMinor: refund } });
      return dto;
    });
  }

  async list(query: ListReturnsQuery) {
    const where: SQL[] = [];
    if (query.saleId) where.push(eq(saleReturns.saleId, query.saleId));
    const [rows, totals] = await Promise.all([
      this.db
        .select()
        .from(saleReturns)
        .where(and(...where))
        .orderBy(desc(saleReturns.createdAt), asc(saleReturns.id))
        .limit(query.limit)
        .offset(query.offset),
      this.db
        .select({ total: count() })
        .from(saleReturns)
        .where(and(...where)),
    ]);
    const ids = rows.map((r) => r.id);
    const items = ids.length
      ? await this.db.select().from(saleReturnItems).where(inArray(saleReturnItems.returnId, ids))
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
