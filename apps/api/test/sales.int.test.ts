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
  TODAY_RANGE,
  type Session,
  type Staff,
  type TestContext,
} from './helpers.js';

let ctx: TestContext;
let team: Staff;
let electronics: string;
let stationery: string;
let supplierId: string;

beforeAll(async () => {
  ctx = await startContext();
  team = await makeTeam(ctx);
  electronics = await makeCategory(ctx, team.manager, 'ELECTRONICS');
  stationery = await makeCategory(ctx, team.manager, 'STATIONERY');
  supplierId = await makeSupplier(ctx, team.manager);
});
afterAll(async () => {
  await ctx.close();
});

/** A product with `qty` units bought at `cost` each and a list price of `price`. */
async function product(
  qty: number,
  cost: number,
  price: number,
  extra: Record<string, unknown> = {},
  categoryId = electronics,
) {
  const p = await makeProduct(ctx, team.manager, categoryId, {
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

const sell = (who: Session, body: Record<string, unknown>, key?: string) => {
  const req = ctx.http().post('/api/v1/sales').set(who.auth);
  if (key) req.set('Idempotency-Key', key);
  return req.send(body);
};

async function entryLines(saleId: string) {
  const { rows } = await ctx.pool.query(
    `select a.code, l.debit_minor::int as debit, l.credit_minor::int as credit
       from journal_lines l
       join accounts a on a.id = l.account_id
      where l.entry_id = (select journal_entry_id from sales where id = $1)
      order by a.code`,
    [saleId],
  );
  return rows as { code: string; debit: number; credit: number }[];
}

describe('a cash sale', () => {
  it('prices the lines, takes stock at cost and posts revenue and cost together', async () => {
    const p = await product(20, 60_000, 120_000);
    const res = await sell(team.cashier, {
      paymentMethod: 'CASH',
      amountPaidMinor: 400_000,
      items: [{ productId: p.id, quantity: 3 }],
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: 'COMPLETED',
      subtotalMinor: 360_000,
      totalMinor: 360_000,
      cogsMinor: 180_000,
      grossProfitMinor: 180_000,
      amountPaidMinor: 400_000,
      changeGivenMinor: 40_000,
      outstandingMinor: 0,
    });
    expect(res.body.number).toMatch(/^S-\d+$/);
    expect(res.body.journalEntryNumber).toMatch(/^JE-\d+$/);
    // Stock fell and its value fell by exactly the cost that left.
    expect(await getProduct(ctx, team.manager, p.id)).toMatchObject({
      currentStock: 17,
      stockValueMinor: 1_020_000,
      wacMinor: 60_000,
    });
    expect(await entryLines(res.body.id)).toEqual([
      { code: '1000', debit: 360_000, credit: 0 },
      { code: '1200', debit: 0, credit: 180_000 },
      { code: '4000', debit: 0, credit: 360_000 },
      { code: '5000', debit: 180_000, credit: 0 },
    ]);
  });

  it('books stationery to its own revenue and cost accounts, and bank payments to the bank', async () => {
    const p = await product(10, 10_000, 25_000, {}, stationery);
    const res = await sell(team.manager, {
      paymentMethod: 'MOBILE_MONEY',
      items: [{ productId: p.id, quantity: 2 }],
    });
    expect(res.status).toBe(201);
    expect(await entryLines(res.body.id)).toEqual([
      { code: '1010', debit: 50_000, credit: 0 },
      { code: '1200', debit: 0, credit: 20_000 },
      { code: '4010', debit: 0, credit: 50_000 },
      { code: '5010', debit: 20_000, credit: 0 },
    ]);
  });

  it('splits a basket across both kinds of product in one balanced entry', async () => {
    const a = await product(5, 30_000, 50_000);
    const b = await product(5, 5_000, 9_000, {}, stationery);
    const res = await sell(team.cashier, {
      paymentMethod: 'CASH',
      items: [
        { productId: a.id, quantity: 1 },
        { productId: b.id, quantity: 4 },
      ],
    });
    expect(res.body.totalMinor).toBe(50_000 + 36_000);
    expect(res.body.cogsMinor).toBe(30_000 + 20_000);
    const lines = await entryLines(res.body.id);
    const debit = lines.reduce((s, l) => s + l.debit, 0);
    const credit = lines.reduce((s, l) => s + l.credit, 0);
    expect(debit).toBe(credit);
    expect(lines.find((l) => l.code === '4000')?.credit).toBe(50_000);
    expect(lines.find((l) => l.code === '4010')?.credit).toBe(36_000);
  });

  it('refuses a payment below the total, a repeated product, an empty total and a missing product', async () => {
    const p = await product(5, 1_000, 2_000);
    const base = { paymentMethod: 'CASH', items: [{ productId: p.id, quantity: 1 }] };
    const short = await sell(team.cashier, { ...base, amountPaidMinor: 1_999 });
    expect(short.status).toBe(422);
    expect(short.body.code).toBe('insufficient-payment');
    const twice = await sell(team.cashier, {
      ...base,
      items: [
        { productId: p.id, quantity: 1 },
        { productId: p.id, quantity: 1 },
      ],
    });
    expect(twice.body.code).toBe('duplicate-product');
    const free = await product(5, 1_000, 0);
    const zero = await sell(team.cashier, {
      paymentMethod: 'CASH',
      items: [{ productId: free.id, quantity: 1 }],
    });
    expect(zero.body.code).toBe('zero-total');
    const missing = await sell(team.cashier, {
      paymentMethod: 'CASH',
      items: [{ productId: randomUUID(), quantity: 1 }],
    });
    expect(missing.body.code).toBe('product-unavailable');
    expect(await getProduct(ctx, team.manager, p.id)).toMatchObject({ currentStock: 5 });
  });

  it('never trusts the client for prices, costs, totals or stock', async () => {
    const p = await product(5, 1_000, 2_000);
    for (const extra of [
      { totalMinor: 1 },
      { cogsMinor: 0 },
      { items: [{ productId: p.id, quantity: 1, costMinor: 0 }] },
      { createdBy: randomUUID() },
    ]) {
      const res = await sell(team.cashier, {
        paymentMethod: 'CASH',
        items: [{ productId: p.id, quantity: 1 }],
        ...extra,
      });
      expect(res.status).toBe(400);
    }
    expect(await getProduct(ctx, team.manager, p.id)).toMatchObject({ currentStock: 5 });
  });
});

describe('who may change a price', () => {
  it('lets only a manager or the owner discount, override a price or sell below the minimum', async () => {
    const p = await product(10, 1_000, 2_000, { minSellingPriceMinor: 1_800 });
    const line = (extra: Record<string, unknown>) => ({
      paymentMethod: 'CASH',
      items: [{ productId: p.id, quantity: 2, ...extra }],
    });
    const asCashier = await sell(team.cashier, line({ discountMinor: 500 }));
    expect(asCashier.status).toBe(403);
    expect(asCashier.body.code).toBe('manager-approval-required');
    expect((await sell(team.cashier, line({ unitPriceMinor: 1_500 }))).status).toBe(403);

    const asManager = await sell(team.manager, line({ discountMinor: 500 }));
    expect(asManager.status).toBe(201);
    expect(asManager.body).toMatchObject({
      subtotalMinor: 4_000,
      discountMinor: 500,
      totalMinor: 3_500,
    });
    expect((await sell(team.owner, line({ unitPriceMinor: 1_500 }))).body.totalMinor).toBe(3_000);
    // A cashier asking for the list price is fine.
    expect((await sell(team.cashier, line({ unitPriceMinor: 2_000 }))).status).toBe(201);
    expect((await sell(team.manager, line({ discountMinor: 4_001 }))).body.code).toBe(
      'discount-too-large',
    );
  });
});

describe('stock rules at the till', () => {
  it('refuses a sale larger than the stock and changes nothing', async () => {
    const plenty = await product(10, 1_000, 2_000);
    const scarce = await product(2, 1_000, 2_000);
    const res = await sell(team.cashier, {
      paymentMethod: 'CASH',
      items: [
        { productId: plenty.id, quantity: 4 },
        { productId: scarce.id, quantity: 3 },
      ],
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('insufficient-stock');
    expect(await getProduct(ctx, team.manager, plenty.id)).toMatchObject({ currentStock: 10 });
    expect(await getProduct(ctx, team.manager, scarce.id)).toMatchObject({ currentStock: 2 });
  });

  it('never oversells when several tills sell the last units at once', async () => {
    const tills = await Promise.all(Array.from({ length: 6 }, () => makeStaff(ctx, 'cashier')));
    const p = await product(2, 5_000, 9_000);
    const results = await Promise.all(
      tills.map((t) =>
        sell(t, { paymentMethod: 'CASH', items: [{ productId: p.id, quantity: 1 }] }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    expect(results.filter((r) => r.status === 409)).toHaveLength(4);
    expect(await getProduct(ctx, team.manager, p.id)).toMatchObject({
      currentStock: 0,
      stockValueMinor: 0,
    });
  });

  it('takes the last unit at whatever value is left, so cost of sales adds up to what was bought', async () => {
    const p = await makeProduct(ctx, team.manager, electronics, { sellingPriceMinor: 100 });
    await stockUp(ctx, team.manager, supplierId, [
      { productId: p.id, quantity: 1, unitCostMinor: 10 },
    ]);
    await stockUp(ctx, team.manager, supplierId, [
      { productId: p.id, quantity: 2, unitCostMinor: 11 },
    ]);
    // 3 units worth 32: the average is 10.67, which has to be rounded as units leave.
    let cogs = 0;
    for (let i = 0; i < 3; i += 1) {
      const res = await sell(team.cashier, {
        paymentMethod: 'CASH',
        items: [{ productId: p.id, quantity: 1 }],
      });
      expect(res.status).toBe(201);
      cogs += res.body.cogsMinor;
    }
    expect(cogs).toBe(32);
    expect(await getProduct(ctx, team.manager, p.id)).toMatchObject({
      currentStock: 0,
      stockValueMinor: 0,
    });
  });

  it('flags a product that is selling for less than it costs', async () => {
    const p = await product(5, 3_000, 2_000);
    expect((await getProduct(ctx, team.manager, p.id)).negativeMargin).toBe(true);
    const flagged = await ctx
      .http()
      .get(`/api/v1/products?negativeMargin=true&q=${p.sku}`)
      .set(team.manager.auth);
    expect(flagged.body.items.map((i: { id: string }) => i.id)).toEqual([p.id]);
  });

  it('answers a repeated Idempotency-Key with the stored sale and takes stock once', async () => {
    const p = await product(5, 1_000, 2_000);
    const key = randomUUID();
    const body = { paymentMethod: 'CASH', items: [{ productId: p.id, quantity: 2 }] };
    const [a, b] = await Promise.all([
      sell(team.cashier, body, key),
      sell(team.cashier, body, key),
    ]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.id).toBe(b.body.id);
    expect(await getProduct(ctx, team.manager, p.id)).toMatchObject({ currentStock: 3 });
  });
});

describe('selling on credit', () => {
  it('records a receivable, enforces the credit limit and takes payments against it', async () => {
    const customerId = await makeCustomer(ctx, team.manager, 500_000);
    const p = await product(20, 60_000, 120_000);

    const first = await sell(team.cashier, {
      customerId,
      paymentMethod: 'CREDIT',
      amountPaidMinor: 100_000,
      items: [{ productId: p.id, quantity: 3 }],
    });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ totalMinor: 360_000, outstandingMinor: 260_000 });
    expect(await entryLines(first.body.id)).toEqual([
      { code: '1000', debit: 100_000, credit: 0 },
      { code: '1100', debit: 260_000, credit: 0 },
      { code: '1200', debit: 0, credit: 180_000 },
      { code: '4000', debit: 0, credit: 360_000 },
      { code: '5000', debit: 180_000, credit: 0 },
    ]);
    let customer = await ctx.http().get(`/api/v1/customers/${customerId}`).set(team.cashier.auth);
    expect(customer.body.outstandingMinor).toBe(260_000);

    // 260,000 owed + 360,000 more would pass the 500,000 limit.
    const over = await sell(team.cashier, {
      customerId,
      paymentMethod: 'CREDIT',
      items: [{ productId: p.id, quantity: 3 }],
    });
    expect(over.status).toBe(409);
    expect(over.body.code).toBe('credit-limit-exceeded');

    const overpay = await ctx
      .http()
      .post(`/api/v1/sales/${first.body.id}/payments`)
      .set(team.cashier.auth)
      .send({ amountMinor: 260_001, method: 'CASH' });
    expect(overpay.status).toBe(422);

    const paid = await ctx
      .http()
      .post(`/api/v1/sales/${first.body.id}/payments`)
      .set(team.cashier.auth)
      .send({ amountMinor: 160_000, method: 'MOBILE_MONEY' });
    expect(paid.status).toBe(201);
    expect(paid.body.outstandingMinor).toBe(100_000);
    customer = await ctx.http().get(`/api/v1/customers/${customerId}`).set(team.cashier.auth);
    expect(customer.body.outstandingMinor).toBe(100_000);

    await ctx
      .http()
      .post(`/api/v1/sales/${first.body.id}/payments`)
      .set(team.cashier.auth)
      .send({ amountMinor: 100_000, method: 'CASH' });
    customer = await ctx.http().get(`/api/v1/customers/${customerId}`).set(team.cashier.auth);
    expect(customer.body.outstandingMinor).toBe(0);
    const receipt = await ctx.pool.query(
      `select a.code, l.debit_minor::int as debit, l.credit_minor::int as credit
         from settlements s join journal_lines l on l.entry_id = s.journal_entry_id
         join accounts a on a.id = l.account_id
        where s.sale_id = $1 and s.method = 'MOBILE_MONEY' order by a.code`,
      [first.body.id],
    );
    expect(receipt.rows).toEqual([
      { code: '1010', debit: 160_000, credit: 0 },
      { code: '1100', debit: 0, credit: 160_000 },
    ]);
    // A cash sale cannot be "paid down".
    const cash = await sell(team.cashier, {
      paymentMethod: 'CASH',
      items: [{ productId: p.id, quantity: 1 }],
    });
    expect(
      (
        await ctx
          .http()
          .post(`/api/v1/sales/${cash.body.id}/payments`)
          .set(team.cashier.auth)
          .send({ amountMinor: 1, method: 'CASH' })
      ).status,
    ).toBe(409);
  });

  it('needs a customer, and does not call a fully paid sale credit', async () => {
    const p = await product(5, 1_000, 2_000);
    const noCustomer = await sell(team.cashier, {
      paymentMethod: 'CREDIT',
      items: [{ productId: p.id, quantity: 1 }],
    });
    expect(noCustomer.body.code).toBe('customer-required');
    const customerId = await makeCustomer(ctx, team.manager, 100_000);
    const paidUp = await sell(team.cashier, {
      customerId,
      paymentMethod: 'CREDIT',
      amountPaidMinor: 2_000,
      items: [{ productId: p.id, quantity: 1 }],
    });
    expect(paidUp.body.code).toBe('credit-fully-paid');
    // A customer with no credit limit cannot buy on credit at all.
    const noCredit = await makeCustomer(ctx, team.manager);
    const refused = await sell(team.cashier, {
      customerId: noCredit,
      paymentMethod: 'CREDIT',
      items: [{ productId: p.id, quantity: 1 }],
    });
    expect(refused.body.code).toBe('credit-limit-exceeded');
  });

  it('keeps two tills from together exceeding a credit limit', async () => {
    const customerId = await makeCustomer(ctx, team.manager, 150_000);
    const p = await product(10, 10_000, 100_000);
    const tills = await Promise.all(Array.from({ length: 4 }, () => makeStaff(ctx, 'cashier')));
    const results = await Promise.all(
      tills.map((t) =>
        sell(t, {
          customerId,
          paymentMethod: 'CREDIT',
          items: [{ productId: p.id, quantity: 1 }],
        }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    const customer = await ctx.http().get(`/api/v1/customers/${customerId}`).set(team.manager.auth);
    expect(customer.body.outstandingMinor).toBe(100_000);
  });
});

describe('voiding a sale', () => {
  it('puts the stock back at its cost and reverses the books without deleting anything', async () => {
    const p = await product(10, 40_000, 90_000);
    const sale = (
      await sell(team.cashier, { paymentMethod: 'CASH', items: [{ productId: p.id, quantity: 4 }] })
    ).body;
    expect(await getProduct(ctx, team.manager, p.id)).toMatchObject({
      currentStock: 6,
      stockValueMinor: 240_000,
    });

    expect(
      (
        await ctx
          .http()
          .post(`/api/v1/sales/${sale.id}/void`)
          .set(team.cashier.auth)
          .send({ reason: 'Customer changed their mind' })
      ).status,
    ).toBe(403);
    const voided = await ctx
      .http()
      .post(`/api/v1/sales/${sale.id}/void`)
      .set(team.manager.auth)
      .send({ reason: 'Customer changed their mind' });
    expect(voided.status).toBe(200);
    expect(voided.body).toMatchObject({
      status: 'VOIDED',
      voidReason: 'Customer changed their mind',
    });
    expect(await getProduct(ctx, team.manager, p.id)).toMatchObject({
      currentStock: 10,
      stockValueMinor: 400_000,
      wacMinor: 40_000,
    });

    const { rows } = await ctx.pool.query(
      `select status, reverses_entry_id is not null as is_reversal
         from journal_entries
        where reference_id = $1
           or reverses_entry_id = (select journal_entry_id from sales where id = $1)
        order by entry_number`,
      [sale.id],
    );
    expect(rows).toEqual([
      { status: 'VOIDED', is_reversal: false },
      { status: 'POSTED', is_reversal: true },
    ]);
    const net = await ctx.pool.query(
      `select coalesce(sum(l.debit_minor - l.credit_minor), 0)::int as net
         from journal_lines l join journal_entries e on e.id = l.entry_id
        where e.reference_id = $1
           or e.reverses_entry_id = (select journal_entry_id from sales where id = $1)`,
      [sale.id],
    );
    expect(net.rows[0].net).toBe(0);

    const again = await ctx
      .http()
      .post(`/api/v1/sales/${sale.id}/void`)
      .set(team.manager.auth)
      .send({ reason: 'Voiding it twice' });
    expect(again.status).toBe(409);
  });

  it('refuses to void a credit sale that has had payments, and clears the debt when it can', async () => {
    const customerId = await makeCustomer(ctx, team.manager, 1_000_000);
    const p = await product(10, 10_000, 50_000);
    const make = async () =>
      (
        await sell(team.cashier, {
          customerId,
          paymentMethod: 'CREDIT',
          items: [{ productId: p.id, quantity: 2 }],
        })
      ).body;
    const paid = await make();
    await ctx
      .http()
      .post(`/api/v1/sales/${paid.id}/payments`)
      .set(team.cashier.auth)
      .send({ amountMinor: 10_000, method: 'CASH' });
    const blocked = await ctx
      .http()
      .post(`/api/v1/sales/${paid.id}/void`)
      .set(team.manager.auth)
      .send({ reason: 'Should not be allowed' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('sale-has-receipts');

    const clean = await make();
    const before = (await ctx.http().get(`/api/v1/customers/${customerId}`).set(team.manager.auth))
      .body.outstandingMinor;
    await ctx
      .http()
      .post(`/api/v1/sales/${clean.id}/void`)
      .set(team.manager.auth)
      .send({ reason: 'Wrong customer' });
    const after = (await ctx.http().get(`/api/v1/customers/${customerId}`).set(team.manager.auth))
      .body.outstandingMinor;
    expect(before - after).toBe(100_000);
  });
});

describe('who sees which sales', () => {
  it('shows a cashier only their own sales, and everyone else all of them', async () => {
    const alice = await makeStaff(ctx, 'cashier');
    const bob = await makeStaff(ctx, 'cashier');
    const p = await product(10, 1_000, 2_000);
    const sale = (
      await sell(alice, { paymentMethod: 'CASH', items: [{ productId: p.id, quantity: 1 }] })
    ).body;
    expect((await ctx.http().get(`/api/v1/sales/${sale.id}`).set(alice.auth)).status).toBe(200);
    expect((await ctx.http().get(`/api/v1/sales/${sale.id}`).set(bob.auth)).status).toBe(404);
    expect(
      (await ctx.http().get(`/api/v1/sales/${sale.id}`).set(team.accountant.auth)).status,
    ).toBe(200);
    expect((await ctx.http().get('/api/v1/sales').set(bob.auth)).body.page.total).toBe(0);
    const mine = await ctx.http().get('/api/v1/sales').set(alice.auth);
    expect(mine.body.items.map((s: { id: string }) => s.id)).toEqual([sale.id]);
    // The accountant reads the books but never rings up a sale.
    expect(
      (
        await sell(team.accountant, {
          paymentMethod: 'CASH',
          items: [{ productId: p.id, quantity: 1 }],
        })
      ).status,
    ).toBe(403);
    const ranged = await ctx
      .http()
      .get(`/api/v1/sales?${TODAY_RANGE()}&paymentMethod=CASH&limit=5`)
      .set(team.manager.auth);
    expect(ranged.status).toBe(200);
    expect(ranged.body.items.length).toBeGreaterThan(0);
  });
});
