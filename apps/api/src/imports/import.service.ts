import { Inject, Injectable } from '@nestjs/common';
import { ProblemException } from '@retail/kit';
import { isNull, sql } from 'drizzle-orm';
import { ACCOUNT, postJournalEntry } from '../accounting/ledger.js';
import { recordAudit } from '../common/audit.js';
import type { Principal } from '../common/auth.js';
import { businessDate } from '../common/time.js';
import { DB, type Database } from '../db/db.module.js';
import { applyMovement } from '../inventory/inventory.js';
import {
  brands,
  categories,
  outboxEvents,
  products,
  subCategories,
  CATEGORY_TYPES,
} from '../db/schema.js';
import { parseCsv, parseMoneyToMinor } from './csv.js';
import { IMPORT_COLUMNS, type ImportInventory, type ImportReport } from './import.contract.js';

const MAX_ROWS = 5000;

interface Line {
  row: number;
  sku: string;
  name: string;
  type: (typeof CATEGORY_TYPES)[number] | null;
  category: string;
  subCategory: string | null;
  brand: string | null;
  barcode: string | null;
  unit: string;
  priceMinor: number;
  minPriceMinor: number | null;
  reorderPoint: number;
  reorderQty: number;
  quantity: number;
  unitCostMinor: number;
}

interface Problem {
  path: string;
  message: string;
  code: string;
}

const lower = (s: string) => s.toLowerCase();

@Injectable()
export class ImportService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** Read and check every row. Nothing is written here. */
  private parse(content: string): { lines: Line[]; problems: Problem[] } {
    let table: string[][];
    try {
      table = parseCsv(content);
    } catch (e) {
      throw new ProblemException(
        422,
        'import-unreadable',
        'The file cannot be read',
        (e as Error).message,
      );
    }
    const header = (table[0] ?? []).map((h) =>
      h
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, '_'),
    );
    const missing = ['sku', 'name', 'price'].filter((c) => !header.includes(c));
    if (missing.length > 0) {
      throw new ProblemException(
        422,
        'import-missing-columns',
        'The file is missing required columns',
        `Required: sku, name, price (missing: ${missing.join(', ')}). Known columns: ${IMPORT_COLUMNS.join(', ')}`,
      );
    }
    const body = table.slice(1);
    if (body.length === 0) throw new ProblemException(422, 'import-empty', 'The file has no rows');
    if (body.length > MAX_ROWS) {
      throw new ProblemException(422, 'import-too-large', `At most ${MAX_ROWS} rows per file`);
    }
    const at = (cells: string[], col: string) => {
      const i = header.indexOf(col);
      return i < 0 ? '' : (cells[i] ?? '').trim();
    };
    const lines: Line[] = [];
    const problems: Problem[] = [];
    const seenSku = new Set<string>();
    const seenBarcode = new Set<string>();
    body.forEach((cells, index) => {
      const row = index + 2; // 1-based, and the header is row 1
      const bad = (field: string, message: string) =>
        problems.push({ path: `row ${row}: ${field}`, message, code: 'invalid' });
      const sku = at(cells, 'sku');
      const name = at(cells, 'name');
      if (!sku || sku.length > 64) bad('sku', 'Required, up to 64 characters');
      if (!name || name.length > 200) bad('name', 'Required, up to 200 characters');
      if (sku) {
        if (seenSku.has(lower(sku))) bad('sku', `"${sku}" appears more than once in the file`);
        seenSku.add(lower(sku));
      }
      const barcode = at(cells, 'barcode') || null;
      if (barcode) {
        if (barcode.length > 64) bad('barcode', 'Up to 64 characters');
        if (seenBarcode.has(barcode))
          bad('barcode', `"${barcode}" appears more than once in the file`);
        seenBarcode.add(barcode);
      }
      const price = parseMoneyToMinor(at(cells, 'price'));
      if (price === null) bad('price', 'A price in birr such as 1200 or 1200.50');
      const minRaw = at(cells, 'min_price');
      const min = minRaw ? parseMoneyToMinor(minRaw) : null;
      if (minRaw && min === null) bad('min_price', 'A price in birr such as 900 or 900.50');
      if (price !== null && min !== null && min > price)
        bad('min_price', 'Cannot be above the price');
      const int = (col: string, fallback: number) => {
        const raw = at(cells, col);
        if (raw === '') return fallback;
        const n = /^\d{1,7}$/.test(raw) ? Number(raw) : NaN;
        if (!Number.isInteger(n)) {
          bad(col, 'A whole number, 0 or more');
          return fallback;
        }
        return n;
      };
      const quantity = int('quantity', 0);
      const costRaw = at(cells, 'unit_cost');
      const cost = costRaw ? parseMoneyToMinor(costRaw) : null;
      if (costRaw && cost === null) bad('unit_cost', 'A cost in birr such as 690 or 690.50');
      if (quantity > 0 && cost === null) bad('unit_cost', 'Required when a quantity is given');
      const typeRaw = at(cells, 'type').toUpperCase();
      const type = (CATEGORY_TYPES as readonly string[]).includes(typeRaw)
        ? (typeRaw as Line['type'])
        : null;
      if (typeRaw && !type) bad('type', `One of ${CATEGORY_TYPES.join(', ')}`);
      const category = at(cells, 'category');
      if (!category) bad('category', 'Required');
      if (price === null || !sku || !name || !category) return;
      lines.push({
        row,
        sku,
        name,
        type,
        category,
        subCategory: at(cells, 'sub_category') || null,
        brand: at(cells, 'brand') || null,
        barcode,
        unit: at(cells, 'unit') || 'piece',
        priceMinor: price,
        minPriceMinor: min,
        reorderPoint: int('reorder_point', 5),
        reorderQty: int('reorder_qty', 10),
        quantity,
        unitCostMinor: cost ?? 0,
      });
    });
    return { lines, problems };
  }

  /**
   * Catalogue and opening stock from a CSV file, in one transaction: either every row is accepted or
   * none. Products that already exist (by SKU) are left exactly as they are. Stock that comes in is
   * booked as owner's capital, the same entry the opening balances use, so the shelf and the
   * inventory account stay equal.
   */
  async importInventory(actor: Principal, input: ImportInventory): Promise<ImportReport> {
    const { lines, problems } = this.parse(input.content);
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('retail:import'))`);
      const existing = await tx
        .select({ sku: products.sku, barcode: products.barcode })
        .from(products)
        .where(isNull(products.deletedAt));
      const haveSku = new Set(existing.map((p) => lower(p.sku)));
      const haveBarcode = new Set(existing.flatMap((p) => (p.barcode ? [p.barcode] : [])));
      const skippedExisting: string[] = [];
      const fresh: Line[] = [];
      for (const l of lines) {
        if (haveSku.has(lower(l.sku))) skippedExisting.push(l.sku);
        else fresh.push(l);
      }

      const liveCategories = await tx.select().from(categories).where(isNull(categories.deletedAt));
      const categoryByName = new Map(liveCategories.map((c) => [lower(c.name), c]));
      for (const l of fresh) {
        if (l.barcode && haveBarcode.has(l.barcode)) {
          problems.push({
            path: `row ${l.row}: barcode`,
            message: `"${l.barcode}" belongs to another product`,
            code: 'invalid',
          });
        }
        if (!categoryByName.has(lower(l.category)) && !l.type) {
          problems.push({
            path: `row ${l.row}: type`,
            message: `Category "${l.category}" is new: say whether it is ELECTRONICS or STATIONERY`,
            code: 'invalid',
          });
        }
        const known = categoryByName.get(lower(l.category));
        if (known && l.type && known.type !== l.type) {
          problems.push({
            path: `row ${l.row}: type`,
            message: `Category "${known.name}" is ${known.type}, not ${l.type}`,
            code: 'invalid',
          });
        }
      }
      // A new category named twice with different types in one file is also a contradiction.
      const typeOfNew = new Map<string, string>();
      for (const l of fresh) {
        if (categoryByName.has(lower(l.category)) || !l.type) continue;
        const prior = typeOfNew.get(lower(l.category));
        if (prior && prior !== l.type) {
          problems.push({
            path: `row ${l.row}: type`,
            message: `Category "${l.category}" is given two different types in this file`,
            code: 'invalid',
          });
        }
        typeOfNew.set(lower(l.category), l.type);
      }
      if (problems.length > 0) {
        throw new ProblemException(
          422,
          'import-invalid',
          'The file has errors; nothing was imported',
          `${problems.length} problem${problems.length === 1 ? '' : 's'} found`,
          { errors: problems.slice(0, 200) },
        );
      }

      const stockLines = fresh.filter((l) => l.quantity > 0);
      const stockUnits = stockLines.reduce((s, l) => s + l.quantity, 0);
      const stockValue = stockLines.reduce((s, l) => s + l.quantity * l.unitCostMinor, 0);
      const newCategoryNames = new Set(
        fresh.filter((l) => !categoryByName.has(lower(l.category))).map((l) => lower(l.category)),
      );
      const liveSubs = await tx.select().from(subCategories).where(isNull(subCategories.deletedAt));
      const liveBrands = await tx.select().from(brands).where(isNull(brands.deletedAt));
      const subKey = (categoryId: string, name: string) => `${categoryId}|${lower(name)}`;
      const subByKey = new Map(liveSubs.map((s) => [subKey(s.categoryId, s.name), s]));
      const brandByName = new Map(liveBrands.map((b) => [lower(b.name), b]));
      const wouldCreateSubs = new Set<string>();
      const wouldCreateBrands = new Set<string>();
      for (const l of fresh) {
        const cat = categoryByName.get(lower(l.category));
        if (l.subCategory && (!cat || !subByKey.has(subKey(cat.id, l.subCategory)))) {
          wouldCreateSubs.add(`${lower(l.category)}|${lower(l.subCategory)}`);
        }
        if (l.brand && !brandByName.has(lower(l.brand))) wouldCreateBrands.add(lower(l.brand));
      }
      const report: ImportReport = {
        applied: false,
        dryRun: input.dryRun,
        rows: lines.length,
        categoriesCreated: newCategoryNames.size,
        subCategoriesCreated: wouldCreateSubs.size,
        brandsCreated: wouldCreateBrands.size,
        productsCreated: fresh.length,
        skippedExisting,
        stockUnits,
        stockValueMinor: stockValue,
        entryNumber: null,
      };
      if (input.dryRun || fresh.length === 0) return report;

      // Hierarchy first, then products, then stock and the one journal entry.
      for (const l of fresh) {
        if (!categoryByName.has(lower(l.category))) {
          const [c] = await tx
            .insert(categories)
            .values({ name: l.category, type: l.type! })
            .returning();
          categoryByName.set(lower(l.category), c!);
          await recordAudit(tx, {
            actor: actor.userId,
            action: 'category.created',
            entityType: 'category',
            entityId: c!.id,
            after: { name: c!.name, type: c!.type, via: 'import' },
          });
        }
      }
      for (const l of fresh) {
        const cat = categoryByName.get(lower(l.category))!;
        if (l.subCategory && !subByKey.has(subKey(cat.id, l.subCategory))) {
          const [s] = await tx
            .insert(subCategories)
            .values({ categoryId: cat.id, name: l.subCategory })
            .returning();
          subByKey.set(subKey(cat.id, l.subCategory), s!);
        }
        if (l.brand && !brandByName.has(lower(l.brand))) {
          const [b] = await tx.insert(brands).values({ name: l.brand }).returning();
          brandByName.set(lower(l.brand), b!);
        }
      }
      const importId = crypto.randomUUID();
      const created: { id: string; line: Line }[] = [];
      for (const l of fresh) {
        const cat = categoryByName.get(lower(l.category))!;
        const [p] = await tx
          .insert(products)
          .values({
            sku: l.sku,
            barcode: l.barcode,
            name: l.name,
            categoryId: cat.id,
            subCategoryId: l.subCategory ? subByKey.get(subKey(cat.id, l.subCategory))!.id : null,
            brandId: l.brand ? brandByName.get(lower(l.brand))!.id : null,
            unitOfMeasure: l.unit,
            sellingPriceMinor: l.priceMinor,
            minSellingPriceMinor: l.minPriceMinor,
            reorderPoint: l.reorderPoint,
            reorderQty: l.reorderQty,
          })
          .returning();
        created.push({ id: p!.id, line: l });
        await recordAudit(tx, {
          actor: actor.userId,
          action: 'product.created',
          entityType: 'product',
          entityId: p!.id,
          after: { sku: l.sku, name: l.name, via: 'import' },
        });
      }
      for (const { id, line } of created
        .filter((c) => c.line.quantity > 0)
        .sort((a, b) => a.id.localeCompare(b.id))) {
        await applyMovement(tx, {
          productId: id,
          type: 'OPENING_BALANCE',
          quantity: line.quantity,
          totalCostMinor: line.quantity * line.unitCostMinor,
          referenceType: 'IMPORT',
          referenceId: importId,
          createdBy: actor.userId,
        });
      }
      if (stockValue > 0) {
        const entry = await postJournalEntry(tx, {
          date: businessDate(),
          description: `Stock imported from file (${stockUnits} units)`,
          referenceType: 'STOCK_IMPORT',
          referenceId: importId,
          createdBy: actor.userId,
          lines: [
            { accountCode: ACCOUNT.INVENTORY, debitMinor: stockValue },
            { accountCode: ACCOUNT.CAPITAL, creditMinor: stockValue },
          ],
        });
        report.entryNumber = entry.entryNumber;
        await recordAudit(tx, {
          actor: actor.userId,
          action: 'inventory.imported',
          entityType: 'journal-entry',
          entityId: entry.id,
          after: { products: fresh.length, stockUnits, stockValueMinor: stockValue },
        });
      } else {
        await recordAudit(tx, {
          actor: actor.userId,
          action: 'inventory.imported',
          entityType: 'import',
          entityId: importId,
          after: { products: fresh.length, stockUnits: 0 },
        });
      }
      await tx.insert(outboxEvents).values({
        topic: 'inventory.imported',
        payload: { products: fresh.length, stockUnits, stockValueMinor: stockValue },
      });
      report.applied = true;
      return report;
    });
  }
}

export type { Problem };
