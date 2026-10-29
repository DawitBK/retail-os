import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  makeCategory,
  makeProduct,
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

const get = (who: Session, path: string) => ctx.http().get(`/api/v1${path}`).set(who.auth);
const sell = (body: Record<string, unknown>) =>
  ctx.http().post('/api/v1/sales').set(team.cashier.auth).send(body);

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

async function health(sku: string) {
  const res = await get(team.manager, `/analytics/products?search=${encodeURIComponent(sku)}`);
  expect(res.status).toBe(200);
  return res.body.items[0] as Record<string, unknown>;
}

describe('who may see analytics and forecasts', () => {
  it('keeps them away from the till, and the forecasts away from the accountant', async () => {
    for (const path of [
      '/analytics/products',
      '/analytics/inventory',
      '/analytics/trajectory',
      '/forecasting/reorder',
    ]) {
      expect((await get(team.cashier, path)).status).toBe(403);
      expect((await get({ auth: {} } as Session, path)).status).toBe(401);
    }
    expect((await get(team.accountant, '/analytics/inventory')).status).toBe(200);
    expect((await get(team.accountant, '/forecasting/reorder')).status).toBe(403);
    expect((await get(team.manager, '/forecasting/reorder')).status).toBe(200);
    expect((await get(team.cashier, `/accounting/cash-flow?${TODAY_RANGE()}`)).status).toBe(403);
  });
});

describe('product health', () => {
  it('works out pace, days of stock, margin and status from the sales', async () => {
    const p = await product(20, 60_000, 120_000);
    expect(
      (
        await sell({
          paymentMethod: 'CASH',
          amountPaidMinor: 360_000,
          items: [{ productId: p.id, quantity: 3 }],
        })
      ).status,
    ).toBe(201);
    const h = await health(p.sku);
    expect(h).toMatchObject({
      currentStock: 17,
      unitsSold30: 3,
      velocityPerDay: 0.1,
      daysOfStock: 170,
      averageCostMinor: 60_000,
      marginPct: 50,
      stockValueMinor: 1_020_000,
      movement: 'NORMAL',
      outOfStock: false,
      lowStock: false,
      negativeMargin: false,
    });
  });

  it('flags a product that is out, low, or sells below what it costs', async () => {
    const out = await product(0, 0, 50_000);
    expect(await health(out.sku)).toMatchObject({ outOfStock: true, movement: 'SLOW' });
    const low = await product(3, 10_000, 20_000, { reorderPoint: 5 });
    expect(await health(low.sku)).toMatchObject({ lowStock: true, outOfStock: false });
    const loss = await product(5, 40_000, 25_000);
    expect(await health(loss.sku)).toMatchObject({ negativeMargin: true, marginPct: -60 });
    const filtered = await get(team.manager, '/analytics/products?flag=NEGATIVE_MARGIN&limit=100');
    expect(filtered.body.items.map((i: { id: string }) => i.id)).toContain(loss.id);
    expect(filtered.body.items.every((i: { negativeMargin: boolean }) => i.negativeMargin)).toBe(
      true,
    );
  });

  it('gives one product its own pace, return on stock and a 30-day series', async () => {
    const p = await product(10, 50_000, 100_000);
    await sell({
      paymentMethod: 'CASH',
      amountPaidMinor: 200_000,
      items: [{ productId: p.id, quantity: 2 }],
    });
    const res = await get(team.manager, `/analytics/products/${p.id}`);
    expect(res.status).toBe(200);
    expect(res.body.unitsSold30).toBe(2);
    expect(res.body.capitalLockedMinor).toBe(400_000);
    expect(res.body.last30Days).toHaveLength(30);
    expect(res.body.last30Days.reduce((s: number, d: { units: number }) => s + d.units, 0)).toBe(2);
    // Annual profit at this pace: 2 sold in 30 days at 50 000 profit each, over the 400 000 on the shelf.
    expect(res.body.gmroi).toBeCloseTo((100_000 * 365) / 30 / 400_000, 1);
    expect(
      (await get(team.manager, '/analytics/products/00000000-0000-4000-8000-000000000000')).status,
    ).toBe(404);
  });
});

describe('profitability', () => {
  it('matches a hand calculation, net of what was returned', async () => {
    const p = await product(10, 30_000, 70_000);
    const sale = await sell({
      paymentMethod: 'CASH',
      amountPaidMinor: 280_000,
      items: [{ productId: p.id, quantity: 4 }],
    });
    expect(sale.status).toBe(201);
    const line = sale.body.items[0];
    const back = await ctx
      .http()
      .post(`/api/v1/sales/${sale.body.id}/returns`)
      .set(team.manager.auth)
      .send({
        reason: 'Customer changed their mind',
        refundMethod: 'CASH',
        items: [{ saleItemId: line.id, quantity: 1, restockable: true }],
      });
    expect(back.status).toBe(201);
    const res = await get(team.manager, `/analytics/profitability?by=product&limit=200`);
    const row = res.body.rows.find((r: { key: string }) => r.key === p.id);
    // 3 units kept: revenue 3 x 70 000, cost 3 x 30 000.
    expect(row).toMatchObject({
      unitsSold: 3,
      revenueMinor: 210_000,
      cogsMinor: 90_000,
      grossProfitMinor: 120_000,
    });
    expect(row.marginPct).toBeCloseTo(57.14, 2);
    const byCategory = await get(team.manager, '/analytics/profitability?by=category');
    expect(byCategory.body.rows.length).toBeGreaterThan(0);
    for (const r of byCategory.body.rows)
      expect(r.grossProfitMinor).toBe(r.revenueMinor - r.cogsMinor);
    const worst = await get(
      team.manager,
      '/analytics/profitability?by=product&order=worst&limit=200',
    );
    const margins = worst.body.rows.map((r: { marginPct: number }) => r.marginPct);
    expect([...margins].sort((a, b) => a - b)).toEqual(margins);
    expect((await get(team.manager, '/analytics/profitability?by=nonsense')).status).toBe(400);
  });
});

describe('forecasting', () => {
  it('puts the product that will run out first at the top, and suggests an order to the supplier it came from', async () => {
    const p = await product(6, 25_000, 60_000, { reorderPoint: 5, reorderQty: 12 });
    await sell({
      paymentMethod: 'CASH',
      amountPaidMinor: 240_000,
      items: [{ productId: p.id, quantity: 4 }],
    });
    const reorder = await get(team.manager, '/forecasting/reorder?limit=200');
    expect(reorder.status).toBe(200);
    const row = reorder.body.rows.find((r: { productId: string }) => r.productId === p.id);
    // 2 left, 4 sold in 30 days: 0.13 a day, so 15 days of stock.
    expect(row).toMatchObject({ currentStock: 2, velocityPerDay: 0.13, daysUntilStockout: 15 });
    expect(row.reorderByDate <= row.stockoutDate).toBe(true);
    const days = reorder.body.rows.map(
      (r: { daysUntilStockout: number | null }) => r.daysUntilStockout ?? 9999,
    );
    expect([...days].sort((a, b) => a - b)).toEqual(days);

    const suggested = await get(team.manager, '/forecasting/suggestions?limit=200');
    const group = suggested.body.suppliers.find(
      (s: { supplierId: string }) => s.supplierId === supplierId,
    );
    const line = group.lines.find((l: { productId: string }) => l.productId === p.id);
    // The larger of the reorder quantity (12) and the shortfall to the reorder point plus one reorder quantity (5 - 2 + 12 = 15).
    expect(line).toMatchObject({
      suggestedQty: 15,
      unitCostMinor: 25_000,
      lineTotalMinor: 375_000,
    });
    expect(group.totalMinor).toBe(
      group.lines.reduce((s: number, l: { lineTotalMinor: number }) => s + l.lineTotalMinor, 0),
    );

    const predicted = await get(team.manager, '/forecasting/sales');
    const forecast = predicted.body.rows.find((r: { productId: string }) => r.productId === p.id);
    if (forecast)
      expect(forecast).toMatchObject({ unitsSold30: 4, predictedUnits30: 4, predictedEndStock: 0 });
  });

  it('lists stock that has not sold for months, worst first', async () => {
    const p = await product(8, 20_000, 40_000);
    await ctx.pool.query(
      `update products set last_sold_at = now() - interval '150 days' where id = $1`,
      [p.id],
    );
    const res = await get(team.manager, '/forecasting/dead-stock?limit=200');
    const row = res.body.rows.find((r: { productId: string }) => r.productId === p.id);
    expect(row).toMatchObject({ currentStock: 8, capitalLockedMinor: 160_000 });
    expect(row.daysSinceLastSale).toBeGreaterThanOrEqual(150);
    const scores = res.body.rows.map((r: { riskScore: number }) => r.riskScore);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(res.body.note).toContain('For guidance only');
  });
});

describe('cash and the books', () => {
  it('produces a cash flow statement whose closing cash is what the ledger holds', async () => {
    const p = await product(5, 10_000, 30_000);
    await sell({
      paymentMethod: 'CASH',
      amountPaidMinor: 60_000,
      items: [{ productId: p.id, quantity: 2 }],
    });
    const range = TODAY_RANGE();
    const res = await get(team.accountant, `/accounting/cash-flow?${range}`);
    expect(res.status).toBe(200);
    expect(res.body.reconciled).toBe(true);
    expect(res.body.closingCashMinor).toBe(
      res.body.openingCashMinor + res.body.totalReceiptsMinor - res.body.totalPaymentsMinor,
    );
    expect(res.body.receipts.map((r: { label: string }) => r.label)).toContain('Sales received');
    const accounts = await get(team.accountant, '/accounting/accounts');
    const balance = (code: string) =>
      accounts.body.find((a: { code: string }) => a.code === code).balanceMinor;
    expect(res.body.closingCashMinor).toBe(balance('1000') + balance('1010'));
    expect(
      (await get(team.accountant, '/accounting/cash-flow?from=2030-02-01&to=2030-01-01')).status,
    ).toBe(400);
  });

  it('shows weekly cash that ends where the ledger ends, and ages what is owed', async () => {
    const res = await get(team.manager, '/analytics/cashflow?weeks=4');
    expect(res.status).toBe(200);
    expect(res.body.weeks).toHaveLength(4);
    for (const w of res.body.weeks) expect(w.netMinor).toBe(w.inflowMinor - w.outflowMinor);
    const accounts = await get(team.accountant, '/accounting/accounts');
    const cash = ['1000', '1010'].reduce(
      (s, c) => s + accounts.body.find((a: { code: string }) => a.code === c).balanceMinor,
      0,
    );
    expect(res.body.weeks.at(-1).endingCashMinor).toBe(cash);
    expect(res.body.payablesAging.map((b: { bucket: string }) => b.bucket)).toEqual([
      '0-30 days',
      '31-60 days',
      '61-90 days',
      'Over 90 days',
    ]);
    expect(res.body.receivablesAging).toHaveLength(4);
  });

  it('reports stock efficiency from the same figures as the valuation', async () => {
    const res = await get(team.manager, '/analytics/inventory?days=90');
    expect(res.status).toBe(200);
    const valuation = (await get(team.accountant, '/inventory/valuation')).body;
    expect(res.body.closingValueMinor).toBe(valuation.totalValueMinor);
    expect(res.body.closingValueMinor).toBe(valuation.inventoryAccountMinor);
    expect(res.body.averageValueMinor).toBe(
      Math.round((res.body.openingValueMinor + res.body.closingValueMinor) / 2),
    );
    expect(res.body.aging.map((b: { bucket: string }) => b.bucket)).toEqual([
      '0-30',
      '31-60',
      '61-90',
      '90+',
    ]);
    expect(
      res.body.aging.reduce((s: number, b: { valueMinor: number }) => s + b.valueMinor, 0),
    ).toBeLessThanOrEqual(res.body.closingValueMinor);
    expect(res.body.turnover).toBeGreaterThanOrEqual(0);
  });

  it('gives monthly figures that agree with the profit and loss for the month', async () => {
    const trajectory = await get(team.manager, '/analytics/trajectory?months=3');
    expect(trajectory.status).toBe(200);
    expect(trajectory.body.months).toHaveLength(3);
    const current = trajectory.body.months.at(-1);
    const [y, m] = current.month.split('-').map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const pnl = (
      await get(
        team.accountant,
        `/accounting/profit-loss?from=${current.month}-01&to=${current.month}-${String(last).padStart(2, '0')}`,
      )
    ).body;
    expect(current.revenueMinor).toBe(pnl.netRevenueMinor);
    expect(current.cogsMinor).toBe(pnl.totalCogsMinor);
    expect(current.netProfitMinor).toBe(pnl.netProfitMinor);
    const accounts = await get(team.accountant, '/accounting/accounts');
    const balance = (code: string) =>
      accounts.body.find((a: { code: string }) => a.code === code).balanceMinor;
    expect(current.endingCashMinor).toBe(balance('1000') + balance('1010'));
    expect(current.inventoryValueMinor).toBe(balance('1200'));
  });
});
