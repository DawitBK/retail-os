import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTeam, startContext, type Staff, type TestContext } from './helpers.js';

let ctx: TestContext;
let team: Staff;

beforeAll(async () => {
  ctx = await startContext();
  team = await makeTeam(ctx);
});
afterAll(async () => {
  await ctx.close();
});

/**
 * A balanced entry in a far-past year, written straight into the journal. It uses accounts nothing
 * else reconciles against (drawings, capital, revenue, expenses), so the other suites that share this
 * database are not disturbed.
 */
async function seed(date: string, description: string, lines: [string, number, number][]) {
  const total = lines.reduce((s, l) => s + l[1], 0);
  const client = await ctx.pool.connect();
  try {
    await client.query('begin');
    const { rows } = await client.query<{ id: string }>(
      `insert into journal_entries (entry_number, entry_date, description, total_minor, created_by)
       values ($1, $2, $3, $4, $5) returning id`,
      [`JE-T${randomUUID().slice(0, 8)}`, date, description, total, team.owner.id],
    );
    for (const [code, debit, credit] of lines) {
      await client.query(
        `insert into journal_lines (entry_id, account_id, debit_minor, credit_minor)
         select $1, id, $3, $4 from accounts where code = $2`,
        [rows[0]!.id, code, debit, credit],
      );
    }
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

const closeYear = (year: number, who = team.owner) =>
  ctx.http().post('/api/v1/accounting/close-year').set(who.auth).send({ year });

async function postedLines(referenceType: string) {
  const { rows } = await ctx.pool.query(
    `select a.code, l.debit_minor::int as debit, l.credit_minor::int as credit
       from journal_lines l
       join journal_entries e on e.id = l.entry_id
       join accounts a on a.id = l.account_id
      where e.reference_type = $1 and e.entry_date = '2019-12-31'
      order by a.code`,
    [referenceType],
  );
  return rows as { code: string; debit: number; credit: number }[];
}

describe('closing a financial year', () => {
  it('needs the year to be over and the owner to ask', async () => {
    const thisYear = new Date().getFullYear();
    const early = await closeYear(thisYear);
    expect(early.status).toBe(422);
    expect(early.body.code).toBe('year-not-over');
    for (const who of [team.manager, team.accountant, team.cashier]) {
      expect((await closeYear(2019, who)).status).toBe(403);
    }
    expect(
      (await ctx.http().post('/api/v1/accounting/close-year').send({ year: 2019 })).status,
    ).toBe(401);
    const periods = await ctx.http().get('/api/v1/accounting/periods').set(team.accountant.auth);
    expect(periods.status).toBe(200);
    expect((await ctx.http().get('/api/v1/accounting/periods').set(team.cashier.auth)).status).toBe(
      403,
    );
  });

  it('moves the profit into retained earnings with one entry and locks the books', async () => {
    await seed('2019-06-01', 'Test sales', [
      ['3200', 100_000, 0],
      ['4000', 0, 100_000],
    ]);
    await seed('2019-07-01', 'Test expense', [
      ['6000', 30_000, 0],
      ['3000', 0, 30_000],
    ]);

    const r = await closeYear(2019);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({
      fiscalYear: 2019,
      closedThrough: '2019-12-31',
      netProfitMinor: 70_000,
    });
    expect(r.body.entryNumber).toMatch(/^JE-/);
    expect(await postedLines('YEAR_CLOSE')).toEqual([
      { code: '3100', debit: 0, credit: 70_000 },
      { code: '4000', debit: 100_000, credit: 0 },
      { code: '6000', debit: 0, credit: 30_000 },
    ]);

    const periods = (await ctx.http().get('/api/v1/accounting/periods').set(team.accountant.auth))
      .body;
    expect(periods.closedThrough).toBe('2019-12-31');
    expect(periods.closes[0]).toMatchObject({ fiscalYear: 2019, netProfitMinor: 70_000 });
  });

  it("leaves the closed year's profit and loss and the balance sheet intact", async () => {
    const pl = await ctx
      .http()
      .get('/api/v1/accounting/profit-loss?from=2019-01-01&to=2019-12-31')
      .set(team.accountant.auth);
    expect(pl.body).toMatchObject({
      netRevenueMinor: 100_000,
      totalExpensesMinor: 30_000,
      netProfitMinor: 70_000,
    });
    const sheet = await ctx
      .http()
      .get('/api/v1/accounting/balance-sheet?asOf=2019-12-31')
      .set(team.accountant.auth);
    expect(sheet.body.balanced).toBe(true);
    const retained = sheet.body.equity.find((l: { code: string }) => l.code === '3100');
    expect(retained.amountMinor).toBe(70_000);
    const tb = await ctx
      .http()
      .get('/api/v1/accounting/trial-balance?from=2019-01-01&to=2019-12-31')
      .set(team.accountant.auth);
    expect(tb.body.balanced).toBe(true);
  });

  it('refuses anything dated in a closed year, in the application and in the database', async () => {
    const expense = await ctx.http().post('/api/v1/expenses').set(team.manager.auth).send({
      accountCode: '6000',
      description: 'Back-dated',
      amountMinor: 1_000,
      paymentMethod: 'CASH',
      expenseDate: '2019-05-05',
    });
    expect(expense.status).toBe(409);
    expect(expense.body.code).toBe('period-closed');

    await expect(
      ctx.pool.query(
        `insert into journal_entries (entry_number, entry_date, description, total_minor, created_by)
         values ('JE-T-LATE', '2019-12-31', 'Sneaked in', 1, $1)`,
        [team.owner.id],
      ),
    ).rejects.toThrow(/books are closed/);
    // The first day after the close is open.
    const open = await ctx.http().post('/api/v1/expenses').set(team.manager.auth).send({
      accountCode: '6000',
      description: 'Fresh year',
      amountMinor: 1_000,
      paymentMethod: 'CASH',
      expenseDate: '2020-01-01',
    });
    expect(open.status).toBe(201);
  });

  it('closes years once, in order, and never undoes one', async () => {
    expect((await closeYear(2019)).body.code).toBe('year-already-closed');
    expect((await closeYear(2018)).body.code).toBe('year-already-closed');
    const skip = await closeYear(2021);
    expect(skip.status).toBe(409);
    expect(skip.body.code).toBe('years-must-close-in-order');

    // 2020 holds the one expense above, so it closes as a small loss.
    const next = await closeYear(2020);
    expect(next.status).toBe(201);
    expect(next.body.netProfitMinor).toBe(-1_000);

    await expect(
      ctx.pool.query(`update period_closes set net_profit_minor = 0 where fiscal_year = 2019`),
    ).rejects.toThrow(/cannot be changed or reopened/);
    await expect(
      ctx.pool.query(`delete from period_closes where fiscal_year = 2019`),
    ).rejects.toThrow(/cannot be changed or reopened/);
  });
});
