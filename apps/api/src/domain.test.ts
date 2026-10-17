import { describe, expect, it } from 'vitest';
import { createProductSchema } from './catalog/catalog.contract.js';
import { businessDate, configureTimezone } from './common/time.js';
import { issueCost } from './inventory/inventory.js';
import { shareOfLine } from './operations/returns.service.js';
import { openApiDocument } from './openapi.js';
import { createSaleSchema } from './sales/sales.contract.js';

describe('issueCost', () => {
  it('takes the average cost for a partial issue', () => {
    expect(issueCost(1_200_000, 20, 3)).toBe(180_000);
    expect(issueCost(500_000, 10, 1)).toBe(50_000);
  });

  it('rounds half up, never loses a santim', () => {
    expect(issueCost(32, 3, 1)).toBe(11); // 10.67
    expect(issueCost(21, 2, 1)).toBe(11); // 10.5
    expect(issueCost(10, 3, 1)).toBe(3); // 3.33
  });

  it('takes whatever value is left with the last unit, so the shelf value reaches exactly zero', () => {
    let stock = 3;
    let value = 32;
    let issued = 0;
    while (stock > 0) {
      const cost = issueCost(value, stock, 1);
      issued += cost;
      value -= cost;
      stock -= 1;
    }
    expect(issued).toBe(32);
    expect(value).toBe(0);
  });

  it('does not overflow on large stock values', () => {
    const value = 9_000_000_000_000_000; // above 2^53 once multiplied by the quantity
    expect(issueCost(value, 1_000_000, 999_999)).toBe(8_999_991_000_000_000);
  });
});

describe('shareOfLine', () => {
  it('splits a line into pieces that add up to exactly the whole, whatever the order', () => {
    for (const [amount, qty] of [
      [29_000, 3],
      [10_000, 7],
      [1, 3],
      [999_999_999, 13],
    ] as const) {
      let returned = 0;
      let total = 0;
      for (let i = 0; i < qty; i += 1) {
        total += shareOfLine(amount, qty, returned, 1);
        returned += 1;
      }
      expect(total).toBe(amount);
    }
  });

  it('gives the same total for a lump return as for the pieces', () => {
    expect(shareOfLine(29_000, 3, 0, 3)).toBe(29_000);
    expect(shareOfLine(29_000, 3, 1, 2)).toBe(29_000 - shareOfLine(29_000, 3, 0, 1));
  });
});

describe('business date', () => {
  it('uses the shop time zone, not UTC', () => {
    configureTimezone('Africa/Addis_Ababa');
    // 22:30 UTC on the 1st is already 01:30 on the 2nd in Addis Ababa (UTC+3).
    expect(businessDate(new Date('2026-03-01T22:30:00Z'))).toBe('2026-03-02');
    expect(businessDate(new Date('2026-03-01T20:59:00Z'))).toBe('2026-03-01');
  });

  it('rejects an unknown time zone at start-up', () => {
    expect(() => configureTimezone('Mars/Olympus')).toThrow();
    configureTimezone('Africa/Addis_Ababa');
  });
});

describe('contracts', () => {
  it('has no way to supply a cost, total, stock or author on a sale', () => {
    const item = { productId: crypto.randomUUID(), quantity: 1 };
    const sale = { paymentMethod: 'CASH', items: [item] };
    expect(createSaleSchema.safeParse(sale).success).toBe(true);
    for (const extra of [
      { totalMinor: 1 },
      { cogsMinor: 0 },
      { createdBy: 'x' },
      { status: 'PAID' },
    ]) {
      expect(createSaleSchema.safeParse({ ...sale, ...extra }).success).toBe(false);
    }
    expect(
      createSaleSchema.safeParse({ ...sale, items: [{ ...item, costMinor: 0 }] }).success,
    ).toBe(false);
    expect(createSaleSchema.safeParse({ ...sale, items: [{ ...item, quantity: 0 }] }).success).toBe(
      false,
    );
    expect(
      createSaleSchema.safeParse({ ...sale, items: [{ ...item, quantity: 1.5 }] }).success,
    ).toBe(false);
  });

  it('has no stock field when creating a product, and money is whole', () => {
    const product = {
      sku: 'A',
      name: 'A',
      categoryId: crypto.randomUUID(),
      sellingPriceMinor: 100,
    };
    expect(createProductSchema.safeParse(product).success).toBe(true);
    expect(createProductSchema.safeParse({ ...product, currentStock: 5 }).success).toBe(false);
    expect(createProductSchema.safeParse({ ...product, sellingPriceMinor: 1.5 }).success).toBe(
      false,
    );
    expect(createProductSchema.safeParse({ ...product, sellingPriceMinor: -1 }).success).toBe(
      false,
    );
  });
});

describe('OpenAPI document', () => {
  const doc = openApiDocument() as {
    paths: Record<string, Record<string, { operationId: string; security?: unknown }>>;
  };
  const operations = Object.values(doc.paths).flatMap((m) => Object.values(m));

  it('has a unique operation id per route', () => {
    const ids = operations.map((o) => o.operationId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(70);
  });

  it('marks every non-public route as needing a bearer token', () => {
    const open = new Set(['login', 'refresh', 'logout']);
    for (const op of operations) {
      expect(op.security !== undefined, op.operationId).toBe(!open.has(op.operationId));
    }
  });
});
