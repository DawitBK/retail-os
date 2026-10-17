import { pageSchema, paginationQuerySchema } from '@retail/kit';
import { z } from 'zod';
import { AUDIT_STATUSES, DAMAGE_KINDS, DAMAGE_STATUSES, SETTLEMENT_METHODS } from '../db/schema.js';

export const idParamsSchema = z.object({ id: z.uuid() });

// ---- sale returns ----

export const returnItemInputSchema = z
  .object({
    saleItemId: z.uuid(),
    quantity: z.number().int().min(1).max(100_000),
    restockable: z.boolean().describe('Fit to sell again: the stock and its cost come back'),
  })
  .strict();

export const createReturnSchema = z
  .object({
    reason: z.string().trim().min(3).max(500),
    refundMethod: z
      .enum(SETTLEMENT_METHODS)
      .optional()
      .describe(
        'How the cash part of the refund is paid out; not needed when it all cancels a debt',
      ),
    items: z.array(returnItemInputSchema).min(1).max(200),
  })
  .strict();
export type CreateReturn = z.output<typeof createReturnSchema>;

export const saleReturnSchema = z.object({
  id: z.uuid(),
  number: z.string(),
  saleId: z.uuid(),
  reason: z.string(),
  refundMinor: z.number().int().min(1),
  appliedToReceivableMinor: z.number().int().min(0),
  cashRefundMinor: z.number().int().min(0),
  refundMethod: z.enum(SETTLEMENT_METHODS).nullable(),
  items: z.array(
    z.object({
      saleItemId: z.uuid(),
      productId: z.uuid(),
      quantity: z.number().int().min(1),
      restockable: z.boolean(),
      refundMinor: z.number().int().min(0),
      costMinor: z.number().int().min(0),
    }),
  ),
  createdAt: z.iso.datetime(),
});
export type SaleReturnDto = z.output<typeof saleReturnSchema>;
export const returnPageSchema = pageSchema(saleReturnSchema);
export const listReturnsQuerySchema = paginationQuerySchema.extend({ saleId: z.uuid().optional() });
export type ListReturnsQuery = z.output<typeof listReturnsQuerySchema>;

// ---- damage and write-off ----

export const damageSchema = z.object({
  id: z.uuid(),
  number: z.string(),
  productId: z.uuid(),
  kind: z.enum(DAMAGE_KINDS),
  quantity: z.number().int().min(1),
  cause: z.string(),
  status: z.enum(DAMAGE_STATUSES),
  reportedBy: z.uuid(),
  decidedBy: z.uuid().nullable(),
  decidedAt: z.iso.datetime().nullable(),
  decisionNote: z.string().nullable(),
  lossMinor: z.number().int().nullable().describe('Cost written off, fixed at approval'),
  version: z.number().int().min(1),
  createdAt: z.iso.datetime(),
});
export type DamageDto = z.output<typeof damageSchema>;

export const createDamageSchema = z
  .object({
    productId: z.uuid(),
    kind: z.enum(DAMAGE_KINDS),
    quantity: z.number().int().min(1).max(100_000),
    cause: z.string().trim().min(3).max(500),
  })
  .strict();
export type CreateDamage = z.output<typeof createDamageSchema>;

export const decideDamageSchema = z
  .object({ note: z.string().trim().min(3).max(500).optional() })
  .strict();
export type DecideDamage = z.output<typeof decideDamageSchema>;

export const rejectDamageSchema = z.object({ note: z.string().trim().min(3).max(500) }).strict();
export type RejectDamage = z.output<typeof rejectDamageSchema>;

export const listDamageQuerySchema = paginationQuerySchema.extend({
  status: z.enum(DAMAGE_STATUSES).optional(),
  productId: z.uuid().optional(),
});
export type ListDamageQuery = z.output<typeof listDamageQuerySchema>;
export const damagePageSchema = pageSchema(damageSchema);

// ---- stock audits ----

export const createAuditSchema = z
  .object({
    productIds: z.array(z.uuid()).min(1).max(500),
    notes: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
export type CreateAudit = z.output<typeof createAuditSchema>;

export const submitCountsSchema = z
  .object({
    counts: z
      .array(
        z
          .object({ productId: z.uuid(), physicalQty: z.number().int().min(0).max(10_000_000) })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();
export type SubmitCounts = z.output<typeof submitCountsSchema>;

export const auditSchema = z.object({
  id: z.uuid(),
  number: z.string(),
  status: z.enum(AUDIT_STATUSES),
  notes: z.string().nullable(),
  startedBy: z.uuid(),
  approvedBy: z.uuid().nullable(),
  items: z.array(
    z.object({
      productId: z.uuid(),
      productName: z.string(),
      systemQty: z.number().int().nullable(),
      physicalQty: z.number().int().nullable(),
      variance: z
        .number()
        .int()
        .nullable()
        .describe('Physical minus system; negative is a shortage'),
      adjustmentValueMinor: z.number().int().nullable(),
    }),
  ),
  shortageUnits: z.number().int().min(0),
  overageUnits: z.number().int().min(0),
  version: z.number().int().min(1),
  createdAt: z.iso.datetime(),
});
export type AuditDto = z.output<typeof auditSchema>;

export const listAuditsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(AUDIT_STATUSES).optional(),
});
export type ListAuditsQuery = z.output<typeof listAuditsQuerySchema>;
export const auditSummarySchema = auditSchema.omit({ items: true });
export const auditPageSchema = pageSchema(auditSummarySchema);

// ---- alerts and dashboard ----

export const alertSchema = z.object({
  type: z.enum([
    'OUT_OF_STOCK',
    'LOW_STOCK',
    'NEGATIVE_MARGIN',
    'DEAD_STOCK',
    'DAMAGE_PENDING_APPROVAL',
  ]),
  severity: z.enum(['INFO', 'WARNING', 'CRITICAL']),
  productId: z.uuid().nullable(),
  title: z.string(),
  message: z.string(),
  valueMinor: z.number().int().nullable().describe('Capital tied up, where that is the point'),
});
export const alertsSchema = z.object({
  alerts: z.array(alertSchema),
  counts: z.object({
    critical: z.number().int(),
    warning: z.number().int(),
    info: z.number().int(),
  }),
});

const day = z.object({
  date: z.iso.date(),
  revenueMinor: z.number().int(),
  cogsMinor: z.number().int(),
  grossProfitMinor: z.number().int(),
});
const kpis = z.object({
  revenueMinor: z.number().int(),
  cogsMinor: z.number().int(),
  grossProfitMinor: z.number().int(),
  grossMarginPct: z.number().nullable(),
  expensesMinor: z.number().int(),
  netProfitMinor: z.number().int(),
});
export const dashboardSchema = z.object({
  asOf: z.iso.date(),
  today: kpis.extend({
    transactions: z.number().int(),
    averageTransactionMinor: z.number().int(),
  }),
  monthToDate: kpis,
  inventory: z.object({
    totalValueMinor: z.number().int(),
    skus: z.number().int(),
    outOfStock: z.number().int(),
    lowStock: z.number().int(),
    negativeMargin: z.number().int(),
    deadStock: z.number().int(),
    deadStockValueMinor: z.number().int(),
  }),
  cash: z.object({
    cashInHandMinor: z.number().int(),
    cashInBankMinor: z.number().int(),
    receivablesMinor: z.number().int(),
    payablesMinor: z.number().int(),
    workingCapitalMinor: z.number().int(),
  }),
  revenue30Days: z.array(day),
  topProducts: z.array(
    z.object({
      productId: z.uuid(),
      name: z.string(),
      unitsSold: z.number().int(),
      revenueMinor: z.number().int(),
      grossProfitMinor: z.number().int(),
    }),
  ),
});
