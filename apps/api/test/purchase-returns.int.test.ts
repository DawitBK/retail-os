import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  getProduct,
  makeCategory,
  makeProduct,
  makeSupplier,
  makeTeam,
  startContext,
  stockUp,
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

async function postedLines(referenceType: string, referenceId: string) {
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

const sendBack = (
  purchaseId: string,
  items: { purchaseItemId: string; quantity: number }[],
  extra: Record<string, unknown> = {},
  who = team.manager,
) =>
  ctx
    .http()
    .post(`/api/v1/purchases/${purchaseId}/returns`)
    .set(who.auth)
    .send({ reason: 'Faulty batch', items, ...extra });

const getPurchase = async (id: string) =>
  (await ctx.http().get(`/api/v1/purchases/${id}`).set(team.manager.auth)).body;

async function payFor(purchaseId: string, amountMinor: number) {
  const r = await ctx
    .http()
    .post(`/api/v1/purchases/${purchaseId}/payments`)
    .set(team.manager.auth)
    .send({ amountMinor, method: 'BANK_TRANSFER' });
  expect(r.status).toBe(201);
}

describe('returning goods to a supplier', () => {
  it('cancels what we owe first, takes the stock out at cost and balances the books', async () => {
    const p = await makeProduct(ctx, team.manager, categoryId);
    const purchase = await stockUp(ctx, team.manager, supplierId, [
      { productId: p.id, quantity: 10, unitCostMinor: 10_000 },
    ]);
    const line = purchase.items[0]!;

    const r = await sendBack(purchase.id, [{ purchaseItemId: line.id, quantity: 3 }]);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({
      valueMinor: 30_000,
      creditAppliedMinor: 30_000,
      refundMinor: 0,
      refundMethod: null,
    });
    expect(r.body.number).toMatch(/^PRET-\d{6}$/);
    expect(r.body.items[0]).toMatchObject({
      quantity: 3,
      valueMinor: 30_000,
      stockCostMinor: 30_000,
    });

    expect(await getProduct(ctx, team.manager, p.id)).toMatchObject({
      currentStock: 7,
      stockValueMinor: 70_000,
    });
    expect(await postedLines('PURCHASE_RETURN', r.body.id)).toEqual([
      { code: '1200', debit: 0, credit: 30_000 },
      { code: '2000', debit: 30_000, credit: 0 },
    ]);
    const after = await getPurchase(purchase.id);
    expect(after).toMatchObject({ receivedValueMinor: 70_000, paidMinor: 0, payableMinor: 70_000 });
    expect(after.paymentStatus).toBe('UNPAID');

    const list = await ctx
      .http()
      .get(`/api/v1/purchase-returns?purchaseId=${purchase.id}`)
      .set(team.accountant.auth);
    expect(list.body.page.total).toBe(1);
    expect(list.body.items[0].id).toBe(r.body.id);
  });

  it('brings back money already paid, and refuses to guess how', async () => {
    const p = await makeProduct(ctx, team.manager, categoryId);
    const purchase = await stockUp(ctx, team.manager, supplierId, [
      { productId: p.id, quantity: 10, unitCostMinor: 10_000 },
    ]);
    await payFor(purchase.id, 80_000); // 20 000 still owed
    const line = purchase.items[0]!;

    const noMethod = await sendBack(purchase.id, [{ purchaseItemId: line.id, quantity: 5 }]);
    expect(noMethod.status).toBe(422);
    expect(noMethod.body.code).toBe('refund-method-required');
    expect((await getProduct(ctx, team.manager, p.id)).currentStock).toBe(10);

    const r = await sendBack(purchase.id, [{ purchaseItemId: line.id, quantity: 5 }], {
      refundMethod: 'BANK_TRANSFER',
    });
    expect(r.status).toBe(201);
    // 50 000 of credit: 20 000 cancels the debt, 30 000 comes back as money.
    expect(r.body).toMatchObject({
      valueMinor: 50_000,
      creditAppliedMinor: 20_000,
      refundMinor: 30_000,
      refundMethod: 'BANK_TRANSFER',
    });
    expect(await postedLines('PURCHASE_RETURN', r.body.id)).toEqual([
      { code: '1010', debit: 30_000, credit: 0 },
      { code: '1200', debit: 0, credit: 50_000 },
      { code: '2000', debit: 20_000, credit: 0 },
    ]);
    const after = await getPurchase(purchase.id);
    expect(after).toMatchObject({ receivedValueMinor: 50_000, paidMinor: 50_000, payableMinor: 0 });
    expect(after.paymentStatus).toBe('PAID');
  });

  it('books the difference when the shelf cost differs from the price on the order', async () => {
    const p = await makeProduct(ctx, team.manager, categoryId);
    const first = await stockUp(ctx, team.manager, supplierId, [
      { productId: p.id, quantity: 10, unitCostMinor: 10_000 },
    ]);
    await stockUp(ctx, team.manager, supplierId, [
      { productId: p.id, quantity: 10, unitCostMinor: 20_000 },
    ]);
    // The shelf now costs 150.00 a unit on average; the first order was 100.00 a unit.
    const r = await sendBack(first.id, [{ purchaseItemId: first.items[0]!.id, quantity: 2 }]);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ valueMinor: 20_000 });
    expect(r.body.items[0].stockCostMinor).toBe(30_000);
    // We are credited 200 for goods that were worth 300 on the shelf: the 100 gap is a loss.
    expect(await postedLines('PURCHASE_RETURN', r.body.id)).toEqual([
      { code: '1200', debit: 0, credit: 30_000 },
      { code: '2000', debit: 20_000, credit: 0 },
      { code: '5100', debit: 10_000, credit: 0 },
    ]);
  });

  it('keeps the books and the shelf in agreement', async () => {
    const tb = await ctx
      .http()
      .get('/api/v1/accounting/trial-balance?from=2000-01-01&to=2100-01-01')
      .set(team.accountant.auth);
    expect(tb.body.balanced).toBe(true);
    const valuation = await ctx.http().get('/api/v1/inventory/valuation').set(team.accountant.auth);
    expect(valuation.body.reconciled).toBe(true);
    const sheet = await ctx
      .http()
      .get('/api/v1/accounting/balance-sheet')
      .set(team.accountant.auth);
    expect(sheet.body.balanced).toBe(true);
  });

  it('refuses more than was received, repeated lines, goods already sold and wrong orders', async () => {
    const p = await makeProduct(ctx, team.manager, categoryId);
    const purchase = await stockUp(ctx, team.manager, supplierId, [
      { productId: p.id, quantity: 5, unitCostMinor: 10_000 },
    ]);
    const line = purchase.items[0]!;
    const over = await sendBack(purchase.id, [{ purchaseItemId: line.id, quantity: 6 }]);
    expect(over.status).toBe(422);
    expect(over.body.code).toBe('over-return');
    const twice = await sendBack(purchase.id, [
      { purchaseItemId: line.id, quantity: 1 },
      { purchaseItemId: line.id, quantity: 1 },
    ]);
    expect(twice.body.code).toBe('duplicate-line');
    const alien = await sendBack(purchase.id, [
      { purchaseItemId: '00000000-0000-4000-8000-000000000000', quantity: 1 },
    ]);
    expect(alien.body.code).toBe('line-missing');
    expect(
      (
        await sendBack('00000000-0000-4000-8000-000000000000', [
          { purchaseItemId: line.id, quantity: 1 },
        ])
      ).status,
    ).toBe(404);

    // Sell four of the five: only one is left to send back.
    const sale = await ctx
      .http()
      .post('/api/v1/sales')
      .set(team.cashier.auth)
      .send({ paymentMethod: 'CASH', items: [{ productId: p.id, quantity: 4 }] });
    expect(sale.status).toBe(201);
    const gone = await sendBack(purchase.id, [{ purchaseItemId: line.id, quantity: 3 }]);
    expect(gone.status).toBe(409);
    expect(gone.body.code).toBe('insufficient-stock');
    expect((await sendBack(purchase.id, [{ purchaseItemId: line.id, quantity: 1 }])).status).toBe(
      201,
    );

    // Units already sent back cannot go back twice.
    const again = await sendBack(purchase.id, [{ purchaseItemId: line.id, quantity: 5 }]);
    expect(again.body.code).toBe('over-return');
  });

  it('refuses a cancelled order, and only managers may send goods back', async () => {
    const p = await makeProduct(ctx, team.manager, categoryId);
    const created = await ctx
      .http()
      .post('/api/v1/purchases')
      .set(team.manager.auth)
      .send({ supplierId, items: [{ productId: p.id, orderedQty: 2, unitCostMinor: 10_000 }] });
    await ctx.http().post(`/api/v1/purchases/${created.body.id}/cancel`).set(team.manager.auth);
    const cancelled = await sendBack(created.body.id, [
      { purchaseItemId: created.body.items[0].id, quantity: 1 },
    ]);
    expect(cancelled.status).toBe(409);
    expect(cancelled.body.code).toBe('purchase-not-returnable');

    const stocked = await stockUp(ctx, team.manager, supplierId, [
      { productId: p.id, quantity: 2, unitCostMinor: 10_000 },
    ]);
    const item = [{ purchaseItemId: stocked.items[0]!.id, quantity: 1 }];
    expect((await sendBack(stocked.id, item, {}, team.cashier)).status).toBe(403);
    expect((await sendBack(stocked.id, item, {}, team.accountant)).status).toBe(403);
    const anon = await ctx.http().post(`/api/v1/purchases/${stocked.id}/returns`).send({});
    expect(anon.status).toBe(401);
    expect((await ctx.http().get('/api/v1/purchase-returns').set(team.cashier.auth)).status).toBe(
      403,
    );
  });
});
