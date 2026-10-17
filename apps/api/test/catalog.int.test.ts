import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  makeCategory,
  makeCustomer,
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

beforeAll(async () => {
  ctx = await startContext();
  team = await makeTeam(ctx);
  categoryId = await makeCategory(ctx, team.manager);
});
afterAll(async () => {
  await ctx.close();
});

describe('categories, sub-categories and brands', () => {
  it('keeps a hierarchy where a product must use a sub-category of its own category', async () => {
    const other = await makeCategory(ctx, team.manager, 'STATIONERY');
    const sub = await ctx
      .http()
      .post('/api/v1/sub-categories')
      .set(team.manager.auth)
      .send({ categoryId, name: `Chargers ${randomUUID().slice(0, 6)}` });
    expect(sub.status).toBe(201);
    const wrong = await ctx
      .http()
      .post('/api/v1/products')
      .set(team.manager.auth)
      .send({
        sku: `S-${randomUUID()}`,
        name: 'Mismatch',
        categoryId: other,
        subCategoryId: sub.body.id,
        sellingPriceMinor: 100,
      });
    expect(wrong.status).toBe(422);
    expect(wrong.body.code).toBe('category-mismatch');
    const inUse = await ctx
      .http()
      .post('/api/v1/products')
      .set(team.manager.auth)
      .send({
        sku: `S-${randomUUID()}`,
        name: 'Fits',
        categoryId,
        subCategoryId: sub.body.id,
        sellingPriceMinor: 100,
      });
    expect(inUse.status).toBe(201);
    expect(
      (await ctx.http().delete(`/api/v1/sub-categories/${sub.body.id}`).set(team.manager.auth))
        .status,
    ).toBe(409);
    expect(
      (await ctx.http().delete(`/api/v1/categories/${categoryId}`).set(team.manager.auth)).body
        .code,
    ).toBe('category-in-use');
  });

  it('keeps names unique ignoring case and manages brands', async () => {
    const name = `Brand ${randomUUID().slice(0, 6)}`;
    const brand = await ctx
      .http()
      .post('/api/v1/brands')
      .set(team.manager.auth)
      .send({ name, country: 'Korea' });
    expect(brand.status).toBe(201);
    const dupe = await ctx
      .http()
      .post('/api/v1/brands')
      .set(team.manager.auth)
      .send({ name: name.toUpperCase() });
    expect(dupe.status).toBe(409);
    const renamed = await ctx
      .http()
      .patch(`/api/v1/brands/${brand.body.id}`)
      .set(team.manager.auth)
      .send({ version: brand.body.version, country: null });
    expect(renamed.body.country).toBeNull();
    expect(
      (
        await ctx
          .http()
          .patch(`/api/v1/brands/${brand.body.id}`)
          .set(team.manager.auth)
          .send({ version: brand.body.version, name: 'Late' })
      ).status,
    ).toBe(409);
    expect(
      (await ctx.http().delete(`/api/v1/brands/${brand.body.id}`).set(team.manager.auth)).status,
    ).toBe(204);
  });
});

describe('products', () => {
  it('has unique SKUs and barcodes, ignoring case', async () => {
    const tag = randomUUID().slice(0, 8);
    const first = await makeProduct(ctx, team.manager, categoryId, {
      sku: `Abc-${tag}`,
      barcode: `BC${tag}`,
    });
    expect(first.id).toBeTruthy();
    const send = (extra: Record<string, unknown>) =>
      ctx
        .http()
        .post('/api/v1/products')
        .set(team.manager.auth)
        .send({
          sku: `X-${randomUUID()}`,
          name: 'Dupe',
          categoryId,
          sellingPriceMinor: 1,
          ...extra,
        });
    expect((await send({ sku: `ABC-${tag}` })).body.code).toBe('duplicate');
    expect((await send({ barcode: `BC${tag}` })).body.code).toBe('duplicate');
  });

  it('searches, filters and sorts', async () => {
    const tag = `zq${randomUUID().slice(0, 8)}`;
    const supplier = await makeSupplier(ctx, team.manager);
    const a = await makeProduct(ctx, team.manager, categoryId, {
      name: `${tag} Alpha`,
      sellingPriceMinor: 3_000,
      reorderPoint: 5,
    });
    const b = await makeProduct(ctx, team.manager, categoryId, {
      name: `${tag} Beta`,
      sellingPriceMinor: 1_000,
      reorderPoint: 5,
    });
    await stockUp(ctx, team.manager, supplier, [
      { productId: a.id, quantity: 50, unitCostMinor: 100 },
    ]);
    const all = await ctx
      .http()
      .get(`/api/v1/products?q=${tag}&sort=sellingPriceMinor`)
      .set(team.cashier.auth);
    expect(all.body.items.map((p: { id: string }) => p.id)).toEqual([b.id, a.id]);
    const low = await ctx
      .http()
      .get(`/api/v1/products?q=${tag}&lowStock=true`)
      .set(team.cashier.auth);
    expect(low.body.items.map((p: { id: string }) => p.id)).toEqual([b.id]);
    const desc = await ctx
      .http()
      .get(`/api/v1/products?q=${tag}&sort=-name&limit=1`)
      .set(team.cashier.auth);
    expect(desc.body.items[0].id).toBe(b.id);
    expect(
      (await ctx.http().get('/api/v1/products?sort=stockValueMinor').set(team.cashier.auth)).status,
    ).toBe(400);
    // LIKE wildcards in a search are plain text.
    const percent = await ctx.http().get('/api/v1/products?q=%25%25%25%25').set(team.cashier.auth);
    expect(percent.body.page.total).toBe(0);
  });

  it('uses optimistic concurrency, and removes a product only when nothing is held or recent', async () => {
    const p = await makeProduct(ctx, team.manager, categoryId);
    const ok = await ctx
      .http()
      .patch(`/api/v1/products/${p.id}`)
      .set(team.manager.auth)
      .send({ version: p.version, sellingPriceMinor: 5_000, minSellingPriceMinor: 4_000 });
    expect(ok.status).toBe(200);
    expect(ok.body.version).toBe(p.version + 1);
    const stale = await ctx
      .http()
      .patch(`/api/v1/products/${p.id}`)
      .set(team.manager.auth)
      .send({ version: p.version, sellingPriceMinor: 6_000 });
    expect(stale.body.code).toBe('version-conflict');

    const supplier = await makeSupplier(ctx, team.manager);
    await stockUp(ctx, team.manager, supplier, [
      { productId: p.id, quantity: 1, unitCostMinor: 10 },
    ]);
    const held = await ctx.http().delete(`/api/v1/products/${p.id}`).set(team.manager.auth);
    expect(held.body.code).toBe('product-has-stock');
    const fresh = await makeProduct(ctx, team.manager, categoryId);
    expect(
      (await ctx.http().delete(`/api/v1/products/${fresh.id}`).set(team.manager.auth)).status,
    ).toBe(204);
    expect(
      (await ctx.http().get(`/api/v1/products/${fresh.id}`).set(team.manager.auth)).status,
    ).toBe(404);
  });

  it('discontinued products cannot be sold', async () => {
    const supplier = await makeSupplier(ctx, team.manager);
    const p = await makeProduct(ctx, team.manager, categoryId);
    await stockUp(ctx, team.manager, supplier, [
      { productId: p.id, quantity: 3, unitCostMinor: 10 },
    ]);
    const current = (await ctx.http().get(`/api/v1/products/${p.id}`).set(team.manager.auth)).body;
    await ctx
      .http()
      .patch(`/api/v1/products/${p.id}`)
      .set(team.manager.auth)
      .send({ version: current.version, status: 'DISCONTINUED' });
    const res = await ctx
      .http()
      .post('/api/v1/sales')
      .set(team.cashier.auth)
      .send({ paymentMethod: 'CASH', items: [{ productId: p.id, quantity: 1 }] });
    expect(res.body.code).toBe('product-unavailable');
  });
});

describe('customers and suppliers', () => {
  it('lets the till create a customer but only a manager grant credit', async () => {
    const created = await ctx
      .http()
      .post('/api/v1/customers')
      .set(team.cashier.auth)
      .send({ name: 'Walk-in Wegene', phone: '+251 911 223344', type: 'WHOLESALE' });
    expect(created.status).toBe(201);
    expect(created.body.creditLimitMinor).toBe(0);
    const sneaky = await ctx
      .http()
      .post('/api/v1/customers')
      .set(team.cashier.auth)
      .send({ name: 'Sneaky', creditLimitMinor: 1_000_000 });
    expect(sneaky.status).toBe(400);
    expect(
      (
        await ctx
          .http()
          .patch(`/api/v1/customers/${created.body.id}`)
          .set(team.cashier.auth)
          .send({ version: created.body.version, creditLimitMinor: 1 })
      ).status,
    ).toBe(403);
    const granted = await ctx
      .http()
      .patch(`/api/v1/customers/${created.body.id}`)
      .set(team.manager.auth)
      .send({ version: created.body.version, creditLimitMinor: 250_000 });
    expect(granted.body.creditLimitMinor).toBe(250_000);
    expect(
      (
        await ctx
          .http()
          .post('/api/v1/customers')
          .set(team.cashier.auth)
          .send({ name: 'Bad', phone: 'abc' })
      ).status,
    ).toBe(400);
    const list = await ctx.http().get('/api/v1/customers?q=wegene').set(team.cashier.auth);
    expect(list.body.items.map((c: { id: string }) => c.id)).toContain(created.body.id);
  });

  it('refuses to delete a customer who owes money or a supplier we owe', async () => {
    const customerId = await makeCustomer(ctx, team.manager, 100_000);
    const supplierId = await makeSupplier(ctx, team.manager);
    const p = await makeProduct(ctx, team.manager, categoryId, { sellingPriceMinor: 10_000 });
    await stockUp(ctx, team.manager, supplierId, [
      { productId: p.id, quantity: 5, unitCostMinor: 5_000 },
    ]);
    await ctx
      .http()
      .post('/api/v1/sales')
      .set(team.cashier.auth)
      .send({ customerId, paymentMethod: 'CREDIT', items: [{ productId: p.id, quantity: 2 }] });
    const owed = await ctx.http().delete(`/api/v1/customers/${customerId}`).set(team.manager.auth);
    expect(owed.body.code).toBe('customer-owes-money');
    const owing = await ctx.http().delete(`/api/v1/suppliers/${supplierId}`).set(team.manager.auth);
    expect(owing.body.code).toBe('supplier-is-owed');
    const clean = await makeCustomer(ctx, team.manager);
    expect(
      (await ctx.http().delete(`/api/v1/customers/${clean}`).set(team.manager.auth)).status,
    ).toBe(204);
    const supplier = await ctx
      .http()
      .get(`/api/v1/suppliers/${supplierId}`)
      .set(team.accountant.auth);
    expect(supplier.body.payableMinor).toBe(25_000);
  });
});
