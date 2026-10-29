import { pageSchema, paginationQuerySchema } from '@retail/kit';
import { z } from 'zod';

const date = z.iso.date();
const minor = z.number().int();
const pct = z.number().nullable();

// ---- queries ----

export const windowQuerySchema = z.object({
  days: z.coerce.number().int().min(7).max(365).default(90),
});
export type WindowQuery = z.output<typeof windowQuerySchema>;

export const productHealthQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().min(1).max(100).optional(),
  movement: z.enum(['FAST', 'NORMAL', 'SLOW', 'DEAD']).optional(),
  flag: z.enum(['OUT_OF_STOCK', 'LOW_STOCK', 'NEGATIVE_MARGIN']).optional(),
  categoryId: z.uuid().optional(),
  brandId: z.uuid().optional(),
});
export type ProductHealthQuery = z.output<typeof productHealthQuerySchema>;

export const profitabilityQuerySchema = z
  .object({
    by: z.enum(['category', 'sub-category', 'brand', 'product']).default('category'),
    from: date.optional(),
    to: date.optional(),
    order: z.enum(['best', 'worst']).default('best'),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, { message: 'from must not be after to' });
export type ProfitabilityQuery = z.output<typeof profitabilityQuerySchema>;

export const cashflowQuerySchema = z.object({
  weeks: z.coerce.number().int().min(1).max(52).default(12),
});
export type CashflowQuery = z.output<typeof cashflowQuerySchema>;

export const trajectoryQuerySchema = z.object({
  months: z.coerce.number().int().min(2).max(24).default(6),
});
export type TrajectoryQuery = z.output<typeof trajectoryQuerySchema>;

export const forecastQuerySchema = z.object({
  leadTimeDays: z.coerce.number().int().min(0).max(120).default(7),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ForecastQuery = z.output<typeof forecastQuerySchema>;

export const productIdParamsSchema = z.object({ id: z.uuid() });

// ---- responses ----

export const productHealthRowSchema = z.object({
  id: z.uuid(),
  sku: z.string(),
  name: z.string(),
  category: z.string(),
  brand: z.string().nullable(),
  currentStock: z.number().int(),
  reorderPoint: z.number().int(),
  averageCostMinor: minor.describe('Weighted average cost of the units on hand; 0 when none'),
  sellingPriceMinor: minor,
  marginPct: pct.describe('(price - average cost) / price; null when there is no stock to cost'),
  stockValueMinor: minor,
  unitsSold30: z.number().int(),
  velocityPerDay: z.number(),
  daysOfStock: z.number().nullable().describe('Null when nothing sold in the last 30 days'),
  movement: z.enum(['FAST', 'NORMAL', 'SLOW', 'DEAD']),
  outOfStock: z.boolean(),
  lowStock: z.boolean(),
  negativeMargin: z.boolean(),
  lastSoldAt: z.iso.datetime().nullable(),
});
export type ProductHealthRow = z.output<typeof productHealthRowSchema>;
export const productHealthPageSchema = pageSchema(productHealthRowSchema);

export const productAnalyticsSchema = z.object({
  productId: z.uuid(),
  name: z.string(),
  velocityPerDay: z.number(),
  unitsSold30: z.number().int(),
  daysOfStock: z.number().nullable(),
  marginPct: pct,
  daysInventoryOutstanding: z.number().nullable(),
  gmroi: z.number().nullable().describe('Annualised gross profit over the cost of stock on hand'),
  stockCoverageDays: z.number().nullable(),
  capitalLockedMinor: minor,
  last30Days: z.array(z.object({ date: z.iso.date(), units: z.number().int() })),
});

export const inventoryAnalyticsSchema = z.object({
  asOf: z.iso.date(),
  windowDays: z.number().int(),
  cogsMinor: minor,
  grossProfitMinor: minor,
  openingValueMinor: minor,
  closingValueMinor: minor,
  averageValueMinor: minor,
  turnover: z
    .number()
    .nullable()
    .describe('Annualised: cost of goods sold over average stock value'),
  daysInventoryOutstanding: z.number().nullable(),
  gmroi: z.number().nullable(),
  sellThroughPct: pct,
  unitsSold: z.number().int(),
  unitsReceived: z.number().int(),
  deadStockValueMinor: minor,
  shrinkagePct: pct.describe('Value lost to counts and write-offs over the average stock value'),
  aging: z.array(
    z.object({
      bucket: z.enum(['0-30', '31-60', '61-90', '90+']),
      products: z.number().int(),
      valueMinor: minor,
    }),
  ),
  deadStock: z.array(
    z.object({
      productId: z.uuid(),
      name: z.string(),
      stock: z.number().int(),
      daysSinceLastSale: z.number().int(),
      capitalLockedMinor: minor,
    }),
  ),
});

export const profitabilitySchema = z.object({
  by: z.enum(['category', 'sub-category', 'brand', 'product']),
  from: z.iso.date(),
  to: z.iso.date(),
  rows: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      unitsSold: z.number().int(),
      revenueMinor: minor,
      cogsMinor: minor,
      grossProfitMinor: minor,
      marginPct: pct,
    }),
  ),
});

export const cashflowAnalyticsSchema = z.object({
  weeks: z.array(
    z.object({
      weekStart: z.iso.date(),
      inflowMinor: minor,
      outflowMinor: minor,
      netMinor: minor,
      endingCashMinor: minor,
    }),
  ),
  payablesAging: z.array(
    z.object({ bucket: z.string(), amountMinor: minor, count: z.number().int() }),
  ),
  receivablesAging: z.array(
    z.object({ bucket: z.string(), amountMinor: minor, count: z.number().int() }),
  ),
});

export const trajectorySchema = z.object({
  months: z.array(
    z.object({
      month: z.string().regex(/^\d{4}-\d{2}$/),
      revenueMinor: minor,
      cogsMinor: minor,
      grossProfitMinor: minor,
      grossMarginPct: pct,
      expensesMinor: minor,
      expenseRatioPct: pct,
      netProfitMinor: minor,
      endingCashMinor: minor,
      inventoryValueMinor: minor,
    }),
  ),
});

export const cashFlowStatementSchema = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  openingCashMinor: minor,
  receipts: z.array(z.object({ label: z.string(), amountMinor: minor })),
  payments: z.array(z.object({ label: z.string(), amountMinor: minor })),
  totalReceiptsMinor: minor,
  totalPaymentsMinor: minor,
  netChangeMinor: minor,
  closingCashMinor: minor,
  reconciled: z
    .boolean()
    .describe('Closing cash equals cash in hand plus cash at bank in the ledger'),
});

const forecastBase = {
  productId: z.uuid(),
  sku: z.string(),
  name: z.string(),
  currentStock: z.number().int(),
};
export const reorderForecastSchema = z.object({
  asOf: z.iso.date(),
  leadTimeDays: z.number().int(),
  note: z.string(),
  rows: z.array(
    z.object({
      ...forecastBase,
      reorderPoint: z.number().int(),
      velocityPerDay: z.number(),
      daysUntilStockout: z.number().nullable(),
      stockoutDate: date.nullable(),
      reorderByDate: date.nullable(),
      urgencyScore: z.number(),
    }),
  ),
});
export const deadStockForecastSchema = z.object({
  asOf: z.iso.date(),
  note: z.string(),
  rows: z.array(
    z.object({
      ...forecastBase,
      daysSinceLastSale: z.number().int(),
      capitalLockedMinor: minor,
      riskScore: z.number(),
    }),
  ),
});
export const salesForecastSchema = z.object({
  asOf: z.iso.date(),
  note: z.string(),
  rows: z.array(
    z.object({
      ...forecastBase,
      unitsSold30: z.number().int(),
      predictedUnits30: z.number().int(),
      predictedRevenueMinor: minor,
      predictedEndStock: z.number().int(),
    }),
  ),
});
export const suggestionsSchema = z.object({
  asOf: z.iso.date(),
  note: z.string(),
  suppliers: z.array(
    z.object({
      supplierId: z.uuid().nullable(),
      supplierName: z.string(),
      totalMinor: minor,
      lines: z.array(
        z.object({
          productId: z.uuid(),
          name: z.string(),
          currentStock: z.number().int(),
          suggestedQty: z.number().int(),
          unitCostMinor: minor,
          lineTotalMinor: minor,
        }),
      ),
    }),
  ),
});

export const FORECAST_NOTE = 'Based on a 30-day moving average of units sold. For guidance only.';
