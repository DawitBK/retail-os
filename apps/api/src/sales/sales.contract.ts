import { pageSchema, paginationQuerySchema, sortQuerySchema } from '@retail/kit';
import { z } from 'zod';
import { PAYMENT_METHODS, SALE_STATUSES, SETTLEMENT_METHODS } from '../db/schema.js';

export const idParamsSchema = z.object({ id: z.uuid() });

export const idempotencyHeaderSchema = z.object({
  'idempotency-key': z
    .string()
    .min(1)
    .max(128)
    .optional()
    .describe('Replays the stored response when the same key is sent again'),
});

const minor = z.number().int().min(0).max(1_000_000_000_00);

export const saleItemSchema = z.object({
  productId: z.uuid(),
  productName: z.string(),
  quantity: z.number().int().min(1),
  unitPriceMinor: z.number().int().min(0),
  discountMinor: z.number().int().min(0),
  lineTotalMinor: z.number().int().min(0),
  lineCogsMinor: z.number().int().min(0),
});

export const saleSchema = z.object({
  id: z.uuid(),
  number: z.string(),
  customerId: z.uuid().nullable(),
  saleDate: z.iso.datetime(),
  status: z.enum(SALE_STATUSES),
  subtotalMinor: z.number().int().min(0),
  discountMinor: z.number().int().min(0),
  totalMinor: z.number().int().min(0),
  cogsMinor: z.number().int().min(0),
  grossProfitMinor: z.number().int().describe('Total minus cost of goods sold (can be negative)'),
  paymentMethod: z.enum(PAYMENT_METHODS),
  amountPaidMinor: z.number().int().min(0),
  changeGivenMinor: z.number().int().min(0),
  outstandingMinor: z.number().int().min(0).describe('Still owed on a credit sale'),
  items: z.array(saleItemSchema),
  journalEntryNumber: z.string().nullable(),
  notes: z.string().nullable(),
  createdBy: z.uuid(),
  voidedAt: z.iso.datetime().nullable(),
  voidReason: z.string().nullable(),
  version: z.number().int().min(1),
});
export type SaleDto = z.output<typeof saleSchema>;

export const createSaleItemSchema = z
  .object({
    productId: z.uuid(),
    quantity: z.number().int().min(1).max(100_000),
    unitPriceMinor: minor
      .optional()
      .describe('Manager or owner only: sell at a price other than the list price'),
    discountMinor: minor.optional().describe('Manager or owner only: a discount on this line'),
  })
  .strict();

/**
 * There is no cost, total or stock in a request: the server prices every line from the catalogue,
 * takes the cost from the inventory value and computes the totals. The till only says what was
 * bought, who bought it and how it was paid.
 */
export const createSaleSchema = z
  .object({
    customerId: z.uuid().optional(),
    paymentMethod: z.enum(PAYMENT_METHODS),
    amountPaidMinor: minor
      .optional()
      .describe('Cash tendered, or the deposit on a credit sale. Defaults to the total.'),
    notes: z.string().trim().min(1).max(500).optional(),
    items: z.array(createSaleItemSchema).min(1).max(200),
  })
  .strict();
export type CreateSale = z.output<typeof createSaleSchema>;

export const voidSaleSchema = z.object({ reason: z.string().trim().min(3).max(500) }).strict();
export type VoidSale = z.output<typeof voidSaleSchema>;

export const createReceiptSchema = z
  .object({
    amountMinor: minor.refine((n) => n > 0, 'Must be above zero'),
    method: z.enum(SETTLEMENT_METHODS),
  })
  .strict();
export type CreateReceipt = z.output<typeof createReceiptSchema>;

export const receiptSchema = z.object({
  id: z.uuid(),
  saleId: z.uuid(),
  amountMinor: z.number().int().min(1),
  method: z.enum(SETTLEMENT_METHODS),
  paidAt: z.iso.datetime(),
  outstandingMinor: z
    .number()
    .int()
    .min(0)
    .describe('What is still owed on the sale after this payment'),
});
export type ReceiptDto = z.output<typeof receiptSchema>;

export const SALE_SORT_FIELDS = ['saleDate', 'totalMinor'] as const;
export const listSalesQuerySchema = paginationQuerySchema.extend({
  customerId: z.uuid().optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).optional(),
  status: z.enum(SALE_STATUSES).optional(),
  from: z.iso.date().optional().describe('First business day (inclusive)'),
  to: z.iso.date().optional().describe('Last business day (inclusive)'),
  sort: sortQuerySchema(SALE_SORT_FIELDS, [{ field: 'saleDate', direction: 'desc' }]),
});
export type ListSalesQuery = z.output<typeof listSalesQuerySchema>;
export const salePageSchema = pageSchema(saleSchema);
