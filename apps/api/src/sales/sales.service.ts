import { Inject, Injectable } from '@nestjs/common';
import { conflict, notFound, ProblemException, toPage, unprocessable } from '@retail/kit';
import { and, asc, count, desc, eq, gte, inArray, isNull, lte, sql, type SQL } from 'drizzle-orm';
import {
  ACCOUNT,
  cogsAccount,
  postJournalEntry,
  revenueAccount,
  settlementAccount,
  voidJournalEntry,
  type JournalLineInput,
} from '../accounting/ledger.js';
import { recordAudit } from '../common/audit.js';
import type { Principal } from '../common/auth.js';
import { runIdempotent, type Outcome } from '../common/idempotency.js';
import { businessDate, getBusinessTimezone } from '../common/time.js';
import { DB, type Database, type Tx } from '../db/db.module.js';
import {
  categories,
  customers,
  journalEntries,
  outboxEvents,
  products,
  saleItems,
  sales,
  settlements,
  type SaleItemRow,
  type SaleRow,
} from '../db/schema.js';
import { applyMovement } from '../inventory/inventory.js';
import { outstandingOf } from '../parties/parties.service.js';
import type {
  CreateReceipt,
  CreateSale,
  ListSalesQuery,
  ReceiptDto,
  SaleDto,
  VoidSale,
} from './sales.contract.js';

const SORT = { saleDate: sales.saleDate, totalMinor: sales.totalMinor } as const;

const isManager = (p: Principal) => p.role === 'owner' || p.role === 'manager';

const toSaleDto = (
  row: SaleRow,
  items: SaleItemRow[],
  journalEntryNumber: string | null,
): SaleDto => ({
  id: row.id,
  number: row.number,
  customerId: row.customerId,
  saleDate: row.saleDate.toISOString(),
  status: row.status,
  subtotalMinor: row.subtotalMinor,
  discountMinor: row.discountMinor,
  totalMinor: row.totalMinor,
  cogsMinor: row.cogsMinor,
  grossProfitMinor: row.totalMinor - row.cogsMinor,
  paymentMethod: row.paymentMethod,
  amountPaidMinor: row.amountPaidMinor,
  changeGivenMinor: row.changeGivenMinor,
  outstandingMinor:
    row.paymentMethod === 'CREDIT' && row.status === 'COMPLETED'
      ? row.totalMinor - row.amountPaidMinor
      : 0,
  items: items.map((i) => ({
    id: i.id,
    productId: i.productId,
    productName: i.productName,
    quantity: i.quantity,
    unitPriceMinor: i.unitPriceMinor,
    discountMinor: i.discountMinor,
    lineTotalMinor: i.lineTotalMinor,
    lineCogsMinor: i.lineCogsMinor,
  })),
  journalEntryNumber,
  notes: row.notes,
  createdBy: row.createdBy,
  voidedAt: row.voidedAt?.toISOString() ?? null,
  voidReason: row.voidReason,
  version: row.version,
});

async function enqueue(tx: Tx, topic: string, payload: Record<string, unknown>): Promise<void> {
  await tx.insert(outboxEvents).values({ topic, payload });
}

@Injectable()
export class SalesService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Record a sale: price the lines, take the stock, post revenue and cost together, all in one
   * transaction. Products are locked in id order so concurrent tills cannot deadlock, and stock
   * is checked while the rows are locked, so two tills can never both sell the last unit.
   */
  async create(
    actor: Principal,
    input: CreateSale,
    key: string | undefined,
  ): Promise<Outcome<SaleDto>> {
    return runIdempotent(this.db, actor.userId, key, input, async (tx) => {
      const ids = input.items.map((i) => i.productId);
      if (new Set(ids).size !== ids.length) {
        throw unprocessable('duplicate-product', 'A product appears twice', 'Combine the lines');
      }
      const rows = await tx
        .select({ product: products, categoryType: categories.type })
        .from(products)
        .innerJoin(categories, eq(categories.id, products.categoryId))
        .where(inArray(products.id, ids))
        .orderBy(asc(products.id))
        .for('update', { of: products });
      const byId = new Map(rows.map((r) => [r.product.id, r]));

      const lines = [...input.items]
        .sort((a, b) => a.productId.localeCompare(b.productId))
        .map((item) => {
          const found = byId.get(item.productId);
          if (!found || found.product.deletedAt || found.product.status !== 'ACTIVE') {
            throw unprocessable(
              'product-unavailable',
              'A product cannot be sold',
              `Product ${item.productId} is missing or discontinued`,
            );
          }
          const { product } = found;
          const overridesPrice =
            item.unitPriceMinor !== undefined && item.unitPriceMinor !== product.sellingPriceMinor;
          const discount = item.discountMinor ?? 0;
          if ((overridesPrice || discount > 0) && !isManager(actor)) {
            throw new ProblemException(
              403,
              'manager-approval-required',
              'A manager must approve this price',
              'Only a manager or the owner can change a price or give a discount',
            );
          }
          const unitPrice = item.unitPriceMinor ?? product.sellingPriceMinor;
          const gross = unitPrice * item.quantity;
          if (discount > gross) {
            throw unprocessable('discount-too-large', 'Discount exceeds the line', product.name);
          }
          const lineTotal = gross - discount;
          const floor = product.minSellingPriceMinor;
          if (floor !== null && lineTotal < floor * item.quantity && !isManager(actor)) {
            throw new ProblemException(
              403,
              'below-minimum-price',
              'Below the minimum selling price',
              `"${product.name}" cannot be sold under ${floor}`,
            );
          }
          return {
            product,
            categoryType: found.categoryType,
            quantity: item.quantity,
            unitPrice,
            discount,
            lineTotal,
          };
        });

      const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
      const discountTotal = lines.reduce((s, l) => s + l.discount, 0);
      const total = subtotal - discountTotal;
      if (total <= 0) {
        throw unprocessable('zero-total', 'A sale must have a total above zero');
      }

      // ---- who pays, and how ----
      const credit = input.paymentMethod === 'CREDIT';
      let amountPaid: number;
      let change = 0;
      if (credit) {
        if (!input.customerId) {
          throw unprocessable('customer-required', 'A credit sale needs a customer');
        }
        amountPaid = input.amountPaidMinor ?? 0;
        if (amountPaid >= total) {
          throw unprocessable(
            'credit-fully-paid',
            'Nothing is left on credit',
            'Use a cash, bank or mobile payment instead',
          );
        }
      } else {
        amountPaid = input.amountPaidMinor ?? total;
        if (amountPaid < total) {
          throw unprocessable(
            'insufficient-payment',
            'The amount paid is below the total',
            `Total ${total}, paid ${amountPaid}`,
          );
        }
        change = amountPaid - total;
      }
      if (input.customerId) {
        // Locked, so two tills selling on credit to one customer cannot both slip under the limit.
        const [customer] = await tx
          .select()
          .from(customers)
          .where(and(eq(customers.id, input.customerId), isNull(customers.deletedAt)))
          .for('update');
        if (!customer) throw notFound(`Customer ${input.customerId} does not exist`);
        if (credit) {
          const owed = (await outstandingOf(tx, [customer.id])).get(customer.id) ?? 0;
          const after = owed + (total - amountPaid);
          if (after > customer.creditLimitMinor) {
            throw conflict(
              'credit-limit-exceeded',
              'Credit limit exceeded',
              `Owed ${owed}, this sale adds ${total - amountPaid}, the limit is ${customer.creditLimitMinor}`,
            );
          }
        }
      }

      // ---- take the stock; the cost of each line comes from the inventory value ----
      const saleId = crypto.randomUUID();
      const costed = [];
      for (const line of lines) {
        const moved = await applyMovement(tx, {
          productId: line.product.id,
          type: 'SALE',
          quantity: line.quantity,
          referenceType: 'SALE',
          referenceId: saleId,
          createdBy: actor.userId,
        });
        costed.push({ ...line, cogs: moved.costMinor });
      }
      const cogsTotal = costed.reduce((s, l) => s + l.cogs, 0);

      // ---- the books: revenue and its cost are recognised together, in one entry ----
      const seq = await tx.execute<{ n: string }>(sql`select nextval('sale_number_seq') as n`);
      const number = `S-${String(seq.rows[0]!.n).padStart(6, '0')}`;
      const journal: JournalLineInput[] = [];
      if (credit) {
        journal.push({ accountCode: ACCOUNT.CASH, debitMinor: amountPaid });
        journal.push({ accountCode: ACCOUNT.RECEIVABLE, debitMinor: total - amountPaid });
      } else {
        const method = input.paymentMethod as 'CASH' | 'BANK_TRANSFER' | 'MOBILE_MONEY';
        journal.push({ accountCode: settlementAccount(method), debitMinor: total });
      }
      for (const l of costed) {
        journal.push({ accountCode: revenueAccount(l.categoryType), creditMinor: l.lineTotal });
        journal.push({ accountCode: cogsAccount(l.categoryType), debitMinor: l.cogs });
      }
      journal.push({ accountCode: ACCOUNT.INVENTORY, creditMinor: cogsTotal });
      const entry = await postJournalEntry(tx, {
        date: businessDate(),
        description: `Sale ${number}`,
        referenceType: 'SALE',
        referenceId: saleId,
        lines: journal,
        createdBy: actor.userId,
      });

      const [sale] = await tx
        .insert(sales)
        .values({
          id: saleId,
          number,
          customerId: input.customerId ?? null,
          subtotalMinor: subtotal,
          discountMinor: discountTotal,
          totalMinor: total,
          cogsMinor: cogsTotal,
          paymentMethod: input.paymentMethod,
          amountPaidMinor: amountPaid,
          changeGivenMinor: change,
          notes: input.notes ?? null,
          journalEntryId: entry.id,
          createdBy: actor.userId,
        })
        .returning();
      const itemRows = await tx
        .insert(saleItems)
        .values(
          costed.map((l) => ({
            saleId,
            productId: l.product.id,
            productName: l.product.name,
            categoryType: l.categoryType,
            quantity: l.quantity,
            unitPriceMinor: l.unitPrice,
            discountMinor: l.discount,
            lineTotalMinor: l.lineTotal,
            lineCogsMinor: l.cogs,
          })),
        )
        .returning();
      const body = toSaleDto(sale!, itemRows, entry.entryNumber);
      await recordAudit(tx, {
        actor: actor.userId,
        action: 'sale.created',
        entityType: 'sale',
        entityId: saleId,
        after: body,
      });
      await enqueue(tx, 'sale.completed', { saleId, number, totalMinor: total });
      return { status: 201, body };
    });
  }

  async get(actor: Principal, id: string): Promise<SaleDto> {
    const [row] = await this.db.select().from(sales).where(eq(sales.id, id));
    // A cashier sees only their own sales; someone else's answers like a missing one.
    if (!row || (actor.role === 'cashier' && row.createdBy !== actor.userId)) {
      throw notFound(`Sale ${id} does not exist`);
    }
    return this.read(this.db, row);
  }

  async list(actor: Principal, query: ListSalesQuery) {
    const where: SQL[] = [];
    if (actor.role === 'cashier') where.push(eq(sales.createdBy, actor.userId));
    if (query.customerId) where.push(eq(sales.customerId, query.customerId));
    if (query.paymentMethod) where.push(eq(sales.paymentMethod, query.paymentMethod));
    if (query.status) where.push(eq(sales.status, query.status));
    const day = sql`(${sales.saleDate} at time zone ${getBusinessTimezone()})::date`;
    if (query.from) where.push(gte(day, sql`${query.from}::date`));
    if (query.to) where.push(lte(day, sql`${query.to}::date`));
    const order = [
      ...query.sort.map((s) => (s.direction === 'asc' ? asc : desc)(SORT[s.field])),
      asc(sales.id),
    ];
    const [rows, totals] = await Promise.all([
      this.db
        .select()
        .from(sales)
        .where(and(...where))
        .orderBy(...order)
        .limit(query.limit)
        .offset(query.offset),
      this.db
        .select({ total: count() })
        .from(sales)
        .where(and(...where)),
    ]);
    const ids = rows.map((r) => r.id);
    const items = ids.length
      ? await this.db.select().from(saleItems).where(inArray(saleItems.saleId, ids))
      : [];
    const entries = rows.map((r) => r.journalEntryId).filter((x): x is string => x !== null);
    const numbers = entries.length
      ? await this.db
          .select({ id: journalEntries.id, n: journalEntries.entryNumber })
          .from(journalEntries)
          .where(inArray(journalEntries.id, entries))
      : [];
    const numberOf = new Map(numbers.map((n) => [n.id, n.n]));
    return toPage(
      rows.map((r) =>
        toSaleDto(
          r,
          items.filter((i) => i.saleId === r.id),
          r.journalEntryId ? (numberOf.get(r.journalEntryId) ?? null) : null,
        ),
      ),
      totals[0]?.total ?? 0,
      query,
    );
  }

  /** Undo a sale completely: the stock goes back at the cost it left at, and the books are reversed. */
  async void(actor: Principal, id: string, input: VoidSale): Promise<SaleDto> {
    return this.db.transaction(async (tx) => {
      const [sale] = await tx.select().from(sales).where(eq(sales.id, id)).for('update');
      if (!sale) throw notFound(`Sale ${id} does not exist`);
      if (sale.status === 'VOIDED') throw conflict('sale-already-voided', 'Sale is already voided');
      const [receipt] = await tx
        .select({ id: settlements.id })
        .from(settlements)
        .where(eq(settlements.saleId, id))
        .limit(1);
      if (receipt) {
        throw conflict(
          'sale-has-receipts',
          'Payments were received against this sale',
          'Refund them before voiding the sale',
        );
      }
      const items = await tx
        .select()
        .from(saleItems)
        .where(eq(saleItems.saleId, id))
        .orderBy(asc(saleItems.productId));
      if (items.some((i) => i.returnedQty > 0)) {
        throw conflict(
          'sale-has-returns',
          'Goods were returned against this sale',
          'A sale with returns cannot be voided; the returns already reversed part of it',
        );
      }
      for (const item of items) {
        await applyMovement(tx, {
          productId: item.productId,
          type: 'SALE_VOID',
          quantity: item.quantity,
          totalCostMinor: item.lineCogsMinor,
          referenceType: 'SALE',
          referenceId: id,
          notes: input.reason,
          createdBy: actor.userId,
        });
      }
      if (sale.journalEntryId) {
        await voidJournalEntry(tx, sale.journalEntryId, {
          userId: actor.userId,
          date: businessDate(),
          reason: input.reason,
        });
      }
      const [row] = await tx
        .update(sales)
        .set({
          status: 'VOIDED',
          voidedAt: sql`now()`,
          voidedBy: actor.userId,
          voidReason: input.reason,
          version: sql`${sales.version} + 1`,
        })
        .where(eq(sales.id, id))
        .returning();
      const after = await this.read(tx, row!);
      await recordAudit(tx, {
        actor: actor.userId,
        action: 'sale.voided',
        entityType: 'sale',
        entityId: id,
        before: toSaleDto(sale, items, null),
        after,
      });
      await enqueue(tx, 'sale.voided', { saleId: id, number: sale.number });
      return after;
    });
  }

  /** A customer pays down a credit sale. */
  async receivePayment(
    actor: Principal,
    saleId: string,
    input: CreateReceipt,
  ): Promise<ReceiptDto> {
    return this.db.transaction(async (tx) => {
      const [sale] = await tx.select().from(sales).where(eq(sales.id, saleId)).for('update');
      if (!sale || (actor.role === 'cashier' && sale.createdBy !== actor.userId)) {
        throw notFound(`Sale ${saleId} does not exist`);
      }
      if (sale.paymentMethod !== 'CREDIT' || sale.status !== 'COMPLETED') {
        throw conflict('sale-not-on-credit', 'Only a completed credit sale can be paid down');
      }
      const owed = sale.totalMinor - sale.amountPaidMinor;
      if (input.amountMinor > owed) {
        throw unprocessable(
          'overpayment',
          'More than is owed',
          `Owed ${owed}, received ${input.amountMinor}`,
        );
      }
      const entry = await postJournalEntry(tx, {
        date: businessDate(),
        description: `Payment received for sale ${sale.number}`,
        referenceType: 'CUSTOMER_RECEIPT',
        referenceId: saleId,
        createdBy: actor.userId,
        lines: [
          { accountCode: settlementAccount(input.method), debitMinor: input.amountMinor },
          { accountCode: ACCOUNT.RECEIVABLE, creditMinor: input.amountMinor },
        ],
      });
      const [row] = await tx
        .insert(settlements)
        .values({
          kind: 'CUSTOMER_RECEIPT',
          saleId,
          amountMinor: input.amountMinor,
          method: input.method,
          journalEntryId: entry.id,
          recordedBy: actor.userId,
        })
        .returning();
      await tx
        .update(sales)
        .set({
          amountPaidMinor: sql`${sales.amountPaidMinor} + ${input.amountMinor}`,
          version: sql`${sales.version} + 1`,
        })
        .where(eq(sales.id, saleId));
      const dto: ReceiptDto = {
        id: row!.id,
        saleId,
        amountMinor: row!.amountMinor,
        method: row!.method,
        paidAt: row!.paidAt.toISOString(),
        outstandingMinor: owed - input.amountMinor,
      };
      await recordAudit(tx, {
        actor: actor.userId,
        action: 'sale.payment-received',
        entityType: 'sale',
        entityId: saleId,
        after: dto,
      });
      return dto;
    });
  }

  private async read(executor: Pick<Database, 'select'>, row: SaleRow): Promise<SaleDto> {
    const items = await executor
      .select()
      .from(saleItems)
      .where(eq(saleItems.saleId, row.id))
      .orderBy(asc(saleItems.productName), asc(saleItems.id));
    let number: string | null = null;
    if (row.journalEntryId) {
      const [e] = await executor
        .select({ n: journalEntries.entryNumber })
        .from(journalEntries)
        .where(eq(journalEntries.id, row.journalEntryId));
      number = e?.n ?? null;
    }
    return toSaleDto(row, items, number);
  }
}
