import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTeam, startContext, type Staff, type TestContext } from './helpers.js';
import { parseCsv, parseMoneyToMinor } from '../src/imports/csv.js';

let ctx: TestContext;
let team: Staff;
const tag = randomUUID().slice(0, 6).toUpperCase();

beforeAll(async () => {
  ctx = await startContext();
  team = await makeTeam(ctx);
});
afterAll(async () => {
  await ctx.close();
});

const HEADER =
  'sku,name,type,category,sub_category,brand,barcode,unit,price,min_price,reorder_point,reorder_qty,quantity,unit_cost';
const send = (content: string, dryRun = false, who = team.owner) =>
  ctx.http().post('/api/v1/import/inventory').set(who.auth).send({ content, dryRun });

const rows = (n: number, prefix = `IMP-${tag}`) =>
  Array.from(
    { length: n },
    (_, i) =>
      `${prefix}-${i + 1},"Widget, large ${i + 1}",ELECTRONICS,Imported ${tag},Gadgets,Brand ${tag},,piece,${100 + i}.50,90,4,12,${5 + i},60.25`,
  );

describe('the csv reader', () => {
  it('reads quotes, commas inside quotes, doubled quotes, line breaks and a byte-order mark', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\n\n"two\nlines",z')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
      ['two\nlines', 'z'],
    ]);
    expect(() => parseCsv('a,"open')).toThrow(/never closed/);
  });
  it('turns birr into minor units without floats', () => {
    expect(parseMoneyToMinor('1200')).toBe(120_000);
    expect(parseMoneyToMinor('1,200.5')).toBe(120_050);
    expect(parseMoneyToMinor('0.07')).toBe(7);
    expect(parseMoneyToMinor('12.345')).toBeNull();
    expect(parseMoneyToMinor('-5')).toBeNull();
    expect(parseMoneyToMinor('abc')).toBeNull();
  });
});

describe('importing the catalogue and opening stock', () => {
  it('is for the owner only', async () => {
    for (const who of [team.manager, team.accountant, team.cashier]) {
      expect((await send([HEADER, ...rows(1)].join('\n'), true, who)).status).toBe(403);
    }
  });

  it('checks a file without changing anything when asked to', async () => {
    const before = (await ctx.pool.query('select count(*)::int as n from products')).rows[0].n;
    const res = await send([HEADER, ...rows(3, `DRY-${tag}`)].join('\n'), true);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      applied: false,
      dryRun: true,
      rows: 3,
      productsCreated: 3,
      categoriesCreated: 1,
      brandsCreated: 1,
      subCategoriesCreated: 1,
    });
    expect((await ctx.pool.query('select count(*)::int as n from products')).rows[0].n).toBe(
      before,
    );
  });

  it('creates the hierarchy, the products and the stock, and the shelf still equals the inventory account', async () => {
    const res = await send([HEADER, ...rows(3)].join('\n'));
    expect(res.status).toBe(200);
    // 5 + 6 + 7 = 18 units at 60.25 = 1 084.50
    expect(res.body).toMatchObject({
      applied: true,
      productsCreated: 3,
      stockUnits: 18,
      stockValueMinor: 108_450,
      skippedExisting: [],
    });
    expect(res.body.entryNumber).toMatch(/^JE-\d+$/);
    const list = await ctx
      .http()
      .get(`/api/v1/products?q=IMP-${tag}&limit=10`)
      .set(team.manager.auth);
    expect(list.body.items).toHaveLength(3);
    const first = list.body.items.find((p: { sku: string }) => p.sku === `IMP-${tag}-1`);
    expect(first).toMatchObject({
      name: 'Widget, large 1',
      sellingPriceMinor: 10_050,
      minSellingPriceMinor: 9_000,
      currentStock: 5,
      stockValueMinor: 30_125,
      reorderPoint: 4,
      reorderQty: 12,
    });
    const valuation = (
      await ctx.http().get('/api/v1/inventory/valuation').set(team.accountant.auth)
    ).body;
    expect(valuation.reconciled).toBe(true);
    const lines = await ctx.pool.query(
      `select a.code, l.debit_minor::int as debit, l.credit_minor::int as credit
         from journal_lines l join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id
        where e.entry_number = $1 order by a.code`,
      [res.body.entryNumber],
    );
    expect(lines.rows).toEqual([
      { code: '1200', debit: 108_450, credit: 0 },
      { code: '3000', debit: 0, credit: 108_450 },
    ]);
    const audit = await ctx.pool.query(
      `select count(*)::int as n from audit_log where action = 'inventory.imported'`,
    );
    expect(audit.rows[0].n).toBeGreaterThan(0);
  });

  it('leaves products that already exist exactly as they are, so running it twice changes nothing', async () => {
    const again = await send([HEADER, ...rows(3)].join('\n'));
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({
      applied: false,
      productsCreated: 0,
      stockUnits: 0,
      entryNumber: null,
    });
    expect(again.body.skippedExisting).toHaveLength(3);
    const p = (await ctx.http().get(`/api/v1/products?q=IMP-${tag}-1`).set(team.manager.auth)).body
      .items[0];
    expect(p.currentStock).toBe(5);
  });

  it('accepts all rows or none, and says which rows are wrong and why', async () => {
    const before = (await ctx.pool.query('select count(*)::int as n from products')).rows[0].n;
    const file = [
      HEADER,
      `OK-${tag},Fine,ELECTRONICS,Imported ${tag},,,,piece,10,,,,1,5`,
      `BAD-${tag}-1,No price,ELECTRONICS,Imported ${tag},,,,piece,,,,,,`,
      `BAD-${tag}-2,Min above price,ELECTRONICS,Imported ${tag},,,,piece,10,20,,,,`,
      `BAD-${tag}-3,Stock without cost,ELECTRONICS,Imported ${tag},,,,piece,10,,,,5,`,
      `BAD-${tag}-4,New category without type,,Never seen ${tag},,,,piece,10,,,,,`,
      `BAD-${tag}-5,Wrong type for known category,STATIONERY,Imported ${tag},,,,piece,10,,,,,`,
      `OK-${tag},Same sku twice,ELECTRONICS,Imported ${tag},,,,piece,10,,,,,`,
    ].join('\n');
    const res = await send(file);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('import-invalid');
    const where = res.body.errors.map((e: { path: string }) => e.path);
    expect(where).toEqual(
      expect.arrayContaining([
        'row 3: price',
        'row 4: min_price',
        'row 5: unit_cost',
        'row 6: type',
        'row 7: type',
        'row 8: sku',
      ]),
    );
    expect((await ctx.pool.query('select count(*)::int as n from products')).rows[0].n).toBe(
      before,
    );
    expect(
      (
        await ctx.pool.query(`select count(*)::int as n from categories where name = $1`, [
          `Never seen ${tag}`,
        ])
      ).rows[0].n,
    ).toBe(0);
  });

  it('refuses unreadable and incomplete files with a reason', async () => {
    expect((await send('a,"open')).body.code).toBe('import-unreadable');
    expect((await send('sku,name\nA,B')).body.code).toBe('import-missing-columns');
    expect((await send(`${HEADER}\n`)).body.code).toBe('import-empty');
    expect((await send('')).status).toBe(400);
  });

  it('stops two products sharing a barcode', async () => {
    const file = [
      HEADER,
      `BC1-${tag},A,ELECTRONICS,Imported ${tag},,,${tag}111,piece,10,,,,,`,
    ].join('\n');
    expect((await send(file)).status).toBe(200);
    const clash = [
      HEADER,
      `BC2-${tag},B,ELECTRONICS,Imported ${tag},,,${tag}111,piece,10,,,,,`,
    ].join('\n');
    const res = await send(clash);
    expect(res.status).toBe(422);
    expect(res.body.errors[0].message).toContain('another product');
  });
});
