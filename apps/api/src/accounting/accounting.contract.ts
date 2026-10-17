import { pageSchema, paginationQuerySchema } from '@retail/kit';
import { z } from 'zod';
import { ACCOUNT_TYPES, SETTLEMENT_METHODS } from '../db/schema.js';
import { EXPENSE_ACCOUNTS } from './ledger.js';

export const idParamsSchema = z.object({ id: z.uuid() });
export const codeParamsSchema = z.object({ code: z.string().regex(/^\d{4}$/) });

const minor = z.number().int().min(0).max(1_000_000_000_00);
const date = z.iso.date();

// ---- chart of accounts and journal ----

export const accountSchema = z.object({
  code: z.string(),
  name: z.string(),
  type: z.enum(ACCOUNT_TYPES),
  normalBalance: z.enum(['DEBIT', 'CREDIT']),
  parentCode: z.string().nullable(),
  balanceMinor: z
    .number()
    .int()
    .describe(
      'In the account normal direction (a credit balance on a credit-normal account is positive)',
    ),
});
export type AccountDto = z.output<typeof accountSchema>;

export const journalLineSchema = z.object({
  accountCode: z.string(),
  accountName: z.string(),
  debitMinor: z.number().int().min(0),
  creditMinor: z.number().int().min(0),
});
export const journalEntrySchema = z.object({
  id: z.uuid(),
  entryNumber: z.string(),
  entryDate: z.iso.date(),
  description: z.string(),
  referenceType: z.string().nullable(),
  referenceId: z.uuid().nullable(),
  status: z.enum(['POSTED', 'VOIDED']),
  totalMinor: z.number().int().min(1),
  reversesEntryId: z.uuid().nullable(),
  lines: z.array(journalLineSchema),
});
export type JournalEntryDto = z.output<typeof journalEntrySchema>;

export const listJournalQuerySchema = paginationQuerySchema.extend({
  from: date.optional(),
  to: date.optional(),
  referenceType: z.string().trim().min(1).max(40).optional(),
});
export type ListJournalQuery = z.output<typeof listJournalQuerySchema>;
export const journalPageSchema = pageSchema(journalEntrySchema);

export const ledgerQuerySchema = paginationQuerySchema.extend({
  from: date.optional(),
  to: date.optional(),
});
export type LedgerQuery = z.output<typeof ledgerQuerySchema>;
export const ledgerLineSchema = z.object({
  entryNumber: z.string(),
  entryDate: z.iso.date(),
  description: z.string(),
  debitMinor: z.number().int().min(0),
  creditMinor: z.number().int().min(0),
  runningBalanceMinor: z.number().int(),
});
export const ledgerSchema = z.object({
  account: accountSchema,
  openingBalanceMinor: z.number().int(),
  items: z.array(ledgerLineSchema),
  page: z.object({ limit: z.number().int(), offset: z.number().int(), total: z.number().int() }),
});

// ---- statements ----

export const rangeQuerySchema = z
  .object({ from: date, to: date })
  .refine((v) => v.from <= v.to, { message: 'from must not be after to' });
export type RangeQuery = z.output<typeof rangeQuerySchema>;

export const asOfQuerySchema = z.object({ asOf: date.optional() });
export type AsOfQuery = z.output<typeof asOfQuerySchema>;

export const trialBalanceSchema = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  accounts: z.array(
    z.object({
      code: z.string(),
      name: z.string(),
      openingMinor: z.number().int().describe('Net debit (+) or credit (-) before the period'),
      debitMinor: z.number().int().min(0),
      creditMinor: z.number().int().min(0),
      closingMinor: z
        .number()
        .int()
        .describe('Net debit (+) or credit (-) at the end of the period'),
    }),
  ),
  totalDebitMinor: z.number().int(),
  totalCreditMinor: z.number().int(),
  balanced: z.boolean(),
});

const stmtLine = z.object({ code: z.string(), name: z.string(), amountMinor: z.number().int() });
export const profitLossSchema = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  revenue: z.array(stmtLine),
  netRevenueMinor: z.number().int(),
  cogs: z.array(stmtLine),
  totalCogsMinor: z.number().int(),
  grossProfitMinor: z.number().int(),
  grossMarginPct: z.number().nullable(),
  expenses: z.array(stmtLine),
  totalExpensesMinor: z.number().int(),
  netProfitMinor: z.number().int(),
  netMarginPct: z.number().nullable(),
});

export const balanceSheetSchema = z.object({
  asOf: z.iso.date(),
  assets: z.array(stmtLine),
  totalAssetsMinor: z.number().int(),
  liabilities: z.array(stmtLine),
  totalLiabilitiesMinor: z.number().int(),
  equity: z.array(stmtLine),
  totalEquityMinor: z.number().int(),
  balanced: z.boolean().describe('Assets equal liabilities plus equity'),
});

export const inventoryValuationSchema = z.object({
  products: z.array(
    z.object({
      productId: z.uuid(),
      sku: z.string(),
      name: z.string(),
      stock: z.number().int(),
      valueMinor: z.number().int(),
      wacMinor: z.number().int().nullable(),
    }),
  ),
  totalValueMinor: z.number().int(),
  inventoryAccountMinor: z.number().int(),
  reconciled: z.boolean().describe('The stock records and the inventory account agree exactly'),
});

// ---- expenses ----

export const expenseSchema = z.object({
  id: z.uuid(),
  number: z.string(),
  accountCode: z.string(),
  description: z.string(),
  amountMinor: z.number().int().min(1),
  paymentMethod: z.enum(SETTLEMENT_METHODS),
  expenseDate: z.iso.date(),
  vendor: z.string().nullable(),
  receiptNumber: z.string().nullable(),
  voided: z.boolean(),
  voidReason: z.string().nullable(),
  createdBy: z.uuid(),
  createdAt: z.iso.datetime(),
});
export type ExpenseDto = z.output<typeof expenseSchema>;

export const createExpenseSchema = z
  .object({
    accountCode: z.enum(EXPENSE_ACCOUNTS),
    description: z.string().trim().min(1).max(300),
    amountMinor: minor.refine((n) => n > 0, 'Must be above zero'),
    paymentMethod: z.enum(SETTLEMENT_METHODS),
    expenseDate: date.optional().describe('Defaults to today in the shop time zone'),
    vendor: z.string().trim().min(1).max(200).optional(),
    receiptNumber: z.string().trim().min(1).max(100).optional(),
  })
  .strict();
export type CreateExpense = z.output<typeof createExpenseSchema>;

export const voidExpenseSchema = z.object({ reason: z.string().trim().min(3).max(500) }).strict();
export type VoidExpense = z.output<typeof voidExpenseSchema>;

export const listExpensesQuerySchema = paginationQuerySchema.extend({
  accountCode: z.enum(EXPENSE_ACCOUNTS).optional(),
  from: date.optional(),
  to: date.optional(),
});
export type ListExpensesQuery = z.output<typeof listExpensesQuerySchema>;
export const expensePageSchema = pageSchema(expenseSchema);

// ---- opening balances ----

export const openingBalanceSchema = z
  .object({
    cashMinor: minor.default(0),
    bankMinor: minor.default(0),
    inventory: z
      .array(
        z
          .object({
            productId: z.uuid(),
            quantity: z.number().int().min(1).max(1_000_000),
            unitCostMinor: minor,
          })
          .strict(),
      )
      .max(2000)
      .default([]),
  })
  .strict()
  .refine((v) => v.cashMinor + v.bankMinor + v.inventory.length > 0, {
    message: 'Provide cash, bank or inventory to open with',
  });
export type OpeningBalance = z.output<typeof openingBalanceSchema>;

export const openingResultSchema = z.object({
  entryNumber: z.string(),
  totalMinor: z.number().int(),
  cashMinor: z.number().int(),
  bankMinor: z.number().int(),
  inventoryMinor: z.number().int(),
});
