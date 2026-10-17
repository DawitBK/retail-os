import { pageSchema, paginationQuerySchema } from '@retail/kit';
import { z } from 'zod';
import { PAYMENT_STATUSES, PURCHASE_STATUSES, SETTLEMENT_METHODS } from '../db/schema.js';

export const idParamsSchema = z.object({ id: z.uuid() });

const minor = z.number().int().min(0).max(1_000_000_000_00);

export const purchaseItemSchema = z.object({
  id: z.uuid(),
  productId: z.uuid(),
  productName: z.string(),
  orderedQty: z.number().int().min(1),
  receivedQty: z.number().int().min(0),
  unitCostMinor: z.number().int().min(0),
});

export const purchaseSchema = z.object({
  id: z.uuid(),
  number: z.string(),
  supplierId: z.uuid(),
  status: z.enum(PURCHASE_STATUSES),
  orderDate: z.iso.date(),
  expectedDate: z.iso.date().nullable(),
  receivedDate: z.iso.date().nullable(),
  totalMinor: z.number().int().min(0).describe('What was ordered, at the agreed unit costs'),
  receivedValueMinor: z.number().int().min(0).describe('What has arrived so far: what we owe for'),
  paidMinor: z.number().int().min(0),
  payableMinor: z.number().int().min(0).describe('Received and not yet paid for'),
  paymentStatus: z.enum(PAYMENT_STATUSES),
  items: z.array(purchaseItemSchema),
  notes: z.string().nullable(),
  version: z.number().int().min(1),
  createdAt: z.iso.datetime(),
});
export type PurchaseDto = z.output<typeof purchaseSchema>;

export const createPurchaseSchema = z
  .object({
    supplierId: z.uuid(),
    expectedDate: z.iso.date().optional(),
    notes: z.string().trim().min(1).max(500).optional(),
    items: z
      .array(
        z
          .object({
            productId: z.uuid(),
            orderedQty: z.number().int().min(1).max(1_000_000),
            unitCostMinor: minor,
          })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict();
export type CreatePurchase = z.output<typeof createPurchaseSchema>;

/** Receive some or all of an order. Each line can only be received up to what is still outstanding. */
export const receivePurchaseSchema = z
  .object({
    items: z
      .array(
        z.object({ itemId: z.uuid(), quantity: z.number().int().min(1).max(1_000_000) }).strict(),
      )
      .min(1)
      .max(200),
  })
  .strict();
export type ReceivePurchase = z.output<typeof receivePurchaseSchema>;

export const createSupplierPaymentSchema = z
  .object({
    amountMinor: minor.refine((n) => n > 0, 'Must be above zero'),
    method: z.enum(SETTLEMENT_METHODS),
  })
  .strict();
export type CreateSupplierPayment = z.output<typeof createSupplierPaymentSchema>;

export const supplierPaymentSchema = z.object({
  id: z.uuid(),
  purchaseId: z.uuid(),
  amountMinor: z.number().int().min(1),
  method: z.enum(SETTLEMENT_METHODS),
  paidAt: z.iso.datetime(),
  payableMinor: z.number().int().min(0).describe('Still owed on the order after this payment'),
});
export type SupplierPaymentDto = z.output<typeof supplierPaymentSchema>;

export const listPurchasesQuerySchema = paginationQuerySchema.extend({
  supplierId: z.uuid().optional(),
  status: z.enum(PURCHASE_STATUSES).optional(),
  paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
});
export type ListPurchasesQuery = z.output<typeof listPurchasesQuerySchema>;
export const purchasePageSchema = pageSchema(purchaseSchema);
