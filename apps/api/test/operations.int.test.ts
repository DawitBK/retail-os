import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  getProduct,
  makeCategory,
  makeCustomer,
  makeProduct,
  makeStaff,
  makeSupplier,
  makeTeam,
  startContext,
  stockUp,
  type Session,
  type Staff,
  type TestContext,
} from './helpers.js';

let ctx: TestContext;
let team: Staff;
let electronics: string;
let supplierId: string;

beforeAll(async () => {
  ctx = await startContext();
  team = await makeTeam(ctx);
  electronics = await makeCategory(ctx, team.manager, 'ELECTRONICS');
  supplierId = await makeSupplier(ctx, team.manager);
});
afterAll(async () => {
  await ctx.close();
});

async function product(
  qty: number,
  cost: number,
  price: number,
  extra: Record<string, unknown> = {},
) {
  const p = await makeProduct(ctx, team.manager, electronics, {
    sellingPriceMinor: price,
    ...extra,
  });
  if (qty > 0) {
    await stockUp(ctx, team.manager, supplierId, [
      { productId: p.id, quantity: qty, unitCostMinor: cost },
    ]);
  }
  return p;
}

const sell = (who: Session, body: Record<string, unknown>) =>
  ctx.http().post('/api/v1/sales').set(who.auth).send(body);

async function linesOf(referenceType: string, referenceId: string) {
  const { rows } = await ctx.pool.query(
    `select a.code, l.debit_minor::int as debit, l.credit_minor::int as credit
       from journal_lines l
       join journal_entries e on e.id = l.entry_id
       join accounts a on a.id = l.account_id
      where e.reference_type = $1 and e.reference_id = $2
      order by a.code`,
    [referenceType, referenceId],
  );
  return rows as { code: string; debit: number; credit: number }[];
}

describe('returns', () => {
  it('takes restockable goods back: revenue and cost reverse and the stock returns at its cost', async () => {
    const p = await product(10, 40_000, 90_000);
    const sale = (
      await sell(team.cashier, { paymentMethod: 'CASH', items: [{ productId: p.id, quantity: 4 }] })
    ).body;
    const res = await ctx
      .http()
      .post(`/api/v1/sales/${sale.id}/returns`)
      .set(team.manager.auth)
      .send({
        reason: 'Wrong colour',
        refundMethod: 'CASH',
        items: [{ saleItemId: sale.items[0].id, quantity: 1, restockable: true }],
      });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      refundMinor: 90_000,
      cashRefundMinor: 90_000,
      appliedToReceivableMinor: 0,
    });
    expect(res.body.number).toMatch(/^RET-\d+$/);
    expect(await getProduct(ctx, team.manager, p.id)).toMatchObject({
      currentStock: 7,
      stockValueMinor: 280_000,
      wacMinor: 40_000,
    });
    expect(await linesOf('SALE_RETURN', res.body.id)).toEqual([
      { code: '1000', debit: 0, credit: 90_000 },
      { code: '1200', debit: 40_000, credit: 0 },
      { code: '4100', debit: 90_000, credit: 0 },
      { code: '5000', debit: 0, credit: 40_000 },
    ]);
  });

  it('refunds scrap without restocking it: the cost of that sale stays a cost', async () => {
    const p = await product(5, 10_000, 25_000);
    const sale = (
      await sell(team.cashier, { paymentMethod: 'CASH', items: [{ productId: p.id, quantity: 2 }] })
    ).body;
    const res = await ctx
      .http()
      .post(`/api/v1/sales/${sale.id}/returns`)
      .set(team.manager.auth)
      .send({
        reason: 'Arrived broken',
        refundMethod: 'MOBILE_MONEY',
        items: [{ saleItemId: await saleItemId(sale.id), quantity: 1, restockable: false }],
      });
    expect(res.status).toBe(201);
    expect(await getProduct(ctx, team.manager, p.id)).toMatchObject({ currentStock: 3 });
    expect(await linesOf('SALE_RETURN', res.body.id)).toEqual([
      { code: '1010', debit: 0, credit: 25_000 },
      { code: '4100', debit: 25_000, credit: 0 },
    ]);
  });

  it('returns a line in pieces that add up to exactly the whole line, and never more', async () => {
    const p = await product(10, 3_333, 10_000);
    const sale = (
      await sell(team.manager, {
        paymentMethod: 'CASH',
        items: [{ productId: p.id, quantity: 3, discountMinor: 1_000 }],
      })
    ).body;
    const itemId = await saleItemId(sale.id);
    let refunded = 0;
    for (let i = 0; i < 3; i += 1) {
      const res = await ctx
        .http()
        .post(`/api/v1/sales/${sale.id}/returns`)
        .set(team.manager.auth)
        .send({
          reason: 'One at a time',
          refundMethod: 'CASH',
          items: [{ saleItemId: itemId, quantity: 1, restockable: true }],
        });
      expect(res.status).toBe(201);
      refunded += res.body.refundMinor;
    }
    expect(refunded).toBe(29_000); // 3 x 10,000 less the 1,000 discount, to the santim
    expect(await getProduct(ctx, team.manager, p.id)).toMatchObject({
      currentStock: 10,
      stockValueMinor: 33_330,
    });
    const over = await ctx
      .http()
      .post(`/api/v1/sales/${sale.id}/returns`)
      .set(team.manager.auth)
      .send({
        reason: 'Too many',
        refundMethod: 'CASH',
        items: [{ saleItemId: itemId, quantity: 1, restockable: true }],
      });
    expect(over.status).toBe(422);
    expect(over.body.code).toBe('over-return');
    // A sale that has had returns can no longer be voided.
    const voided = await ctx
      .http()
      .post(`/api/v1/sales/${sale.id}/void`)
      .set(team.manager.auth)
      .send({ reason: 'Trying to void it too' });
    expect(voided.status).toBe(409);
  });

  it('cancels what a credit customer still owes before any cash goes back', async () => {
    const customerId = await makeCustomer(ctx, team.manager, 1_000_000);
    const p = await product(10, 20_000, 50_000);
    const sale = (
      await sell(team.cashier, {
        customerId,
        paymentMethod: 'CREDIT',
        amountPaidMinor: 10_000,
        items: [{ productId: p.id, quantity: 3 }],
      })
    ).body;
    expect(sale.outstandingMinor).toBe(140_000);
    const needsMethod = await ctx
      .http()
      .post(`/api/v1/sales/${sale.id}/returns`)
      .set(team.manager.auth)
      .send({
        reason: 'Changed mind',
        items: [{ saleItemId: await saleItemId(sale.id), quantity: 3, restockable: true }],
      });
    // 150,000 refund: 140,000 cancels the debt, 10,000 goes back, so a method is needed.
    expect(needsMethod.status).toBe(422);
    expect(needsMethod.body.code).toBe('refund-method-required');

    const res = await ctx
      .http()
      .post(`/api/v1/sales/${sale.id}/returns`)
      .set(team.manager.auth)
      .send({
        reason: 'Changed mind',
        refundMethod: 'CASH',
        items: [{ saleItemId: await saleItemId(sale.id), quantity: 3, restockable: true }],
      });
    expect(res.body).toMatchObject({
      refundMinor: 150_000,
      appliedToReceivableMinor: 140_000,
      cashRefundMinor: 10_000,
    });
    expect(
      (await ctx.http().get(`/api/v1/customers/${customerId}`).set(team.manager.auth)).body
        .outstandingMinor,
    ).toBe(0);
    expect(await linesOf('SALE_RETURN', res.body.id)).toEqual([
      { code: '1000', debit: 0, credit: 10_000 },
      { code: '1100', debit: 0, credit: 140_000 },
      { code: '1200', debit: 60_000, credit: 0 },
      { code: '4100', debit: 150_000, credit: 0 },
      { code: '5000', debit: 0, credit: 60_000 },
    ]);
  });

  it('is for managers, and cannot return what is not on the sale', async () => {
    const p = await product(5, 1_000, 2_000);
    const sale = (
      await sell(team.cashier, { paymentMethod: 'CASH', items: [{ productId: p.id, quantity: 1 }] })
    ).body;
    const body = {
      reason: 'Nope',
      refundMethod: 'CASH',
      items: [{ saleItemId: await saleItemId(sale.id), quantity: 1, restockable: true }],
    };
    expect(
      (await ctx.http().post(`/api/v1/sales/${sale.id}/returns`).set(team.cashier.auth).send(body))
        .status,
    ).toBe(403);
    const foreign = await ctx
      .http()
      .post(`/api/v1/sales/${sale.id}/returns`)
      .set(team.manager.auth)
      .send({ ...body, items: [{ ...body.items[0], saleItemId: randomUUID() }] });
    expect(foreign.status).toBe(422);
    expect(
      (
        await ctx
          .http()
          .post(`/api/v1/sales/${randomUUID()}/returns`)
          .set(team.manager.auth)
          .send(body)
      ).status,
    ).toBe(404);
    const list = await ctx
      .http()
      .get(`/api/v1/returns?saleId=${sale.id}`)
      .set(team.accountant.auth);
    expect(list.status).toBe(200);
  });
});

async function saleItemId(saleId: string): Promise<string> {
  const { rows } = await ctx.pool.query('select id from sale_items where sale_id = $1 limit 1', [
    saleId,
  ]);
  return rows[0].id as string;
}

describe('damage and write-off', () => {
  it('stays on paper until a different manager approves it, then takes the stock out and books the loss', async () => {
    const p = await product(10, 30_000, 60_000);
    const reporter = await makeStaff(ctx, 'cashier');
    const report = await ctx
      .http()
      .post('/api/v1/damage')
      .set(reporter.auth)
      .send({ productId: p.id, kind: 'DAMAGE', quantity: 2, cause: 'Dropped in the store room' });
    expect(report.status).toBe(201);
    expect(report.body).toMatchObject({
      status: 'PENDING',
      number: expect.stringMatching(/^DMG-\d+$/),
    });
    // Nothing moves until it is approved.
    expect(await getProduct(ctx, team.manager, p.id)).toMatchObject({ currentStock: 10 });

    const manager = await makeStaff(ctx, 'manager');
    const approved = await ctx
      .http()
      .post(`/api/v1/damage/${report.body.id}/approve`)
      .set(manager.auth)
      .send({});
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({ status: 'APPROVED', lossMinor: 60_000 });
    expect(await getProduct(ctx, team.manager, p.id)).toMatchObject({
      currentStock: 8,
      stockValueMinor: 240_000,
    });
    expect(await linesOf('DAMAGE', report.body.id)).toEqual([
      { code: '1200', debit: 0, credit: 60_000 },
      { code: '6100', debit: 60_000, credit: 0 },
    ]);
    expect(
      (await ctx.http().post(`/api/v1/damage/${report.body.id}/approve`).set(manager.auth).send({}))
        .status,
    ).toBe(409);
  });

  it('never lets someone approve their own report, and books write-offs separately', async () => {
    const p = await product(10, 10_000, 20_000);
    const manager = await makeStaff(ctx, 'manager');
    const report = (
      await ctx.http().post('/api/v1/damage').set(manager.auth).send({
        productId: p.id,
        kind: 'WRITE_OFF',
        quantity: 1,
        cause: 'Water damage, unrecoverable',
      })
    ).body;
    const self = await ctx
      .http()
      .post(`/api/v1/damage/${report.id}/approve`)
      .set(manager.auth)
      .send({});
    expect(self.status).toBe(403);
    expect(self.body.code).toBe('self-approval');
    // The database enforces it as well.
    await expect(
      ctx.pool.query(`update damage_records set decided_by = reported_by where id = $1`, [
        report.id,
      ]),
    ).rejects.toThrow(/damage_records_separation/);

    const owner = await makeStaff(ctx, 'owner');
    const ok = await ctx
      .http()
      .post(`/api/v1/damage/${report.id}/approve`)
      .set(owner.auth)
      .send({});
    expect(ok.body.status).toBe('APPROVED');
    expect(await linesOf('DAMAGE', report.id)).toEqual([
      { code: '1200', debit: 0, credit: 10_000 },
      { code: '6110', debit: 10_000, credit: 0 },
    ]);
  });

  it('can be rejected with a reason, leaving stock and books alone', async () => {
    const p = await product(5, 1_000, 2_000);
    const report = (
      await ctx
        .http()
        .post('/api/v1/damage')
        .set(team.cashier.auth)
        .send({ productId: p.id, kind: 'DAMAGE', quantity: 1, cause: 'Scratched box' })
    ).body;
    const noNote = await ctx
      .http()
      .post(`/api/v1/damage/${report.id}/reject`)
      .set(team.manager.auth)
      .send({});
    expect(noNote.status).toBe(400);
    const rejected = await ctx
      .http()
      .post(`/api/v1/damage/${report.id}/reject`)
      .set(team.manager.auth)
      .send({ note: 'The box is fine, sell it' });
    expect(rejected.body.status).toBe('REJECTED');
    expect(await getProduct(ctx, team.manager, p.id)).toMatchObject({ currentStock: 5 });
    expect(await linesOf('DAMAGE', report.id)).toEqual([]);
    const pending = await ctx.http().get('/api/v1/damage?status=PENDING').set(team.accountant.auth);
    expect(pending.body.items.map((d: { id: string }) => d.id)).not.toContain(report.id);
  });

  it('refuses to approve a loss bigger than the stock', async () => {
    const p = await product(2, 1_000, 2_000);
    const report = (
      await ctx
        .http()
        .post('/api/v1/damage')
        .set(team.cashier.auth)
        .send({ productId: p.id, kind: 'DAMAGE', quantity: 5, cause: 'Flood in the shop' })
    ).body;
    const res = await ctx
      .http()
      .post(`/api/v1/damage/${report.id}/approve`)
      .set(team.manager.auth)
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('insufficient-stock');
    expect(await getProduct(ctx, team.manager, p.id)).toMatchObject({ currentStock: 2 });
  });
});

describe('stock audits', () => {
  it('counts the shelf, needs every product counted, and posts shrinkage when a different manager approves', async () => {
    const short = await product(10, 5_000, 9_000);
    const over = await product(4, 8_000, 12_000);
    const same = await product(6, 1_000, 2_000);
    const starter = await makeStaff(ctx, 'manager');
    const audit = await ctx
      .http()
      .post('/api/v1/stock-audits')
      .set(starter.auth)
      .send({ productIds: [short.id, over.id, same.id], notes: 'Monthly count' });
    expect(audit.status).toBe(201);
    expect(audit.body).toMatchObject({
      status: 'IN_PROGRESS',
      number: expect.stringMatching(/^AUD-\d+$/),
    });

    const early = await ctx
      .http()
      .post(`/api/v1/stock-audits/${audit.body.id}/submit`)
      .set(starter.auth);
    expect(early.status).toBe(422);
    expect(early.body.code).toBe('uncounted-items');

    const counted = await ctx
      .http()
      .post(`/api/v1/stock-audits/${audit.body.id}/counts`)
      .set(team.cashier.auth)
      .send({
        counts: [
          { productId: short.id, physicalQty: 8 },
          { productId: over.id, physicalQty: 5 },
          { productId: same.id, physicalQty: 6 },
        ],
      });
    expect(counted.status).toBe(200);
    expect(counted.body.shortageUnits).toBe(2);
    expect(counted.body.overageUnits).toBe(1);

    // A sale after the count must not be undone by approving it.
    await sell(team.cashier, {
      paymentMethod: 'CASH',
      items: [{ productId: short.id, quantity: 1 }],
    });

    await ctx.http().post(`/api/v1/stock-audits/${audit.body.id}/submit`).set(starter.auth);
    const self = await ctx
      .http()
      .post(`/api/v1/stock-audits/${audit.body.id}/approve`)
      .set(starter.auth);
    expect(self.status).toBe(403);
    expect(self.body.code).toBe('self-approval');

    const approver = await makeStaff(ctx, 'manager');
    const done = await ctx
      .http()
      .post(`/api/v1/stock-audits/${audit.body.id}/approve`)
      .set(approver.auth);
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('APPROVED');
    // short: 10 counted as 8 (-2), then one sold: 7. over: 4 counted as 5 (+1), valued at the average.
    expect(await getProduct(ctx, team.manager, short.id)).toMatchObject({
      currentStock: 7,
      stockValueMinor: 35_000,
    });
    expect(await getProduct(ctx, team.manager, over.id)).toMatchObject({
      currentStock: 5,
      stockValueMinor: 40_000,
    });
    // Net: shortage of 10,000 and found stock of 8,000 post as one entry of 2,000 shrinkage.
    expect(await linesOf('STOCK_AUDIT', audit.body.id)).toEqual([
      { code: '1200', debit: 0, credit: 2_000 },
      { code: '6120', debit: 2_000, credit: 0 },
    ]);
    expect(
      (await ctx.http().post(`/api/v1/stock-audits/${audit.body.id}/approve`).set(approver.auth))
        .status,
    ).toBe(409);
  });

  it('can be cancelled, and only managers start or decide a count', async () => {
    const p = await product(3, 1_000, 2_000);
    expect(
      (
        await ctx
          .http()
          .post('/api/v1/stock-audits')
          .set(team.cashier.auth)
          .send({ productIds: [p.id] })
      ).status,
    ).toBe(403);
    const audit = (
      await ctx
        .http()
        .post('/api/v1/stock-audits')
        .set(team.manager.auth)
        .send({ productIds: [p.id] })
    ).body;
    const notInCount = await ctx
      .http()
      .post(`/api/v1/stock-audits/${audit.id}/counts`)
      .set(team.manager.auth)
      .send({ counts: [{ productId: randomUUID(), physicalQty: 1 }] });
    expect(notInCount.status).toBe(422);
    const cancelled = await ctx
      .http()
      .post(`/api/v1/stock-audits/${audit.id}/cancel`)
      .set(team.manager.auth);
    expect(cancelled.body.status).toBe('CANCELLED');
    expect(
      (await ctx.http().post(`/api/v1/stock-audits/${audit.id}/cancel`).set(team.manager.auth))
        .status,
    ).toBe(409);
    expect((await ctx.http().get('/api/v1/stock-audits').set(team.accountant.auth)).status).toBe(
      200,
    );
  });
});

describe('alerts and the dashboard', () => {
  it('raises alerts from the live data and clears them when the cause is fixed', async () => {
    const out = await product(0, 0, 5_000, { reorderPoint: 3 });
    const low = await product(2, 1_000, 5_000, { reorderPoint: 5 });
    const loss = await product(3, 9_000, 5_000, { reorderPoint: 0 });
    const alerts = (await ctx.http().get('/api/v1/alerts').set(team.accountant.auth)).body;
    const has = (type: string, id: string) =>
      alerts.alerts.some(
        (a: { type: string; productId: string }) => a.type === type && a.productId === id,
      );
    expect(has('OUT_OF_STOCK', out.id)).toBe(true);
    expect(has('LOW_STOCK', low.id)).toBe(true);
    expect(has('NEGATIVE_MARGIN', loss.id)).toBe(true);
    expect(alerts.counts.critical).toBeGreaterThan(0);
    expect(alerts.alerts[0].severity).toBe('CRITICAL');

    await stockUp(ctx, team.manager, supplierId, [
      { productId: out.id, quantity: 20, unitCostMinor: 1_000 },
    ]);
    const after = (await ctx.http().get('/api/v1/alerts').set(team.manager.auth)).body;
    expect(
      after.alerts.some(
        (a: { type: string; productId: string }) =>
          a.type === 'OUT_OF_STOCK' && a.productId === out.id,
      ),
    ).toBe(false);
    expect((await ctx.http().get('/api/v1/alerts').set(team.cashier.auth)).status).toBe(403);
    expect((await ctx.http().get('/api/v1/alerts/count').set(team.cashier.auth)).status).toBe(200);
  });

  it('reports a dashboard that agrees with the books', async () => {
    const p = await product(10, 40_000, 100_000);
    const before = (await ctx.http().get('/api/v1/dashboard').set(team.manager.auth)).body;
    await sell(team.cashier, { paymentMethod: 'CASH', items: [{ productId: p.id, quantity: 2 }] });
    const after = (await ctx.http().get('/api/v1/dashboard').set(team.manager.auth)).body;
    expect(after.today.revenueMinor - before.today.revenueMinor).toBe(200_000);
    expect(after.today.cogsMinor - before.today.cogsMinor).toBe(80_000);
    expect(after.today.transactions - before.today.transactions).toBe(1);
    expect(after.monthToDate.revenueMinor).toBeGreaterThanOrEqual(after.today.revenueMinor);
    expect(after.revenue30Days).toHaveLength(30);
    expect(after.revenue30Days.at(-1).date).toBe(after.asOf);
    expect(after.topProducts.length).toBeGreaterThan(0);
    expect(after.cash.cashInHandMinor - before.cash.cashInHandMinor).toBe(200_000);
    expect(after.inventory.totalValueMinor).toBe(
      (await ctx.http().get('/api/v1/inventory/valuation').set(team.manager.auth)).body
        .totalValueMinor - (await inactiveStockValue()),
    );
  });

  it('keeps the shelf and the inventory account in exact agreement after all of it', async () => {
    const valuation = (
      await ctx.http().get('/api/v1/inventory/valuation').set(team.accountant.auth)
    ).body;
    expect(valuation.reconciled).toBe(true);
    const tb = (
      await ctx
        .http()
        .get('/api/v1/accounting/trial-balance?from=2000-01-01&to=2100-01-01')
        .set(team.accountant.auth)
    ).body;
    expect(tb.balanced).toBe(true);
    const bs = (await ctx.http().get('/api/v1/accounting/balance-sheet').set(team.accountant.auth))
      .body;
    expect(bs.balanced).toBe(true);
  });
});

/** Stock value of discontinued products, which the dashboard leaves out of its (active) total. */
async function inactiveStockValue(): Promise<number> {
  const { rows } = await ctx.pool.query(
    `select coalesce(sum(stock_value_minor), 0)::bigint as v from products
      where deleted_at is not null or status <> 'ACTIVE'`,
  );
  return Number(rows[0].v);
}
