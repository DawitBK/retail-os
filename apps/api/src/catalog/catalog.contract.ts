import { pageSchema, paginationQuerySchema, sortQuerySchema } from '@retail/kit';
import { z } from 'zod';
import { CATEGORY_TYPES, PRODUCT_STATUSES } from '../db/schema.js';

export const idParamsSchema = z.object({ id: z.uuid() });

const name = z.string().trim().min(1).max(200);
const versionField = z
  .number()
  .int()
  .min(1)
  .describe('The version you last read; a mismatch returns 409');
const minor = z.number().int().min(0).max(1_000_000_000_00);

// ---- categories, sub-categories, brands ----

export const categorySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  type: z.enum(CATEGORY_TYPES),
  version: z.number().int().min(1),
});
export type CategoryDto = z.output<typeof categorySchema>;
export const createCategorySchema = z.object({ name, type: z.enum(CATEGORY_TYPES) }).strict();
export type CreateCategory = z.output<typeof createCategorySchema>;
export const updateCategorySchema = z.object({ version: versionField, name }).strict();
export type UpdateCategory = z.output<typeof updateCategorySchema>;

export const subCategorySchema = z.object({
  id: z.uuid(),
  categoryId: z.uuid(),
  name: z.string(),
  version: z.number().int().min(1),
});
export type SubCategoryDto = z.output<typeof subCategorySchema>;
export const createSubCategorySchema = z.object({ categoryId: z.uuid(), name }).strict();
export type CreateSubCategory = z.output<typeof createSubCategorySchema>;
export const updateSubCategorySchema = z.object({ version: versionField, name }).strict();
export type UpdateSubCategory = z.output<typeof updateSubCategorySchema>;
export const listSubCategoriesQuerySchema = paginationQuerySchema.extend({
  categoryId: z.uuid().optional(),
});
export type ListSubCategoriesQuery = z.output<typeof listSubCategoriesQuerySchema>;

export const brandSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  country: z.string().nullable(),
  version: z.number().int().min(1),
});
export type BrandDto = z.output<typeof brandSchema>;
export const createBrandSchema = z
  .object({ name, country: z.string().trim().min(1).max(100).optional() })
  .strict();
export type CreateBrand = z.output<typeof createBrandSchema>;
export const updateBrandSchema = z
  .object({
    version: versionField,
    name: name.optional(),
    country: z.string().trim().min(1).max(100).nullable().optional(),
  })
  .strict()
  .refine((v) => v.name !== undefined || v.country !== undefined, {
    message: 'Provide at least one field to change',
  });
export type UpdateBrand = z.output<typeof updateBrandSchema>;

export const categoryPageSchema = pageSchema(categorySchema);
export const subCategoryPageSchema = pageSchema(subCategorySchema);
export const brandPageSchema = pageSchema(brandSchema);

// ---- products ----

export const productSchema = z.object({
  id: z.uuid(),
  sku: z.string(),
  barcode: z.string().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  categoryId: z.uuid(),
  subCategoryId: z.uuid().nullable(),
  brandId: z.uuid().nullable(),
  unitOfMeasure: z.string(),
  sellingPriceMinor: z.number().int().min(0),
  minSellingPriceMinor: z.number().int().min(0).nullable(),
  currentStock: z.number().int().min(0),
  stockValueMinor: z.number().int().min(0).describe('What the units on hand cost in total'),
  wacMinor: z
    .number()
    .int()
    .min(0)
    .nullable()
    .describe('Weighted average cost per unit (stock value / stock), null when none on hand'),
  negativeMargin: z.boolean().describe('Selling for less than it costs'),
  reorderPoint: z.number().int().min(0),
  reorderQty: z.number().int().min(0),
  status: z.enum(PRODUCT_STATUSES),
  lastSoldAt: z.iso.datetime().nullable(),
  lastRestockedAt: z.iso.datetime().nullable(),
  version: z.number().int().min(1),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type ProductDto = z.output<typeof productSchema>;

/** There is no stock field: stock only ever arrives through purchases, opening balances and adjustments. */
export const createProductSchema = z
  .object({
    sku: z.string().trim().min(1).max(64),
    barcode: z.string().trim().min(1).max(64).optional(),
    name,
    description: z.string().trim().min(1).max(2000).optional(),
    categoryId: z.uuid(),
    subCategoryId: z.uuid().optional(),
    brandId: z.uuid().optional(),
    unitOfMeasure: z.string().trim().min(1).max(30).default('piece'),
    sellingPriceMinor: minor,
    minSellingPriceMinor: minor.optional(),
    reorderPoint: z.number().int().min(0).max(100000).default(5),
    reorderQty: z.number().int().min(0).max(100000).default(10),
  })
  .strict();
export type CreateProduct = z.output<typeof createProductSchema>;

export const updateProductSchema = z
  .object({
    version: versionField,
    sku: z.string().trim().min(1).max(64).optional(),
    barcode: z.string().trim().min(1).max(64).nullable().optional(),
    name: name.optional(),
    description: z.string().trim().min(1).max(2000).nullable().optional(),
    categoryId: z.uuid().optional(),
    subCategoryId: z.uuid().nullable().optional(),
    brandId: z.uuid().nullable().optional(),
    unitOfMeasure: z.string().trim().min(1).max(30).optional(),
    sellingPriceMinor: minor.optional(),
    minSellingPriceMinor: minor.nullable().optional(),
    reorderPoint: z.number().int().min(0).max(100000).optional(),
    reorderQty: z.number().int().min(0).max(100000).optional(),
    status: z.enum(PRODUCT_STATUSES).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).some((k) => k !== 'version'), {
    message: 'Provide at least one field to change',
  });
export type UpdateProduct = z.output<typeof updateProductSchema>;

export const PRODUCT_SORT_FIELDS = [
  'name',
  'sku',
  'sellingPriceMinor',
  'currentStock',
  'createdAt',
] as const;
export type ProductSortField = (typeof PRODUCT_SORT_FIELDS)[number];

const flag = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();

export const listProductsQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().min(1).max(100).optional().describe('Name, SKU or barcode'),
  categoryId: z.uuid().optional(),
  brandId: z.uuid().optional(),
  status: z.enum(PRODUCT_STATUSES).optional(),
  lowStock: flag.describe('Only products at or below their reorder point'),
  negativeMargin: flag.describe('Only products selling for less than they cost'),
  sort: sortQuerySchema(PRODUCT_SORT_FIELDS, [{ field: 'name', direction: 'asc' }]),
});
export type ListProductsQuery = z.output<typeof listProductsQuerySchema>;
export const productPageSchema = pageSchema(productSchema);

export const movementSchema = z.object({
  id: z.uuid(),
  productId: z.uuid(),
  movementType: z.string(),
  quantity: z.number().int(),
  valueDeltaMinor: z.number().int(),
  stockBefore: z.number().int(),
  stockAfter: z.number().int(),
  referenceType: z.string().nullable(),
  referenceId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
});
export type MovementDto = z.output<typeof movementSchema>;
export const movementPageSchema = pageSchema(movementSchema);
