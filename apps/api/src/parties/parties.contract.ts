import { pageSchema, paginationQuerySchema } from '@retail/kit';
import { z } from 'zod';
import { CUSTOMER_TYPES } from '../db/schema.js';

export const idParamsSchema = z.object({ id: z.uuid() });

const name = z.string().trim().min(1).max(200);
const email = z.string().trim().toLowerCase().max(254).pipe(z.email());
const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ()-]{6,20}$/, 'Not a plausible phone number');
const text = z.string().trim().min(1).max(300);
const versionField = z
  .number()
  .int()
  .min(1)
  .describe('The version you last read; a mismatch returns 409');

// ---- customers ----

export const customerSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  address: z.string().nullable(),
  city: z.string().nullable(),
  type: z.enum(CUSTOMER_TYPES),
  creditLimitMinor: z.number().int().min(0),
  outstandingMinor: z
    .number()
    .int()
    .min(0)
    .describe('What the customer owes on credit sales, worked out from the sales themselves'),
  notes: z.string().nullable(),
  version: z.number().int().min(1),
  createdAt: z.iso.datetime(),
});
export type CustomerDto = z.output<typeof customerSchema>;

export const createCustomerSchema = z
  .object({
    name,
    email: email.optional(),
    phone: phone.optional(),
    address: text.optional(),
    city: text.optional(),
    type: z.enum(CUSTOMER_TYPES).default('RETAIL'),
    notes: z.string().trim().min(1).max(1000).optional(),
  })
  .strict();
export type CreateCustomer = z.output<typeof createCustomerSchema>;

/** The credit limit is a managerial decision, so only update (manager and owner) can change it. */
export const updateCustomerSchema = z
  .object({
    version: versionField,
    name: name.optional(),
    email: email.nullable().optional(),
    phone: phone.nullable().optional(),
    address: text.nullable().optional(),
    city: text.nullable().optional(),
    type: z.enum(CUSTOMER_TYPES).optional(),
    creditLimitMinor: z.number().int().min(0).max(1_000_000_000_00).optional(),
    notes: z.string().trim().min(1).max(1000).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).some((k) => k !== 'version'), {
    message: 'Provide at least one field to change',
  });
export type UpdateCustomer = z.output<typeof updateCustomerSchema>;

export const listCustomersQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().min(1).max(100).optional().describe('Name, phone or email'),
  type: z.enum(CUSTOMER_TYPES).optional(),
});
export type ListCustomersQuery = z.output<typeof listCustomersQuerySchema>;
export const customerPageSchema = pageSchema(customerSchema);

// ---- suppliers ----

export const supplierSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  contactPerson: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  address: z.string().nullable(),
  city: z.string().nullable(),
  country: z.string().nullable(),
  paymentTermsDays: z.number().int().min(0),
  payableMinor: z
    .number()
    .int()
    .min(0)
    .describe('What we owe this supplier for goods received and not yet paid for'),
  notes: z.string().nullable(),
  version: z.number().int().min(1),
  createdAt: z.iso.datetime(),
});
export type SupplierDto = z.output<typeof supplierSchema>;

export const createSupplierSchema = z
  .object({
    name,
    contactPerson: text.optional(),
    email: email.optional(),
    phone: phone.optional(),
    address: text.optional(),
    city: text.optional(),
    country: text.optional(),
    paymentTermsDays: z.number().int().min(0).max(365).default(0),
    notes: z.string().trim().min(1).max(1000).optional(),
  })
  .strict();
export type CreateSupplier = z.output<typeof createSupplierSchema>;

export const updateSupplierSchema = z
  .object({
    version: versionField,
    name: name.optional(),
    contactPerson: text.nullable().optional(),
    email: email.nullable().optional(),
    phone: phone.nullable().optional(),
    address: text.nullable().optional(),
    city: text.nullable().optional(),
    country: text.nullable().optional(),
    paymentTermsDays: z.number().int().min(0).max(365).optional(),
    notes: z.string().trim().min(1).max(1000).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).some((k) => k !== 'version'), {
    message: 'Provide at least one field to change',
  });
export type UpdateSupplier = z.output<typeof updateSupplierSchema>;

export const listSuppliersQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().min(1).max(100).optional().describe('Name, contact, phone or email'),
});
export type ListSuppliersQuery = z.output<typeof listSuppliersQuerySchema>;
export const supplierPageSchema = pageSchema(supplierSchema);
