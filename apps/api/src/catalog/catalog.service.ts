import { Inject, Injectable } from '@nestjs/common';
import { conflict, notFound, ProblemException, toPage, unprocessable } from '@retail/kit';
import type { Pagination } from '@retail/kit';
import { and, asc, count, desc, eq, gte, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
import { recordAudit } from '../common/audit.js';
import type { Principal } from '../common/auth.js';
import { escapeLike, pgCode, versionConflict } from '../common/errors.js';
import { DB, type Database, type Tx } from '../db/db.module.js';
import {
  brands,
  categories,
  inventoryMovements,
  products,
  subCategories,
  type BrandRow,
  type CategoryRow,
  type ProductRow,
  type SubCategoryRow,
} from '../db/schema.js';
import type {
  BrandDto,
  CategoryDto,
  CreateBrand,
  CreateCategory,
  CreateProduct,
  CreateSubCategory,
  ListProductsQuery,
  ListSubCategoriesQuery,
  MovementDto,
  ProductDto,
  ProductSortField,
  SubCategoryDto,
  UpdateBrand,
  UpdateCategory,
  UpdateProduct,
  UpdateSubCategory,
} from './catalog.contract.js';

const PRODUCT_SORT = {
  name: sql`lower(${products.name})`,
  sku: sql`lower(${products.sku})`,
  sellingPriceMinor: products.sellingPriceMinor,
  currentStock: products.currentStock,
  createdAt: products.createdAt,
} satisfies Record<ProductSortField, unknown>;

export const toCategoryDto = (r: CategoryRow): CategoryDto => ({
  id: r.id,
  name: r.name,
  type: r.type,
  version: r.version,
});
export const toSubCategoryDto = (r: SubCategoryRow): SubCategoryDto => ({
  id: r.id,
  categoryId: r.categoryId,
  name: r.name,
  version: r.version,
});
export const toBrandDto = (r: BrandRow): BrandDto => ({
  id: r.id,
  name: r.name,
  country: r.country,
  version: r.version,
});

/** Weighted average cost per unit, or null when nothing is on hand to average. */
export const wacOf = (stock: number, value: number): number | null =>
  stock > 0 ? Math.round(value / stock) : null;

export const toProductDto = (r: ProductRow): ProductDto => ({
  id: r.id,
  sku: r.sku,
  barcode: r.barcode,
  name: r.name,
  description: r.description,
  categoryId: r.categoryId,
  subCategoryId: r.subCategoryId,
  brandId: r.brandId,
  unitOfMeasure: r.unitOfMeasure,
  sellingPriceMinor: r.sellingPriceMinor,
  minSellingPriceMinor: r.minSellingPriceMinor,
  currentStock: r.currentStock,
  stockValueMinor: r.stockValueMinor,
  wacMinor: wacOf(r.currentStock, r.stockValueMinor),
  // Compared without division, so there is no rounding: price x stock < total cost.
  negativeMargin: r.currentStock > 0 && r.sellingPriceMinor * r.currentStock < r.stockValueMinor,
  reorderPoint: r.reorderPoint,
  reorderQty: r.reorderQty,
  status: r.status,
  lastSoldAt: r.lastSoldAt?.toISOString() ?? null,
  lastRestockedAt: r.lastRestockedAt?.toISOString() ?? null,
  version: r.version,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

const touch = () => ({ version: sql`version + 1`, updatedAt: sql`now()` });

@Injectable()
export class CatalogService {
  constructor(@Inject(DB) private readonly db: Database) {}

  // ---------- categories ----------

  async listCategories(page: Pagination) {
    const where = isNull(categories.deletedAt);
    const [rows, totals] = await Promise.all([
      this.db
        .select()
        .from(categories)
        .where(where)
        .orderBy(asc(categories.name), asc(categories.id))
        .limit(page.limit)
        .offset(page.offset),
      this.db.select({ total: count() }).from(categories).where(where),
    ]);
    return toPage(rows.map(toCategoryDto), totals[0]?.total ?? 0, page);
  }

  async createCategory(actor: Principal, input: CreateCategory): Promise<CategoryDto> {
    return this.write(async () =>
      this.db.transaction(async (tx) => {
        const [row] = await tx.insert(categories).values(input).returning();
        const after = toCategoryDto(row!);
        await recordAudit(
          tx,
          audit(actor, 'category.created', 'category', after.id, undefined, after),
        );
        return after;
      }),
    );
  }

  async updateCategory(actor: Principal, id: string, input: UpdateCategory): Promise<CategoryDto> {
    return this.write(async () =>
      this.db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(categories)
          .where(and(eq(categories.id, id), isNull(categories.deletedAt)))
          .for('update');
        if (!current) throw notFound(`Category ${id} does not exist`);
        if (current.version !== input.version) {
          throw versionConflict('category', current.version, input.version);
        }
        const [row] = await tx
          .update(categories)
          .set({ name: input.name, ...touch() })
          .where(eq(categories.id, id))
          .returning();
        const after = toCategoryDto(row!);
        await recordAudit(
          tx,
          audit(actor, 'category.updated', 'category', id, toCategoryDto(current), after),
        );
        return after;
      }),
    );
  }

  async deleteCategory(actor: Principal, id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(categories)
        .where(and(eq(categories.id, id), isNull(categories.deletedAt)))
        .for('update');
      if (!current) throw notFound(`Category ${id} does not exist`);
      const [{ items } = { items: 0 }] = await tx
        .select({ items: count() })
        .from(products)
        .where(and(eq(products.categoryId, id), isNull(products.deletedAt)));
      const [{ children } = { children: 0 }] = await tx
        .select({ children: count() })
        .from(subCategories)
        .where(and(eq(subCategories.categoryId, id), isNull(subCategories.deletedAt)));
      if (items > 0 || children > 0) {
        throw conflict(
          'category-in-use',
          'Category is in use',
          `It still has ${items} products and ${children} sub-categories`,
        );
      }
      await tx
        .update(categories)
        .set({ deletedAt: sql`now()`, ...touch() })
        .where(eq(categories.id, id));
      await recordAudit(
        tx,
        audit(actor, 'category.deleted', 'category', id, toCategoryDto(current)),
      );
    });
  }

  // ---------- sub-categories ----------

  async listSubCategories(query: ListSubCategoriesQuery) {
    const where: SQL[] = [isNull(subCategories.deletedAt)];
    if (query.categoryId) where.push(eq(subCategories.categoryId, query.categoryId));
    const [rows, totals] = await Promise.all([
      this.db
        .select()
        .from(subCategories)
        .where(and(...where))
        .orderBy(asc(subCategories.name), asc(subCategories.id))
        .limit(query.limit)
        .offset(query.offset),
      this.db
        .select({ total: count() })
        .from(subCategories)
        .where(and(...where)),
    ]);
    return toPage(rows.map(toSubCategoryDto), totals[0]?.total ?? 0, query);
  }

  async createSubCategory(actor: Principal, input: CreateSubCategory): Promise<SubCategoryDto> {
    return this.write(async () =>
      this.db.transaction(async (tx) => {
        await this.requireCategory(tx, input.categoryId);
        const [row] = await tx.insert(subCategories).values(input).returning();
        const after = toSubCategoryDto(row!);
        await recordAudit(
          tx,
          audit(actor, 'sub-category.created', 'sub-category', after.id, undefined, after),
        );
        return after;
      }),
    );
  }

  async updateSubCategory(
    actor: Principal,
    id: string,
    input: UpdateSubCategory,
  ): Promise<SubCategoryDto> {
    return this.write(async () =>
      this.db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(subCategories)
          .where(and(eq(subCategories.id, id), isNull(subCategories.deletedAt)))
          .for('update');
        if (!current) throw notFound(`Sub-category ${id} does not exist`);
        if (current.version !== input.version) {
          throw versionConflict('sub-category', current.version, input.version);
        }
        const [row] = await tx
          .update(subCategories)
          .set({ name: input.name, ...touch() })
          .where(eq(subCategories.id, id))
          .returning();
        const after = toSubCategoryDto(row!);
        await recordAudit(
          tx,
          audit(
            actor,
            'sub-category.updated',
            'sub-category',
            id,
            toSubCategoryDto(current),
            after,
          ),
        );
        return after;
      }),
    );
  }

  async deleteSubCategory(actor: Principal, id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(subCategories)
        .where(and(eq(subCategories.id, id), isNull(subCategories.deletedAt)))
        .for('update');
      if (!current) throw notFound(`Sub-category ${id} does not exist`);
      const [{ items } = { items: 0 }] = await tx
        .select({ items: count() })
        .from(products)
        .where(and(eq(products.subCategoryId, id), isNull(products.deletedAt)));
      if (items > 0) {
        throw conflict('sub-category-in-use', 'Sub-category is in use', `It has ${items} products`);
      }
      await tx
        .update(subCategories)
        .set({ deletedAt: sql`now()`, ...touch() })
        .where(eq(subCategories.id, id));
      await recordAudit(
        tx,
        audit(actor, 'sub-category.deleted', 'sub-category', id, toSubCategoryDto(current)),
      );
    });
  }

  // ---------- brands ----------

  async listBrands(page: Pagination) {
    const where = isNull(brands.deletedAt);
    const [rows, totals] = await Promise.all([
      this.db
        .select()
        .from(brands)
        .where(where)
        .orderBy(asc(brands.name), asc(brands.id))
        .limit(page.limit)
        .offset(page.offset),
      this.db.select({ total: count() }).from(brands).where(where),
    ]);
    return toPage(rows.map(toBrandDto), totals[0]?.total ?? 0, page);
  }

  async createBrand(actor: Principal, input: CreateBrand): Promise<BrandDto> {
    return this.write(async () =>
      this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(brands)
          .values({ name: input.name, country: input.country ?? null })
          .returning();
        const after = toBrandDto(row!);
        await recordAudit(tx, audit(actor, 'brand.created', 'brand', after.id, undefined, after));
        return after;
      }),
    );
  }

  async updateBrand(actor: Principal, id: string, input: UpdateBrand): Promise<BrandDto> {
    return this.write(async () =>
      this.db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(brands)
          .where(and(eq(brands.id, id), isNull(brands.deletedAt)))
          .for('update');
        if (!current) throw notFound(`Brand ${id} does not exist`);
        if (current.version !== input.version) {
          throw versionConflict('brand', current.version, input.version);
        }
        const changes: Partial<UpdateBrand> = { ...input };
        delete changes.version;
        const [row] = await tx
          .update(brands)
          .set({ ...changes, ...touch() })
          .where(eq(brands.id, id))
          .returning();
        const after = toBrandDto(row!);
        await recordAudit(
          tx,
          audit(actor, 'brand.updated', 'brand', id, toBrandDto(current), after),
        );
        return after;
      }),
    );
  }

  async deleteBrand(actor: Principal, id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(brands)
        .where(and(eq(brands.id, id), isNull(brands.deletedAt)))
        .for('update');
      if (!current) throw notFound(`Brand ${id} does not exist`);
      const [{ items } = { items: 0 }] = await tx
        .select({ items: count() })
        .from(products)
        .where(and(eq(products.brandId, id), isNull(products.deletedAt)));
      if (items > 0) {
        throw conflict('brand-in-use', 'Brand is in use', `It has ${items} products`);
      }
      await tx
        .update(brands)
        .set({ deletedAt: sql`now()`, ...touch() })
        .where(eq(brands.id, id));
      await recordAudit(tx, audit(actor, 'brand.deleted', 'brand', id, toBrandDto(current)));
    });
  }

  // ---------- products ----------

  async listProducts(query: ListProductsQuery) {
    const where: SQL[] = [isNull(products.deletedAt)];
    if (query.categoryId) where.push(eq(products.categoryId, query.categoryId));
    if (query.brandId) where.push(eq(products.brandId, query.brandId));
    if (query.status) where.push(eq(products.status, query.status));
    if (query.q) {
      const like = `%${escapeLike(query.q)}%`;
      where.push(
        or(
          ilike(products.name, like),
          ilike(products.sku, like),
          ilike(products.barcode, like),
        ) as SQL,
      );
    }
    if (query.lowStock) where.push(sql`${products.currentStock} <= ${products.reorderPoint}`);
    if (query.negativeMargin) {
      where.push(
        sql`${products.currentStock} > 0 and ${products.sellingPriceMinor} * ${products.currentStock} < ${products.stockValueMinor}`,
      );
    }
    const order = [
      ...query.sort.map((s) => (s.direction === 'asc' ? asc : desc)(PRODUCT_SORT[s.field] as SQL)),
      asc(products.id),
    ];
    const [rows, totals] = await Promise.all([
      this.db
        .select()
        .from(products)
        .where(and(...where))
        .orderBy(...order)
        .limit(query.limit)
        .offset(query.offset),
      this.db
        .select({ total: count() })
        .from(products)
        .where(and(...where)),
    ]);
    return toPage(rows.map(toProductDto), totals[0]?.total ?? 0, query);
  }

  async getProduct(id: string): Promise<ProductDto> {
    const [row] = await this.db
      .select()
      .from(products)
      .where(and(eq(products.id, id), isNull(products.deletedAt)));
    if (!row) throw notFound(`Product ${id} does not exist`);
    return toProductDto(row);
  }

  async createProduct(actor: Principal, input: CreateProduct): Promise<ProductDto> {
    return this.write(async () =>
      this.db.transaction(async (tx) => {
        await this.requireRefs(tx, input.categoryId, input.subCategoryId, input.brandId);
        const [row] = await tx
          .insert(products)
          .values({
            sku: input.sku,
            barcode: input.barcode ?? null,
            name: input.name,
            description: input.description ?? null,
            categoryId: input.categoryId,
            subCategoryId: input.subCategoryId ?? null,
            brandId: input.brandId ?? null,
            unitOfMeasure: input.unitOfMeasure,
            sellingPriceMinor: input.sellingPriceMinor,
            minSellingPriceMinor: input.minSellingPriceMinor ?? null,
            reorderPoint: input.reorderPoint,
            reorderQty: input.reorderQty,
          })
          .returning();
        const after = toProductDto(row!);
        await recordAudit(
          tx,
          audit(actor, 'product.created', 'product', after.id, undefined, after),
        );
        return after;
      }),
    );
  }

  async updateProduct(actor: Principal, id: string, input: UpdateProduct): Promise<ProductDto> {
    return this.write(async () =>
      this.db.transaction(async (tx) => {
        const current = await this.lockLiveProduct(tx, id);
        if (current.version !== input.version) {
          throw versionConflict('product', current.version, input.version);
        }
        if (
          input.categoryId !== undefined ||
          input.subCategoryId !== undefined ||
          input.brandId !== undefined
        ) {
          await this.requireRefs(
            tx,
            input.categoryId ?? current.categoryId,
            input.subCategoryId === undefined ? current.subCategoryId : input.subCategoryId,
            input.brandId === undefined ? current.brandId : input.brandId,
          );
        }
        const changes: Partial<UpdateProduct> = { ...input };
        delete changes.version;
        const [row] = await tx
          .update(products)
          .set({ ...changes, ...touch() })
          .where(eq(products.id, id))
          .returning();
        const after = toProductDto(row!);
        await recordAudit(
          tx,
          audit(actor, 'product.updated', 'product', id, toProductDto(current), after),
        );
        return after;
      }),
    );
  }

  /** A product leaves the catalogue only when nothing is on hand and nothing moved for 30 days. */
  async deleteProduct(actor: Principal, id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const current = await this.lockLiveProduct(tx, id);
      if (current.currentStock > 0) {
        throw conflict(
          'product-has-stock',
          'Product still has stock',
          `${current.currentStock} on hand`,
        );
      }
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const [{ recent } = { recent: 0 }] = await tx
        .select({ recent: count() })
        .from(inventoryMovements)
        .where(and(eq(inventoryMovements.productId, id), gte(inventoryMovements.createdAt, since)));
      if (recent > 0) {
        throw conflict(
          'product-recently-moved',
          'Product moved in the last 30 days',
          'Discontinue it instead; it can be removed once it has been quiet for 30 days',
        );
      }
      await tx
        .update(products)
        .set({ deletedAt: sql`now()`, ...touch() })
        .where(eq(products.id, id));
      await recordAudit(tx, audit(actor, 'product.deleted', 'product', id, toProductDto(current)));
    });
  }

  async listMovements(productId: string, page: Pagination) {
    await this.getProduct(productId);
    const where = eq(inventoryMovements.productId, productId);
    const [rows, totals] = await Promise.all([
      this.db
        .select()
        .from(inventoryMovements)
        .where(where)
        .orderBy(desc(inventoryMovements.createdAt), desc(inventoryMovements.id))
        .limit(page.limit)
        .offset(page.offset),
      this.db.select({ total: count() }).from(inventoryMovements).where(where),
    ]);
    const items: MovementDto[] = rows.map((m) => ({
      id: m.id,
      productId: m.productId,
      movementType: m.movementType,
      quantity: m.quantity,
      valueDeltaMinor: m.valueDeltaMinor,
      stockBefore: m.stockBefore,
      stockAfter: m.stockAfter,
      referenceType: m.referenceType,
      referenceId: m.referenceId,
      createdAt: m.createdAt.toISOString(),
    }));
    return toPage(items, totals[0]?.total ?? 0, page);
  }

  // ---------- helpers ----------

  private async lockLiveProduct(tx: Tx, id: string): Promise<ProductRow> {
    const [row] = await tx
      .select()
      .from(products)
      .where(and(eq(products.id, id), isNull(products.deletedAt)))
      .for('update');
    if (!row) throw notFound(`Product ${id} does not exist`);
    return row;
  }

  private async requireCategory(tx: Tx, id: string): Promise<void> {
    const [row] = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.id, id), isNull(categories.deletedAt)));
    if (!row) throw unprocessable('category-missing', 'Category does not exist', `Category ${id}`);
  }

  private async requireRefs(
    tx: Tx,
    categoryId: string,
    subCategoryId: string | null | undefined,
    brandId: string | null | undefined,
  ): Promise<void> {
    await this.requireCategory(tx, categoryId);
    if (subCategoryId) {
      const [sub] = await tx
        .select()
        .from(subCategories)
        .where(and(eq(subCategories.id, subCategoryId), isNull(subCategories.deletedAt)));
      if (!sub) {
        throw unprocessable('sub-category-missing', 'Sub-category does not exist', subCategoryId);
      }
      if (sub.categoryId !== categoryId) {
        throw unprocessable(
          'category-mismatch',
          'Sub-category belongs to a different category',
          `Sub-category ${subCategoryId} is not under category ${categoryId}`,
        );
      }
    }
    if (brandId) {
      const [brand] = await tx
        .select({ id: brands.id })
        .from(brands)
        .where(and(eq(brands.id, brandId), isNull(brands.deletedAt)));
      if (!brand) throw unprocessable('brand-missing', 'Brand does not exist', brandId);
    }
  }

  /** Turn a unique-violation into a readable 409 and let everything else through. */
  private async write<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (e) {
      if (e instanceof ProblemException) throw e;
      if (pgCode(e) === '23505') {
        throw conflict('duplicate', 'That name, SKU or barcode is already in use');
      }
      throw e;
    }
  }
}

function audit(
  actor: Principal,
  action: string,
  entityType: string,
  entityId: string,
  before?: unknown,
  after?: unknown,
) {
  return { actor: actor.userId, action, entityType, entityId, before, after };
}
