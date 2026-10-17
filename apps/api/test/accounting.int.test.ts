import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  makeCategory,
  makeProduct,
  makeSupplier,
  makeTeam,
  startContext,
  stockUp,
  TODAY_RANGE,
  type Staff,
  type TestContext,
} from './helpers.js';

let ctx: TestContext;
let team: Staff;
let categoryId: string;
let supplierId: string;

beforeAll(async () => {
  ctx = await startContext();
  team = await makeTeam(ctx);
  categoryId = await makeCategory(ctx, team.manager);
  supplierId = await makeSupplier(ctx, team.manager);
});
afterAll(async () => {
  await ctx.close();
});

const range = TODAY_RANGE();
const get = (path: string, who = team.accountant) => ctx.http().get(`/api/v1${path}`).set(who.auth);

describe('opening the books', () => {
  it('starts the business with cash, bank and stock against the owner capital, exactly once', async () => {
    const p = await makeProduct(ctx, team.manager, categoryId, { sellingPriceMinor: 5_000 });
    const body = {
      cashMinor: 85_000_00,
      bankMinor: 120_000_00,
      inventory: [{ productId: p.id, quantity: 100, unitCostMinor: 2_000 }],
    };
    expect(
      (await ctx.http().post('/api/v1/opening-balances').set(team.manager.auth).send(body)).status,
    ).toBe(403);
    const chartBefore = (await get('/accounting/accounts')).body as {
      code: string;
      balanceMinor: number;
    }[];
    const opened = await ctx
      .http()
      .post('/api/v1/opening-balances')
      .set(team.owner.auth)
      .send(body);
    expect(opened.status).toBe(201);
    expect(opened.body).toMatchObject({
      cashMinor: 8_500_000,
      bankMinor: 12_000_000,
      inventoryMinor: 200_000,
      totalMinor: 20_700_000,
    });

    const chart = (await get('/accounting/accounts')).body as {
      code: string;
      balanceMinor: number;
    }[];
    const moved = (code: string) =>
      chart.find((a) => a.code === code)!.balanceMinor -
      chartBefore.find((a) => a.code === code)!.balanceMinor;
    expect(moved('1000')).toBe(8_500_000);
    expect(moved('1010')).toBe(12_000_000);
    expect(moved('1200')).toBe(200_000);
    expect(moved('3000')).toBe(20_700_000);

    const again = await ctx
      .http()
      .post('/api/v1/opening-balances')
      .set(team.owner.auth)
      .send({ cashMinor: 1 });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('books-already-opened');
    expect(
      (await ctx.http().post('/api/v1/opening-balances').set(team.owner.auth).send({})).status,
    ).toBe(400);
  });
});

describe('the statements', () => {
  it('reports exactly what a day of trading did to profit and loss', async () => {
    const p = await makeProduct(ctx, team.manager, categoryId, { sellingPriceMinor: 100_000 });
    await stockUp(ctx, team.manager, supplierId, [
      { productId: p.id, quantity: 10, unitCostMinor: 40_000 },
    ]);
    const before = (await get(`/accounting/profit-loss?${range}`)).body;
    const sale = await ctx
      .http()
      .post('/api/v1/sales')
      .set(team.cashier.auth)
      .send({ paymentMethod: 'CASH', items: [{ productId: p.id, quantity: 3 }] });
    expect(sale.status).toBe(201);
    const rent = await ctx.http().post('/api/v1/expenses').set(team.accountant.auth).send({
      accountCode: '6000',
      description: 'October rent',
      amountMinor: 50_000,
      paymentMethod: 'CASH',
    });
    expect(rent.status).toBe(201);
    const after = (await get(`/accounting/profit-loss?${range}`)).body;

    expect(after.netRevenueMinor - before.netRevenueMinor).toBe(300_000);
    expect(after.totalCogsMinor - before.totalCogsMinor).toBe(120_000);
    expect(after.grossProfitMinor - before.grossProfitMinor).toBe(180_000);
    expect(after.totalExpensesMinor - before.totalExpensesMinor).toBe(50_000);
    expect(after.netProfitMinor - before.netProfitMinor).toBe(130_000);
    expect(after.revenue.find((l: { code: string }) => l.code === '4000')).toBeTruthy();
    expect(after.expenses.find((l: { code: string }) => l.code === '6000')).toBeTruthy();
  });

  it('has a trial balance whose debits equal its credits', async () => {
    const tb = (await get(`/accounting/trial-balance?${range}`)).body;
    expect(tb.balanced).toBe(true);
    expect(tb.totalDebitMinor).toBe(tb.totalCreditMinor);
    const sum = tb.accounts.reduce(
      (s: number, a: { closingMinor: number }) => s + a.closingMinor,
      0,
    );
    expect(sum).toBe(0);
  });

  it('has a balance sheet where assets equal liabilities plus equity', async () => {
    const bs = (await get('/accounting/balance-sheet')).body;
    expect(bs.balanced).toBe(true);
    expect(bs.totalAssetsMinor).toBe(bs.totalLiabilitiesMinor + bs.totalEquityMinor);
    expect(bs.assets.find((l: { code: string }) => l.code === '1200')).toBeTruthy();
    expect(bs.equity.find((l: { name: string }) => l.name === 'Profit to date')).toBeTruthy();
    expect((await get('/accounting/balance-sheet?asOf=2020-01-01')).body.balanced).toBe(true);
    expect((await get('/accounting/trial-balance?from=2026-02-01&to=2026-01-01')).status).toBe(400);
    expect((await get('/accounting/profit-loss')).status).toBe(400);
  });

  it('shows an account ledger whose running balance ends at the account balance', async () => {
    const ledger = (await get('/accounting/ledger/1000?limit=100')).body;
    expect(ledger.account.code).toBe('1000');
    expect(ledger.items.length).toBeGreaterThan(1);
    const last = ledger.items[ledger.items.length - 1];
    if (ledger.page.total === ledger.items.length) {
      expect(last.runningBalanceMinor).toBe(ledger.account.balanceMinor);
    }
    const paged = (await get('/accounting/ledger/1000?limit=1&offset=1')).body;
    expect(paged.items).toHaveLength(1);
    expect(paged.items[0].entryNumber).toBe(ledger.items[1].entryNumber);
    expect((await get('/accounting/ledger/9999')).status).toBe(404);
    expect((await get('/accounting/ledger/abc')).status).toBe(400);
  });

  it('lists the journal with each entry fully balanced', async () => {
    const page = (await get('/accounting/journal?limit=50&referenceType=SALE')).body;
    expect(page.items.length).toBeGreaterThan(0);
    for (const entry of page.items) {
      const debit = entry.lines.reduce(
        (s: number, l: { debitMinor: number }) => s + l.debitMinor,
        0,
      );
      const credit = entry.lines.reduce(
        (s: number, l: { creditMinor: number }) => s + l.creditMinor,
        0,
      );
      expect(debit).toBe(credit);
      expect(debit).toBe(entry.totalMinor);
    }
  });

  it('keeps the stock records and the inventory account in exact agreement', async () => {
    const valuation = (await get('/inventory/valuation')).body;
    expect(valuation.reconciled).toBe(true);
    expect(valuation.totalValueMinor).toBe(valuation.inventoryAccountMinor);
    const sum = valuation.products.reduce(
      (s: number, p: { valueMinor: number }) => s + p.valueMinor,
      0,
    );
    expect(sum).toBe(valuation.totalValueMinor);
  });
});

describe('expenses', () => {
  it('posts to the right account and the right till, and can only be voided by a manager', async () => {
    const created = await ctx.http().post('/api/v1/expenses').set(team.accountant.auth).send({
      accountCode: '6010',
      description: 'Electricity',
      amountMinor: 12_345,
      paymentMethod: 'BANK_TRANSFER',
      vendor: 'EEU',
      receiptNumber: 'R-77',
    });
    expect(created.status).toBe(201);
    expect(created.body.number).toMatch(/^EXP-\d+$/);
    const lines = await ctx.pool.query(
      `select a.code, l.debit_minor::int as debit, l.credit_minor::int as credit
         from journal_lines l join accounts a on a.id = l.account_id
        where l.entry_id = (select journal_entry_id from expenses where id = $1) order by a.code`,
      [created.body.id],
    );
    expect(lines.rows).toEqual([
      { code: '1010', debit: 0, credit: 12_345 },
      { code: '6010', debit: 12_345, credit: 0 },
    ]);

    const byAccountant = await ctx
      .http()
      .post(`/api/v1/expenses/${created.body.id}/void`)
      .set(team.accountant.auth)
      .send({ reason: 'Entered twice' });
    expect(byAccountant.status).toBe(403);
    const voided = await ctx
      .http()
      .post(`/api/v1/expenses/${created.body.id}/void`)
      .set(team.manager.auth)
      .send({ reason: 'Entered twice' });
    expect(voided.body).toMatchObject({ voided: true, voidReason: 'Entered twice' });
    expect(
      (
        await ctx
          .http()
          .post(`/api/v1/expenses/${created.body.id}/void`)
          .set(team.manager.auth)
          .send({ reason: 'Entered twice' })
      ).status,
    ).toBe(409);
    const net = await ctx.pool.query(
      `select coalesce(sum(l.debit_minor - l.credit_minor), 0)::int as net
         from journal_lines l join journal_entries e on e.id = l.entry_id
        where e.reference_id = $1
           or e.reverses_entry_id = (select journal_entry_id from expenses where id = $1)`,
      [created.body.id],
    );
    expect(net.rows[0].net).toBe(0);
  });

  it('accepts only expense accounts, whole positive amounts and known payment methods', async () => {
    const send = (extra: Record<string, unknown>) =>
      ctx
        .http()
        .post('/api/v1/expenses')
        .set(team.accountant.auth)
        .send({
          accountCode: '6900',
          description: 'Misc',
          amountMinor: 100,
          paymentMethod: 'CASH',
          ...extra,
        });
    expect((await send({})).status).toBe(201);
    expect((await send({ accountCode: '4000' })).status).toBe(400); // revenue
    expect((await send({ accountCode: '6100' })).status).toBe(400); // losses are posted by the system
    expect((await send({ amountMinor: 0 })).status).toBe(400);
    expect((await send({ amountMinor: 1.5 })).status).toBe(400);
    expect((await send({ paymentMethod: 'CREDIT' })).status).toBe(400);
    const list = await get('/expenses?limit=5&accountCode=6900');
    expect(list.status).toBe(200);
    expect(list.body.items.length).toBeGreaterThan(0);
    expect((await ctx.http().post('/api/v1/expenses').set(team.cashier.auth).send({})).status).toBe(
      403,
    );
    expect((await get(`/expenses/${randomUUID()}`)).status).toBe(404);
  });
});
