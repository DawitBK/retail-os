import { randomUUID } from 'node:crypto';
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

/** The lines of the journal entry a business event posted, as `code -> [debit, credit]`. */
async function postedLines(referenceType: string, referenceId: string) {
  const { rows } = await ctx.pool.query(
    `select a.code, l.debit_minor::int as debit, l.credit_minor::int as credit
       from journal_lines l
       join journal_entries e on e.id = l.entry_id
       join accounts a on a.id = l.account_id
      where e.reference_type = $1 and e.reference_id = $2
      order by e.entry_number, a.code`,
    [referenceType, referenceId],
  );
  return rows as { code: string; debit: number; credit: number }[];
}

describe('stock arrives only through purchases and keeps a weighted average cost', () => {
  it('moves the weighted average cost with every receipt', async () => {
    const p = await makeProduct(ctx, team.manager, categoryId);
    await stockUp(ctx, team.manager, supplierId, [
      { productId: p.id, quantity: 10, unitCostMinor: 50_000 },
    ]);
    expect(await getProduct(ctx, team.manager, p.id)).toMatchObject({
      currentStock: 10,
      stockValueMinor: 500_000,
      wacMinor: 50_000,
    });
    await stockUp(ctx, team.manager, supplierId, [
      { productId: p.id, quantity: 10, unitCostMinor: 70_000 },
    ]);
    // (10 x 500.00 + 10 x 700.00) / 20 = 600.00
    expect(await getProduct(ctx, team.manager, p.id)).toMatchObject({
      currentStock: 20,
      stockValueMinor: 1_200_000,
      wacMinor: 60_000,
    });
  });

  it('records every receipt as an immutable movement with before and after figures', async () => {
    const p = await makeProduct(ctx, team.manager, categoryId);
    await stockUp(ctx, team.manager, supplierId, [
      { productId: p.id, quantity: 4, unitCostMinor: 25_000 },
    ]);
    const moves = await ctx
      .http()
      .get(`/api/v1/products/${p.id}/movements`)
      .set(team.accountant.auth);
    expect(moves.status).toBe(200);
    expect(moves.body.items).toHaveLength(1);
    expect(moves.body.items[0]).toMatchObject({
      movementType: 'PURCHASE_RECEIPT',
      quantity: 4,
      valueDeltaMinor: 100_000,
      stockBefore: 0,
      stockAfter: 4,
    });
    await expect(
      ctx.pool.query('update inventory_movements set quantity = 99 where product_id = $1', [p.id]),
    ).rejects.toThrow(/append-only/);
    expect(
      (await ctx.http().get(`/api/v1/products/${p.id}/movements`).set(team.cashier.auth)).status,
    ).toBe(403);
  });

  it('refuses every other way of changing stock', async () => {
    const p = await makeProduct(ctx, team.manager, categoryId);
    const viaApi = await ctx
      .http()
      .patch(`/api/v1/products/${p.id}`)
      .set(team.manager.auth)
      .send({ version: p.version, currentStock: 500 });
    expect(viaApi.status).toBe(400);
    const onCreate = await ctx
      .http()
      .post('/api/v1/products')
      .set(team.manager.auth)
      .send({
        sku: `S-${randomUUID()}`,
        name: 'Sneaky',
        categoryId,
        sellingPriceMinor: 1,
        currentStock: 5,
      });
    expect(onCreate.status).toBe(400);
    // Even SQL cannot do it: a trigger lets only the inventory service move stock.
    await expect(
      ctx.pool.query('update products set current_stock = 500 where id = $1', [p.id]),
    ).rejects.toThrow(/only through inventory movements/);
    await expect(
      ctx.pool.query('update products set stock_value_minor = 1 where id = $1', [p.id]),
    ).rejects.toThrow(/only through inventory movements/);
    await expect(
      ctx.pool.query(
        `insert into products (sku, name, category_id, selling_price_minor, current_stock)
         values ($1, 'x', $2, 1, 5)`,
        [`S-${randomUUID()}`, categoryId],
      ),
    ).rejects.toThrow(/starts with no stock/);
  });
});

describe('purchase orders', () => {
  it('receives in parts, never more than was ordered, and posts inventory against payables', async () => {
    const p = await makeProduct(ctx, team.manager, categoryId);
    const created = await ctx
      .http()
      .post('/api/v1/purchases')
      .set(team.manager.auth)
      .send({
        supplierId,
        items: [{ productId: p.id, orderedQty: 10, unitCostMinor: 30_000 }],
      });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      status: 'ORDERED',
      totalMinor: 300_000,
      receivedValueMinor: 0,
      paymentStatus: 'UNPAID',
    });
    expect(created.body.number).toMatch(/^PO-\d+$/);
    const itemId = created.body.items[0].id;

    const first = await ctx
      .http()
      .post(`/api/v1/purchases/${created.body.id}/receive`)
      .set(team.manager.auth)
      .send({ items: [{ itemId, quantity: 4 }] });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ status: 'PARTIALLY_RECEIVED', receivedValueMinor: 120_000 });
    expect(await getProduct(ctx, team.manager, p.id)).toMatchObject({ currentStock: 4 });

    const over = await ctx
      .http()
      .post(`/api/v1/purchases/${created.body.id}/receive`)
      .set(team.manager.auth)
      .send({ items: [{ itemId, quantity: 7 }] });
    expect(over.status).toBe(422);
    expect(over.body.code).toBe('over-receipt');
    expect(await getProduct(ctx, team.manager, p.id)).toMatchObject({ currentStock: 4 });

    const rest = await ctx
      .http()
      .post(`/api/v1/purchases/${created.body.id}/receive`)
      .set(team.manager.auth)
      .send({ items: [{ itemId, quantity: 6 }] });
    expect(rest.body).toMatchObject({ status: 'RECEIVED', receivedValueMinor: 300_000 });
    const again = await ctx
      .http()
      .post(`/api/v1/purchases/${created.body.id}/receive`)
      .set(team.manager.auth)
      .send({ items: [{ itemId, quantity: 1 }] });
    expect(again.status).toBe(409);

    const entries = await postedLines('PURCHASE_RECEIPT', created.body.id);
    expect(entries).toEqual([
      { code: '1200', debit: 120_000, credit: 0 },
      { code: '2000', debit: 0, credit: 120_000 },
      { code: '1200', debit: 180_000, credit: 0 },
      { code: '2000', debit: 0, credit: 180_000 },
    ]);
  });

  it('pays the supplier only for what has arrived, and tracks the payment status', async () => {
    const p = await makeProduct(ctx, team.manager, categoryId);
    const created = (
      await ctx
        .http()
        .post('/api/v1/purchases')
        .set(team.manager.auth)
        .send({ supplierId, items: [{ productId: p.id, orderedQty: 10, unitCostMinor: 10_000 }] })
    ).body;
    const notYet = await ctx
      .http()
      .post(`/api/v1/purchases/${created.id}/payments`)
      .set(team.accountant.auth)
      .send({ amountMinor: 1, method: 'BANK_TRANSFER' });
    expect(notYet.status).toBe(422);
    expect(notYet.body.code).toBe('overpayment');

    await ctx
      .http()
      .post(`/api/v1/purchases/${created.id}/receive`)
      .set(team.manager.auth)
      .send({ items: [{ itemId: created.items[0].id, quantity: 5 }] });
    const part = await ctx
      .http()
      .post(`/api/v1/purchases/${created.id}/payments`)
      .set(team.accountant.auth)
      .send({ amountMinor: 20_000, method: 'BANK_TRANSFER' });
    expect(part.status).toBe(201);
    expect(part.body.payableMinor).toBe(30_000);
    expect(
      (await ctx.http().get(`/api/v1/purchases/${created.id}`).set(team.accountant.auth)).body
        .paymentStatus,
    ).toBe('PARTIAL');

    const tooMuch = await ctx
      .http()
      .post(`/api/v1/purchases/${created.id}/payments`)
      .set(team.accountant.auth)
      .send({ amountMinor: 30_001, method: 'CASH' });
    expect(tooMuch.status).toBe(422);

    await ctx
      .http()
      .post(`/api/v1/purchases/${created.id}/receive`)
      .set(team.manager.auth)
      .send({ items: [{ itemId: created.items[0].id, quantity: 5 }] });
    await ctx
      .http()
      .post(`/api/v1/purchases/${created.id}/payments`)
      .set(team.accountant.auth)
      .send({ amountMinor: 80_000, method: 'CASH' });
    const done = await ctx.http().get(`/api/v1/purchases/${created.id}`).set(team.accountant.auth);
    expect(done.body).toMatchObject({ paymentStatus: 'PAID', paidMinor: 100_000, payableMinor: 0 });

    const lines = await postedLines('SUPPLIER_PAYMENT', created.id);
    expect(lines).toEqual([
      { code: '1010', debit: 0, credit: 20_000 },
      { code: '2000', debit: 20_000, credit: 0 },
      { code: '1000', debit: 0, credit: 80_000 },
      { code: '2000', debit: 80_000, credit: 0 },
    ]);
    // What we owe a supplier is worked out from its orders.
    const supplier = await ctx
      .http()
      .get(`/api/v1/suppliers/${supplierId}`)
      .set(team.accountant.auth);
    expect(supplier.body.payableMinor).toBeGreaterThanOrEqual(0);
  });

  it('cancels an order only while nothing has arrived', async () => {
    const p = await makeProduct(ctx, team.manager, categoryId);
    const make = async () =>
      (
        await ctx
          .http()
          .post('/api/v1/purchases')
          .set(team.manager.auth)
          .send({ supplierId, items: [{ productId: p.id, orderedQty: 2, unitCostMinor: 100 }] })
      ).body;
    const untouched = await make();
    const cancelled = await ctx
      .http()
      .post(`/api/v1/purchases/${untouched.id}/cancel`)
      .set(team.manager.auth);
    expect(cancelled.body.status).toBe('CANCELLED');
    expect(
      (
        await ctx
          .http()
          .post(`/api/v1/purchases/${untouched.id}/receive`)
          .set(team.manager.auth)
          .send({ items: [{ itemId: untouched.items[0].id, quantity: 1 }] })
      ).status,
    ).toBe(409);

    const started = await make();
    await ctx
      .http()
      .post(`/api/v1/purchases/${started.id}/receive`)
      .set(team.manager.auth)
      .send({ items: [{ itemId: started.items[0].id, quantity: 1 }] });
    expect(
      (await ctx.http().post(`/api/v1/purchases/${started.id}/cancel`).set(team.manager.auth))
        .status,
    ).toBe(409);
  });

  it('validates the order: a real supplier, real products, no duplicate lines', async () => {
    const p = await makeProduct(ctx, team.manager, categoryId);
    const line = { productId: p.id, orderedQty: 1, unitCostMinor: 1 };
    const send = (body: Record<string, unknown>) =>
      ctx.http().post('/api/v1/purchases').set(team.manager.auth).send(body);
    expect((await send({ supplierId: randomUUID(), items: [line] })).status).toBe(422);
    expect((await send({ supplierId, items: [{ ...line, productId: randomUUID() }] })).status).toBe(
      422,
    );
    expect((await send({ supplierId, items: [line, line] })).status).toBe(422);
    expect((await send({ supplierId, items: [] })).status).toBe(400);
    expect((await send({ supplierId, items: [{ ...line, unitCostMinor: 1.5 }] })).status).toBe(400);
  });
});
