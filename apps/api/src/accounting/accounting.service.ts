import { Inject, Injectable } from '@nestjs/common';
import { conflict, notFound, toPage } from '@retail/kit';
import type { Pagination } from '@retail/kit';
import { and, asc, count, desc, eq, gte, inArray, isNull, lte, sql, type SQL } from 'drizzle-orm';
import { recordAudit } from '../common/audit.js';
import type { Principal } from '../common/auth.js';
import { businessDate } from '../common/time.js';
import { DB, type Database } from '../db/db.module.js';
import {
  accounts,
  expenses,
  journalEntries,
  journalLines,
  outboxEvents,
  products,
  type AccountRow,
  type ExpenseRow,
} from '../db/schema.js';
import { applyMovement } from '../inventory/inventory.js';
import type {
  AccountDto,
  AsOfQuery,
  CreateExpense,
  ExpenseDto,
  JournalEntryDto,
  LedgerQuery,
  ListExpensesQuery,
  ListJournalQuery,
  OpeningBalance,
  RangeQuery,
  VoidExpense,
} from './accounting.contract.js';
import {
  ACCOUNT,
  postJournalEntry,
  settlementAccount,
  voidJournalEntry,
  type JournalLineInput,
} from './ledger.js';

const toExpenseDto = (r: ExpenseRow): ExpenseDto => ({
  id: r.id,
  number: r.number,
  accountCode: r.accountCode,
  description: r.description,
  amountMinor: r.amountMinor,
  paymentMethod: r.paymentMethod,
  expenseDate: r.expenseDate,
  vendor: r.vendor,
  receiptNumber: r.receiptNumber,
  voided: r.voidedAt !== null,
  voidReason: r.voidReason,
  createdBy: r.createdBy,
  createdAt: r.createdAt.toISOString(),
});

/** Net debit (positive) or credit (negative) of an account's lines. */
const net = sql<number>`coalesce(sum(${journalLines.debitMinor} - ${journalLines.creditMinor}), 0)::bigint`;

/** The balance in the account's own direction: credit-normal accounts count credits as positive. */
const inNormalDirection = (a: Pick<AccountRow, 'normalBalance'>, netDebit: number) =>
  a.normalBalance === 'DEBIT' ? netDebit : -netDebit;

const pct = (part: number, whole: number): number | null =>
  whole === 0 ? null : Math.round((part / whole) * 10000) / 100;

@Injectable()
export class AccountingService {
  constructor(@Inject(DB) private readonly db: Database) {}

  // ---------- chart of accounts, journal, ledger ----------

  async chart(): Promise<AccountDto[]> {
    const all = await this.db.select().from(accounts).orderBy(asc(accounts.code));
    const totals = await this.db
      .select({ accountId: journalLines.accountId, net })
      .from(journalLines)
      .groupBy(journalLines.accountId);
    const byId = new Map(totals.map((t) => [t.accountId, Number(t.net)]));
    return all.map((a) => ({
      code: a.code,
      name: a.name,
      type: a.type,
      normalBalance: a.normalBalance,
      parentCode: a.parentCode,
      balanceMinor: inNormalDirection(a, byId.get(a.id) ?? 0),
    }));
  }

  async journal(query: ListJournalQuery) {
    const where: SQL[] = [];
    if (query.from) where.push(gte(journalEntries.entryDate, query.from));
    if (query.to) where.push(lte(journalEntries.entryDate, query.to));
    if (query.referenceType) where.push(eq(journalEntries.referenceType, query.referenceType));
    const [rows, totals] = await Promise.all([
      this.db
        .select()
        .from(journalEntries)
        .where(and(...where))
        .orderBy(desc(journalEntries.entryNumber))
        .limit(query.limit)
        .offset(query.offset),
      this.db
        .select({ total: count() })
        .from(journalEntries)
        .where(and(...where)),
    ]);
    const ids = rows.map((r) => r.id);
    const lines = ids.length
      ? await this.db
          .select({
            entryId: journalLines.entryId,
            code: accounts.code,
            name: accounts.name,
            debit: journalLines.debitMinor,
            credit: journalLines.creditMinor,
          })
          .from(journalLines)
          .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
          .where(inArray(journalLines.entryId, ids))
          .orderBy(asc(accounts.code))
      : [];
    const items: JournalEntryDto[] = rows.map((r) => ({
      id: r.id,
      entryNumber: r.entryNumber,
      entryDate: r.entryDate,
      description: r.description,
      referenceType: r.referenceType,
      referenceId: r.referenceId,
      status: r.status,
      totalMinor: r.totalMinor,
      reversesEntryId: r.reversesEntryId,
      lines: lines
        .filter((l) => l.entryId === r.id)
        .map((l) => ({
          accountCode: l.code,
          accountName: l.name,
          debitMinor: l.debit,
          creditMinor: l.credit,
        })),
    }));
    return toPage(items, totals[0]?.total ?? 0, query);
  }

  async ledger(code: string, query: LedgerQuery) {
    const [account] = await this.db.select().from(accounts).where(eq(accounts.code, code));
    if (!account) throw notFound(`Account ${code} does not exist`);
    const [allTime] = await this.db
      .select({ net })
      .from(journalLines)
      .where(eq(journalLines.accountId, account.id));
    const [opening] = query.from
      ? await this.db
          .select({ net })
          .from(journalLines)
          .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
          .where(
            and(
              eq(journalLines.accountId, account.id),
              sql`${journalEntries.entryDate} < ${query.from}`,
            ),
          )
      : [{ net: 0 }];
    const openingNet = Number(opening?.net ?? 0);
    const range: SQL[] = [eq(journalLines.accountId, account.id)];
    if (query.from) range.push(gte(journalEntries.entryDate, query.from));
    if (query.to) range.push(lte(journalEntries.entryDate, query.to));
    const sign = account.normalBalance === 'DEBIT' ? 1 : -1;
    // A window function gives the running balance over the whole range; paging is applied after.
    const result = await this.db.execute<{
      entry_number: string;
      entry_date: string;
      description: string;
      debit: string;
      credit: string;
      running: string;
      total: string;
    }>(sql`
      select entry_number, entry_date_text as entry_date, description, debit, credit, running, total
        from (
          select ${journalEntries.entryNumber} as entry_number,
                 ${journalEntries.entryDate}::text as entry_date_text,
                 ${journalEntries.entryDate} as entry_date,
                 ${journalEntries.description} as description,
                 ${journalLines.debitMinor} as debit,
                 ${journalLines.creditMinor} as credit,
                 ${journalLines.id} as line_id,
                 (${openingNet}::bigint + sum(${journalLines.debitMinor} - ${journalLines.creditMinor})
                    over (order by ${journalEntries.entryDate}, ${journalEntries.entryNumber}, ${journalLines.id})) * ${sign}::bigint as running,
                 count(*) over () as total
            from ${journalLines}
            join ${journalEntries} on ${journalEntries.id} = ${journalLines.entryId}
           where ${and(...range)}
        ) ledger
       order by entry_date, entry_number, line_id
       limit ${query.limit} offset ${query.offset}
    `);
    return {
      account: {
        code: account.code,
        name: account.name,
        type: account.type,
        normalBalance: account.normalBalance,
        parentCode: account.parentCode,
        balanceMinor: inNormalDirection(account, Number(allTime?.net ?? 0)),
      },
      openingBalanceMinor: openingNet * sign,
      items: result.rows.map((r) => ({
        entryNumber: r.entry_number,
        entryDate: r.entry_date,
        description: r.description,
        debitMinor: Number(r.debit),
        creditMinor: Number(r.credit),
        runningBalanceMinor: Number(r.running),
      })),
      page: {
        limit: query.limit,
        offset: query.offset,
        total: result.rows[0] ? Number(result.rows[0].total) : 0,
      },
    };
  }

  // ---------- statements ----------

  async trialBalance(range: RangeQuery) {
    const all = await this.db.select().from(accounts).orderBy(asc(accounts.code));
    const rows = await this.db
      .select({
        accountId: journalLines.accountId,
        opening: sql<number>`coalesce(sum(case when ${journalEntries.entryDate} < ${range.from} then ${journalLines.debitMinor} - ${journalLines.creditMinor} else 0 end), 0)::bigint`,
        debit: sql<number>`coalesce(sum(case when ${journalEntries.entryDate} between ${range.from} and ${range.to} then ${journalLines.debitMinor} else 0 end), 0)::bigint`,
        credit: sql<number>`coalesce(sum(case when ${journalEntries.entryDate} between ${range.from} and ${range.to} then ${journalLines.creditMinor} else 0 end), 0)::bigint`,
      })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
      .where(lte(journalEntries.entryDate, range.to))
      .groupBy(journalLines.accountId);
    const byId = new Map(rows.map((r) => [r.accountId, r]));
    const lines = all
      .map((a) => {
        const r = byId.get(a.id);
        const opening = Number(r?.opening ?? 0);
        const debit = Number(r?.debit ?? 0);
        const credit = Number(r?.credit ?? 0);
        return {
          code: a.code,
          name: a.name,
          openingMinor: opening,
          debitMinor: debit,
          creditMinor: credit,
          closingMinor: opening + debit - credit,
        };
      })
      .filter((l) => l.openingMinor !== 0 || l.debitMinor !== 0 || l.creditMinor !== 0);
    const totalDebit = lines.reduce((s, l) => s + l.debitMinor, 0);
    const totalCredit = lines.reduce((s, l) => s + l.creditMinor, 0);
    const closingSum = lines.reduce((s, l) => s + l.closingMinor, 0);
    return {
      from: range.from,
      to: range.to,
      accounts: lines,
      totalDebitMinor: totalDebit,
      totalCreditMinor: totalCredit,
      // Both hold in a sound ledger: the period's debits equal its credits, and the closing nets sum to zero.
      balanced: totalDebit === totalCredit && closingSum === 0,
    };
  }

  async profitLoss(range: RangeQuery) {
    const rows = await this.db
      .select({
        code: accounts.code,
        name: accounts.name,
        type: accounts.type,
        normal: accounts.normalBalance,
        net,
      })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
      .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
      .where(
        and(
          gte(journalEntries.entryDate, range.from),
          lte(journalEntries.entryDate, range.to),
          sql`${accounts.type} in ('REVENUE', 'COGS', 'EXPENSE')`,
        ),
      )
      .groupBy(accounts.code, accounts.name, accounts.type, accounts.normalBalance)
      .orderBy(asc(accounts.code));
    const line = (r: (typeof rows)[number]) => ({
      code: r.code,
      name: r.name,
      // Shown as the figure that adds to the statement: a contra account (returns, purchase returns) is negative.
      amountMinor: r.type === 'REVENUE' ? -Number(r.net) : Number(r.net),
    });
    const revenue = rows.filter((r) => r.type === 'REVENUE').map(line);
    const cogs = rows.filter((r) => r.type === 'COGS').map(line);
    const expenseLines = rows.filter((r) => r.type === 'EXPENSE').map(line);
    const netRevenue = revenue.reduce((s, l) => s + l.amountMinor, 0);
    const totalCogs = cogs.reduce((s, l) => s + l.amountMinor, 0);
    const grossProfit = netRevenue - totalCogs;
    const totalExpenses = expenseLines.reduce((s, l) => s + l.amountMinor, 0);
    const netProfit = grossProfit - totalExpenses;
    return {
      from: range.from,
      to: range.to,
      revenue,
      netRevenueMinor: netRevenue,
      cogs,
      totalCogsMinor: totalCogs,
      grossProfitMinor: grossProfit,
      grossMarginPct: pct(grossProfit, netRevenue),
      expenses: expenseLines,
      totalExpensesMinor: totalExpenses,
      netProfitMinor: netProfit,
      netMarginPct: pct(netProfit, netRevenue),
    };
  }

  async balanceSheet(query: AsOfQuery) {
    const asOf = query.asOf ?? businessDate();
    const rows = await this.db
      .select({
        code: accounts.code,
        name: accounts.name,
        type: accounts.type,
        normal: accounts.normalBalance,
        net,
      })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
      .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
      .where(lte(journalEntries.entryDate, asOf))
      .groupBy(accounts.code, accounts.name, accounts.type, accounts.normalBalance)
      .orderBy(asc(accounts.code));
    const signed = (r: (typeof rows)[number]) =>
      r.normal === 'DEBIT' ? Number(r.net) : -Number(r.net);
    const lineOf = (r: (typeof rows)[number]) => ({
      code: r.code,
      name: r.name,
      amountMinor: signed(r),
    });
    const assets = rows.filter((r) => r.type === 'ASSET').map(lineOf);
    const liabilities = rows.filter((r) => r.type === 'LIABILITY').map(lineOf);
    const equity = rows.filter((r) => r.type === 'EQUITY').map(lineOf);
    // Nothing closes the books at year end here, so all profit to date is shown as a single line.
    const profit = rows
      .filter((r) => ['REVENUE', 'COGS', 'EXPENSE'].includes(r.type))
      .reduce((s, r) => s - Number(r.net), 0);
    equity.push({ code: '', name: 'Profit to date', amountMinor: profit });
    const sum = (ls: { amountMinor: number }[]) => ls.reduce((s, l) => s + l.amountMinor, 0);
    const totalAssets = sum(assets);
    const totalLiabilities = sum(liabilities);
    const totalEquity = sum(equity);
    return {
      asOf,
      assets,
      totalAssetsMinor: totalAssets,
      liabilities,
      totalLiabilitiesMinor: totalLiabilities,
      equity,
      totalEquityMinor: totalEquity,
      balanced: totalAssets === totalLiabilities + totalEquity,
    };
  }

  /** Stock records against the inventory account: they must agree to the last santim. */
  async inventoryValuation() {
    const rows = await this.db
      .select()
      .from(products)
      .where(isNull(products.deletedAt))
      .orderBy(asc(products.name), asc(products.id));
    const items = rows.map((p) => ({
      productId: p.id,
      sku: p.sku,
      name: p.name,
      stock: p.currentStock,
      valueMinor: p.stockValueMinor,
      wacMinor: p.currentStock > 0 ? Math.round(p.stockValueMinor / p.currentStock) : null,
    }));
    // Deleted products still hold value only if they hold stock, which deletion forbids; sum them anyway.
    const [all] = await this.db
      .select({ value: sql<number>`coalesce(sum(${products.stockValueMinor}), 0)::bigint` })
      .from(products);
    const [inventory] = await this.db
      .select({ net })
      .from(journalLines)
      .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
      .where(eq(accounts.code, ACCOUNT.INVENTORY));
    const total = Number(all?.value ?? 0);
    const account = Number(inventory?.net ?? 0);
    return {
      products: items,
      totalValueMinor: total,
      inventoryAccountMinor: account,
      reconciled: total === account,
    };
  }

  // ---------- expenses ----------

  async createExpense(actor: Principal, input: CreateExpense): Promise<ExpenseDto> {
    return this.db.transaction(async (tx) => {
      const date = input.expenseDate ?? businessDate();
      const seq = await tx.execute<{ n: string }>(sql`select nextval('expense_number_seq') as n`);
      const number = `EXP-${String(seq.rows[0]!.n).padStart(6, '0')}`;
      const expenseId = crypto.randomUUID();
      const entry = await postJournalEntry(tx, {
        date,
        description: `Expense ${number}: ${input.description}`,
        referenceType: 'EXPENSE',
        referenceId: expenseId,
        createdBy: actor.userId,
        lines: [
          { accountCode: input.accountCode, debitMinor: input.amountMinor },
          { accountCode: settlementAccount(input.paymentMethod), creditMinor: input.amountMinor },
        ],
      });
      const [row] = await tx
        .insert(expenses)
        .values({
          id: expenseId,
          number,
          accountCode: input.accountCode,
          description: input.description,
          amountMinor: input.amountMinor,
          paymentMethod: input.paymentMethod,
          expenseDate: date,
          vendor: input.vendor ?? null,
          receiptNumber: input.receiptNumber ?? null,
          journalEntryId: entry.id,
          createdBy: actor.userId,
        })
        .returning();
      const dto = toExpenseDto(row!);
      await recordAudit(tx, {
        actor: actor.userId,
        action: 'expense.created',
        entityType: 'expense',
        entityId: dto.id,
        after: dto,
      });
      return dto;
    });
  }

  async listExpenses(query: ListExpensesQuery) {
    const where: SQL[] = [];
    if (query.accountCode) where.push(eq(expenses.accountCode, query.accountCode));
    if (query.from) where.push(gte(expenses.expenseDate, query.from));
    if (query.to) where.push(lte(expenses.expenseDate, query.to));
    const [rows, totals] = await Promise.all([
      this.db
        .select()
        .from(expenses)
        .where(and(...where))
        .orderBy(desc(expenses.expenseDate), desc(expenses.number))
        .limit(query.limit)
        .offset(query.offset),
      this.db
        .select({ total: count() })
        .from(expenses)
        .where(and(...where)),
    ]);
    return toPage(rows.map(toExpenseDto), totals[0]?.total ?? 0, query);
  }

  async getExpense(id: string): Promise<ExpenseDto> {
    const [row] = await this.db.select().from(expenses).where(eq(expenses.id, id));
    if (!row) throw notFound(`Expense ${id} does not exist`);
    return toExpenseDto(row);
  }

  /** An expense is never deleted: voiding it posts the reverse entry and keeps both on record. */
  async voidExpense(actor: Principal, id: string, input: VoidExpense): Promise<ExpenseDto> {
    return this.db.transaction(async (tx) => {
      const [expense] = await tx.select().from(expenses).where(eq(expenses.id, id)).for('update');
      if (!expense) throw notFound(`Expense ${id} does not exist`);
      if (expense.voidedAt) throw conflict('expense-already-voided', 'Expense is already voided');
      if (expense.journalEntryId) {
        await voidJournalEntry(tx, expense.journalEntryId, {
          userId: actor.userId,
          date: businessDate(),
          reason: input.reason,
        });
      }
      const [row] = await tx
        .update(expenses)
        .set({ voidedAt: sql`now()`, voidedBy: actor.userId, voidReason: input.reason })
        .where(eq(expenses.id, id))
        .returning();
      const after = toExpenseDto(row!);
      await recordAudit(tx, {
        actor: actor.userId,
        action: 'expense.voided',
        entityType: 'expense',
        entityId: id,
        before: toExpenseDto(expense),
        after,
      });
      return after;
    });
  }

  // ---------- opening balances ----------

  /**
   * Start the books: cash, bank and the stock on the shelf, balanced against the owner's capital.
   * It can only be done once, because a second "opening" would silently double the capital.
   */
  async openBooks(actor: Principal, input: OpeningBalance) {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('retail:opening-balances'))`);
      const [existing] = await tx
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.referenceType, 'OPENING_BALANCE'),
            eq(journalEntries.status, 'POSTED'),
          ),
        )
        .limit(1);
      if (existing) {
        throw conflict('books-already-opened', 'The books were already opened');
      }
      const openingId = crypto.randomUUID();
      const ordered = [...input.inventory].sort((a, b) => a.productId.localeCompare(b.productId));
      if (new Set(ordered.map((i) => i.productId)).size !== ordered.length) {
        throw conflict('duplicate-product', 'A product appears twice');
      }
      let inventoryValue = 0;
      for (const item of ordered) {
        const cost = item.quantity * item.unitCostMinor;
        await applyMovement(tx, {
          productId: item.productId,
          type: 'OPENING_BALANCE',
          quantity: item.quantity,
          totalCostMinor: cost,
          referenceType: 'OPENING_BALANCE',
          referenceId: openingId,
          createdBy: actor.userId,
        });
        inventoryValue += cost;
      }
      const total = input.cashMinor + input.bankMinor + inventoryValue;
      const lines: JournalLineInput[] = [
        { accountCode: ACCOUNT.CASH, debitMinor: input.cashMinor },
        { accountCode: ACCOUNT.BANK, debitMinor: input.bankMinor },
        { accountCode: ACCOUNT.INVENTORY, debitMinor: inventoryValue },
        // Owner's capital is the balancing figure: everything the business starts with, nothing owed.
        { accountCode: ACCOUNT.CAPITAL, creditMinor: total },
      ];
      const entry = await postJournalEntry(tx, {
        date: businessDate(),
        description: 'Opening balances',
        referenceType: 'OPENING_BALANCE',
        referenceId: openingId,
        createdBy: actor.userId,
        lines,
      });
      await recordAudit(tx, {
        actor: actor.userId,
        action: 'books.opened',
        entityType: 'journal-entry',
        entityId: entry.id,
        after: { totalMinor: total },
      });
      await tx
        .insert(outboxEvents)
        .values({ topic: 'books.opened', payload: { totalMinor: total } });
      return {
        entryNumber: entry.entryNumber,
        totalMinor: total,
        cashMinor: input.cashMinor,
        bankMinor: input.bankMinor,
        inventoryMinor: inventoryValue,
      };
    });
  }
}

export type { Pagination };
