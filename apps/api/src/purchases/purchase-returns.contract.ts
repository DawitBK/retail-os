import { pageSchema, paginationQuerySchema } from '@retail/kit';
import { z } from 'zod';
import { SETTLEMENT_METHODS } from '../db/schema.js';

export const idParamsSchema = z.object({ id: z.uuid() });

export const createPurchaseReturnSchema = z
  .object({
    reason: z.string().trim().min(3).max(500),
    refundMethod: z
      .enum(SETTLEMENT_METHODS)
      .optional()
      .describe(
        'How the supplier pays back money already paid; not needed when it all cancels a debt',
      ),
    items: z
      .array(
        z
          .object({
            purchaseItemId: z.uuid(),
            quantity: z.number().int().min(1).max(1_000_000),
          })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict();
export type CreatePurchaseReturn = z.output<typeof createPurchaseReturnSchema>;

export const purchaseReturnSchema = z.object({
  id: z.uuid(),
  number: z.string(),
  purchaseId: z.uuid(),
  reason: z.string(),
  valueMinor: z.number().int().min(1).describe('The supplier credits us for this much'),
  creditAppliedMinor: z
    .number()
    .int()
    .min(0)
    .describe('The part that cancelled what we still owed'),
  refundMinor: z.number().int().min(0).describe('The part the supplier pays back as money'),
  refundMethod: z.enum(SETTLEMENT_METHODS).nullable(),
  items: z.array(
    z.object({
      purchaseItemId: z.uuid(),
      productId: z.uuid(),
      quantity: z.number().int().min(1),
      valueMinor: z.number().int().min(0),
      stockCostMinor: z.number().int().min(0).describe('What the units were worth on our shelf'),
    }),
  ),
  createdAt: z.iso.datetime(),
});
export type PurchaseReturnDto = z.output<typeof purchaseReturnSchema>;

export const listPurchaseReturnsQuerySchema = paginationQuerySchema.extend({
  purchaseId: z.uuid().optional(),
});
export type ListPurchaseReturnsQuery = z.output<typeof listPurchaseReturnsQuerySchema>;
export const purchaseReturnPageSchema = pageSchema(purchaseReturnSchema);
