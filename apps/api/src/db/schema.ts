import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgSequence,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** owner: everything. manager: operations. accountant: books and reports. cashier: the till. */
export const ROLES = ['owner', 'manager', 'accountant', 'cashier'] as const;
export type Role = (typeof ROLES)[number];

export const CATEGORY_TYPES = ['ELECTRONICS', 'STATIONERY'] as const;
export const PRODUCT_STATUSES = ['ACTIVE', 'DISCONTINUED'] as const;
export const CUSTOMER_TYPES = ['RETAIL', 'WHOLESALE', 'INSTITUTIONAL'] as const;
export const PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'MOBILE_MONEY', 'CREDIT'] as const;
export const SETTLEMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'MOBILE_MONEY'] as const;
export const SALE_STATUSES = ['COMPLETED', 'VOIDED'] as const;
export const PURCHASE_STATUSES = [
  'ORDERED',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CANCELLED',
] as const;
export const PAYMENT_STATUSES = ['UNPAID', 'PARTIAL', 'PAID'] as const;
export const ACCOUNT_TYPES = [
  'ASSET',
  'LIABILITY',
  'EQUITY',
  'REVENUE',
  'COGS',
  'EXPENSE',
] as const;
export const MOVEMENT_TYPES = ['OPENING_BALANCE', 'PURCHASE_RECEIPT', 'SALE', 'SALE_VOID'] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];
export const ENTRY_STATUSES = ['POSTED', 'VOIDED'] as const;

export const CURRENCY = 'ETB';

const id = () =>
  uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const deletedAt = () => timestamp('deleted_at', { withTimezone: true });
/** Optimistic concurrency token: bumped by every update. */
const version = () => integer('version').notNull().default(1);
/** Money is integer minor units (santim); 12050 means 120.50 ETB. Never a float. */
const money = (name: string) => bigint(name, { mode: 'number' });

// ---------------------------------------------------------------- identity

export const users = pgTable(
  'users',
  {
    id: id(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    role: text('role', { enum: ROLES }).notNull().default('cashier'),
    active: boolean('active').notNull().default(true),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    check('users_role_valid', sql`${t.role} in ('owner', 'manager', 'accountant', 'cashier')`),
    check('users_email_lowercase', sql`${t.email} = lower(${t.email})`),
    uniqueIndex('users_email_live_uq')
      .on(t.email)
      .where(sql`${t.deletedAt} is null`),
  ],
);

/** One row per issued refresh token; only the SHA-256 of the token is stored. */
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    familyId: uuid('family_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('refresh_tokens_hash_uq').on(t.tokenHash),
    index('refresh_tokens_family_idx').on(t.familyId),
    index('refresh_tokens_user_idx').on(t.userId),
  ],
);

// ---------------------------------------------------------------- catalog

export const categories = pgTable(
  'categories',
  {
    id: id(),
    name: text('name').notNull(),
    /** Decides which revenue and COGS accounts a sale of its products posts to. */
    type: text('type', { enum: CATEGORY_TYPES }).notNull(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    check('categories_type_valid', sql`${t.type} in ('ELECTRONICS', 'STATIONERY')`),
    check('categories_name_not_blank', sql`length(btrim(${t.name})) > 0`),
    uniqueIndex('categories_name_live_uq')
      .on(sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} is null`),
  ],
);

export const subCategories = pgTable(
  'sub_categories',
  {
    id: id(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id),
    name: text('name').notNull(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    check('sub_categories_name_not_blank', sql`length(btrim(${t.name})) > 0`),
    uniqueIndex('sub_categories_name_live_uq')
      .on(t.categoryId, sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} is null`),
  ],
);

export const brands = pgTable(
  'brands',
  {
    id: id(),
    name: text('name').notNull(),
    country: text('country'),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    check('brands_name_not_blank', sql`length(btrim(${t.name})) > 0`),
    uniqueIndex('brands_name_live_uq')
      .on(sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} is null`),
  ],
);

/**
 * Stock and its value are derived state: only `inventory.service` changes `current_stock` and
 * `stock_value_minor`, always together with an `inventory_movements` row, and a trigger
 * (migration 0002) rejects any other writer. WAC is `stock_value_minor / current_stock`.
 */
export const products = pgTable(
  'products',
  {
    id: id(),
    sku: text('sku').notNull(),
    barcode: text('barcode'),
    name: text('name').notNull(),
    description: text('description'),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id),
    subCategoryId: uuid('sub_category_id').references(() => subCategories.id),
    brandId: uuid('brand_id').references(() => brands.id),
    unitOfMeasure: text('unit_of_measure').notNull().default('piece'),
    sellingPriceMinor: money('selling_price_minor').notNull(),
    /** A cashier may never sell below this; managers may override it. */
    minSellingPriceMinor: money('min_selling_price_minor'),
    currentStock: integer('current_stock').notNull().default(0),
    /** What the units on hand cost in total (an exact integer, so the books and the shelf agree). */
    stockValueMinor: money('stock_value_minor').notNull().default(0),
    reorderPoint: integer('reorder_point').notNull().default(5),
    reorderQty: integer('reorder_qty').notNull().default(10),
    status: text('status', { enum: PRODUCT_STATUSES }).notNull().default('ACTIVE'),
    lastSoldAt: timestamp('last_sold_at', { withTimezone: true }),
    lastRestockedAt: timestamp('last_restocked_at', { withTimezone: true }),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    check('products_stock_non_negative', sql`${t.currentStock} >= 0`),
    check('products_value_non_negative', sql`${t.stockValueMinor} >= 0`),
    check(
      'products_value_matches_stock',
      sql`(${t.currentStock} = 0 and ${t.stockValueMinor} = 0) or ${t.currentStock} > 0`,
    ),
    check('products_price_non_negative', sql`${t.sellingPriceMinor} >= 0`),
    check(
      'products_min_price_valid',
      sql`${t.minSellingPriceMinor} is null or ${t.minSellingPriceMinor} >= 0`,
    ),
    check('products_status_valid', sql`${t.status} in ('ACTIVE', 'DISCONTINUED')`),
    check('products_name_not_blank', sql`length(btrim(${t.name})) > 0`),
    uniqueIndex('products_sku_live_uq')
      .on(sql`lower(${t.sku})`)
      .where(sql`${t.deletedAt} is null`),
    uniqueIndex('products_barcode_live_uq')
      .on(t.barcode)
      .where(sql`${t.deletedAt} is null and ${t.barcode} is not null`),
    index('products_category_idx').on(t.categoryId),
  ],
);

// ---------------------------------------------------------------- parties

export const customers = pgTable(
  'customers',
  {
    id: id(),
    name: text('name').notNull(),
    email: text('email'),
    phone: text('phone'),
    address: text('address'),
    city: text('city'),
    type: text('type', { enum: CUSTOMER_TYPES }).notNull().default('RETAIL'),
    /** Most this customer may owe on credit sales at any time. 0 means no credit. */
    creditLimitMinor: money('credit_limit_minor').notNull().default(0),
    notes: text('notes'),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    check('customers_type_valid', sql`${t.type} in ('RETAIL', 'WHOLESALE', 'INSTITUTIONAL')`),
    check('customers_credit_non_negative', sql`${t.creditLimitMinor} >= 0`),
    check('customers_name_not_blank', sql`length(btrim(${t.name})) > 0`),
    index('customers_name_idx').on(sql`lower(${t.name})`),
  ],
);

export const suppliers = pgTable(
  'suppliers',
  {
    id: id(),
    name: text('name').notNull(),
    contactPerson: text('contact_person'),
    email: text('email'),
    phone: text('phone'),
    address: text('address'),
    city: text('city'),
    country: text('country'),
    paymentTermsDays: integer('payment_terms_days').notNull().default(0),
    notes: text('notes'),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    check('suppliers_terms_non_negative', sql`${t.paymentTermsDays} >= 0`),
    check('suppliers_name_not_blank', sql`length(btrim(${t.name})) > 0`),
    uniqueIndex('suppliers_name_live_uq')
      .on(sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} is null`),
  ],
);

// ---------------------------------------------------------------- accounting

export const accounts = pgTable(
  'accounts',
  {
    id: id(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    type: text('type', { enum: ACCOUNT_TYPES }).notNull(),
    normalBalance: text('normal_balance', { enum: ['DEBIT', 'CREDIT'] }).notNull(),
    parentCode: text('parent_code'),
    isSystem: boolean('is_system').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    description: text('description'),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      'accounts_type_valid',
      sql`${t.type} in ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'COGS', 'EXPENSE')`,
    ),
    check('accounts_normal_balance_valid', sql`${t.normalBalance} in ('DEBIT', 'CREDIT')`),
    uniqueIndex('accounts_code_uq').on(t.code),
  ],
);

export const journalNumberSeq = pgSequence('journal_number_seq', { startWith: 1 });

/**
 * Posted entries are immutable. The only change ever allowed is POSTED to VOIDED, and a void
 * always creates a reversing entry (`reverses_entry_id`), so history is never rewritten.
 * Triggers (migration 0002) enforce balance at commit and this immutability.
 */
export const journalEntries = pgTable(
  'journal_entries',
  {
    id: id(),
    entryNumber: text('entry_number').notNull(),
    entryDate: date('entry_date', { mode: 'string' }).notNull(),
    description: text('description').notNull(),
    referenceType: text('reference_type'),
    referenceId: uuid('reference_id'),
    status: text('status', { enum: ENTRY_STATUSES }).notNull().default('POSTED'),
    totalMinor: money('total_minor').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    reversesEntryId: uuid('reverses_entry_id'),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedBy: uuid('voided_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    check('journal_entries_status_valid', sql`${t.status} in ('POSTED', 'VOIDED')`),
    check('journal_entries_total_positive', sql`${t.totalMinor} > 0`),
    uniqueIndex('journal_entries_number_uq').on(t.entryNumber),
    uniqueIndex('journal_entries_reverses_uq')
      .on(t.reversesEntryId)
      .where(sql`${t.reversesEntryId} is not null`),
    index('journal_entries_reference_idx').on(t.referenceType, t.referenceId),
    index('journal_entries_date_idx').on(t.entryDate),
  ],
);

export const journalLines = pgTable(
  'journal_lines',
  {
    id: id(),
    entryId: uuid('entry_id')
      .notNull()
      .references(() => journalEntries.id),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    debitMinor: money('debit_minor').notNull().default(0),
    creditMinor: money('credit_minor').notNull().default(0),
    description: text('description'),
  },
  (t) => [
    check(
      'journal_lines_one_side',
      sql`${t.debitMinor} >= 0 and ${t.creditMinor} >= 0 and (${t.debitMinor} = 0 or ${t.creditMinor} = 0) and (${t.debitMinor} + ${t.creditMinor}) > 0`,
    ),
    index('journal_lines_entry_idx').on(t.entryId),
    index('journal_lines_account_idx').on(t.accountId),
  ],
);

// ---------------------------------------------------------------- inventory

export const inventoryMovements = pgTable(
  'inventory_movements',
  {
    id: id(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    movementType: text('movement_type', { enum: MOVEMENT_TYPES }).notNull(),
    /** Always positive; the movement type says whether it is stock in or stock out. */
    quantity: integer('quantity').notNull(),
    /** Signed: positive when stock comes in, negative when it goes out. */
    valueDeltaMinor: money('value_delta_minor').notNull(),
    stockBefore: integer('stock_before').notNull(),
    stockAfter: integer('stock_after').notNull(),
    valueBeforeMinor: money('value_before_minor').notNull(),
    valueAfterMinor: money('value_after_minor').notNull(),
    referenceType: text('reference_type'),
    referenceId: uuid('reference_id'),
    notes: text('notes'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    check('inventory_movements_qty_positive', sql`${t.quantity} > 0`),
    check('inventory_movements_stock_non_negative', sql`${t.stockAfter} >= 0`),
    check(
      'inventory_movements_type_valid',
      sql`${t.movementType} in ('OPENING_BALANCE', 'PURCHASE_RECEIPT', 'SALE', 'SALE_VOID')`,
    ),
    index('inventory_movements_product_idx').on(t.productId, t.createdAt),
    index('inventory_movements_reference_idx').on(t.referenceType, t.referenceId),
  ],
);

// ---------------------------------------------------------------- sales

export const saleNumberSeq = pgSequence('sale_number_seq', { startWith: 1 });

export const sales = pgTable(
  'sales',
  {
    id: id(),
    number: text('number').notNull(),
    customerId: uuid('customer_id').references(() => customers.id),
    saleDate: timestamp('sale_date', { withTimezone: true }).notNull().defaultNow(),
    status: text('status', { enum: SALE_STATUSES }).notNull().default('COMPLETED'),
    subtotalMinor: money('subtotal_minor').notNull(),
    discountMinor: money('discount_minor').notNull().default(0),
    totalMinor: money('total_minor').notNull(),
    cogsMinor: money('cogs_minor').notNull(),
    paymentMethod: text('payment_method', { enum: PAYMENT_METHODS }).notNull(),
    /** What the customer handed over (cash may exceed the total; credit sales may be partly paid). */
    amountPaidMinor: money('amount_paid_minor').notNull().default(0),
    changeGivenMinor: money('change_given_minor').notNull().default(0),
    notes: text('notes'),
    journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedBy: uuid('voided_by').references(() => users.id),
    voidReason: text('void_reason'),
    version: version(),
    createdAt: createdAt(),
  },
  (t) => [
    check('sales_status_valid', sql`${t.status} in ('COMPLETED', 'VOIDED')`),
    check(
      'sales_payment_method_valid',
      sql`${t.paymentMethod} in ('CASH', 'BANK_TRANSFER', 'MOBILE_MONEY', 'CREDIT')`,
    ),
    check('sales_amounts_non_negative', sql`${t.subtotalMinor} >= 0 and ${t.totalMinor} >= 0`),
    check('sales_total_matches', sql`${t.totalMinor} = ${t.subtotalMinor} - ${t.discountMinor}`),
    check(
      'sales_credit_has_customer',
      sql`${t.paymentMethod} <> 'CREDIT' or ${t.customerId} is not null`,
    ),
    uniqueIndex('sales_number_uq').on(t.number),
    index('sales_customer_idx').on(t.customerId, t.saleDate),
    index('sales_date_idx').on(t.saleDate),
  ],
);

export const saleItems = pgTable(
  'sale_items',
  {
    id: id(),
    saleId: uuid('sale_id')
      .notNull()
      .references(() => sales.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    productName: text('product_name').notNull(),
    categoryType: text('category_type', { enum: CATEGORY_TYPES }).notNull(),
    quantity: integer('quantity').notNull(),
    unitPriceMinor: money('unit_price_minor').notNull(),
    discountMinor: money('discount_minor').notNull().default(0),
    lineTotalMinor: money('line_total_minor').notNull(),
    /** Cost of the units sold, taken from the inventory value at that moment and never recomputed. */
    lineCogsMinor: money('line_cogs_minor').notNull(),
  },
  (t) => [
    check('sale_items_qty_positive', sql`${t.quantity} > 0`),
    check(
      'sale_items_total_matches',
      sql`${t.lineTotalMinor} = ${t.unitPriceMinor} * ${t.quantity} - ${t.discountMinor}`,
    ),
    check(
      'sale_items_amounts_non_negative',
      sql`${t.lineTotalMinor} >= 0 and ${t.lineCogsMinor} >= 0`,
    ),
    index('sale_items_sale_idx').on(t.saleId),
    index('sale_items_product_idx').on(t.productId),
  ],
);

/** Money settled after the fact: a customer paying a credit sale, or us paying a supplier. */
export const settlements = pgTable(
  'settlements',
  {
    id: id(),
    kind: text('kind', { enum: ['CUSTOMER_RECEIPT', 'SUPPLIER_PAYMENT'] }).notNull(),
    saleId: uuid('sale_id').references(() => sales.id),
    purchaseId: uuid('purchase_id'),
    amountMinor: money('amount_minor').notNull(),
    method: text('method', { enum: SETTLEMENT_METHODS }).notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }).notNull().defaultNow(),
    journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id),
    recordedBy: uuid('recorded_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    check('settlements_amount_positive', sql`${t.amountMinor} > 0`),
    check(
      'settlements_target',
      sql`(${t.kind} = 'CUSTOMER_RECEIPT' and ${t.saleId} is not null and ${t.purchaseId} is null) or (${t.kind} = 'SUPPLIER_PAYMENT' and ${t.purchaseId} is not null and ${t.saleId} is null)`,
    ),
    index('settlements_sale_idx').on(t.saleId),
    index('settlements_purchase_idx').on(t.purchaseId),
  ],
);

// ---------------------------------------------------------------- purchases

export const purchaseNumberSeq = pgSequence('purchase_number_seq', { startWith: 1 });

export const purchases = pgTable(
  'purchases',
  {
    id: id(),
    number: text('number').notNull(),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    status: text('status', { enum: PURCHASE_STATUSES }).notNull().default('ORDERED'),
    orderDate: date('order_date', { mode: 'string' }).notNull(),
    expectedDate: date('expected_date', { mode: 'string' }),
    receivedDate: date('received_date', { mode: 'string' }),
    totalMinor: money('total_minor').notNull(),
    /** Value of goods received so far: what we owe the supplier for. */
    receivedValueMinor: money('received_value_minor').notNull().default(0),
    paidMinor: money('paid_minor').notNull().default(0),
    paymentStatus: text('payment_status', { enum: PAYMENT_STATUSES }).notNull().default('UNPAID'),
    notes: text('notes'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      'purchases_status_valid',
      sql`${t.status} in ('ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED')`,
    ),
    check(
      'purchases_payment_status_valid',
      sql`${t.paymentStatus} in ('UNPAID', 'PARTIAL', 'PAID')`,
    ),
    check(
      'purchases_amounts_valid',
      sql`${t.totalMinor} >= 0 and ${t.receivedValueMinor} >= 0 and ${t.paidMinor} >= 0`,
    ),
    // Never pay a supplier more than the value of what has been received.
    check('purchases_paid_within_received', sql`${t.paidMinor} <= ${t.receivedValueMinor}`),
    uniqueIndex('purchases_number_uq').on(t.number),
    index('purchases_supplier_idx').on(t.supplierId, t.orderDate),
  ],
);

export const purchaseItems = pgTable(
  'purchase_items',
  {
    id: id(),
    purchaseId: uuid('purchase_id')
      .notNull()
      .references(() => purchases.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    orderedQty: integer('ordered_qty').notNull(),
    receivedQty: integer('received_qty').notNull().default(0),
    unitCostMinor: money('unit_cost_minor').notNull(),
  },
  (t) => [
    check('purchase_items_ordered_positive', sql`${t.orderedQty} > 0`),
    check(
      'purchase_items_received_valid',
      sql`${t.receivedQty} >= 0 and ${t.receivedQty} <= ${t.orderedQty}`,
    ),
    check('purchase_items_cost_non_negative', sql`${t.unitCostMinor} >= 0`),
    index('purchase_items_purchase_idx').on(t.purchaseId),
  ],
);

// ---------------------------------------------------------------- expenses

export const expenseNumberSeq = pgSequence('expense_number_seq', { startWith: 1 });

export const expenses = pgTable(
  'expenses',
  {
    id: id(),
    number: text('number').notNull(),
    accountCode: text('account_code').notNull(),
    description: text('description').notNull(),
    amountMinor: money('amount_minor').notNull(),
    paymentMethod: text('payment_method', { enum: SETTLEMENT_METHODS }).notNull(),
    expenseDate: date('expense_date', { mode: 'string' }).notNull(),
    vendor: text('vendor'),
    receiptNumber: text('receipt_number'),
    journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedBy: uuid('voided_by').references(() => users.id),
    voidReason: text('void_reason'),
    createdAt: createdAt(),
  },
  (t) => [
    check('expenses_amount_positive', sql`${t.amountMinor} > 0`),
    uniqueIndex('expenses_number_uq').on(t.number),
    index('expenses_date_idx').on(t.expenseDate),
  ],
);

// ---------------------------------------------------------------- platform

/** Append-only: a trigger (migration 0001) rejects UPDATE and DELETE. */
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    actor: text('actor').notNull(),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    requestId: text('request_id'),
    createdAt: createdAt(),
  },
  (t) => [index('audit_log_entity_idx').on(t.entityType, t.entityId)],
);

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    userId: uuid('user_id').notNull(),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
);

export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    topic: text('topic').notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: createdAt(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => [
    index('outbox_unprocessed_idx')
      .on(t.createdAt)
      .where(sql`${t.processedAt} is null`),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type CategoryRow = typeof categories.$inferSelect;
export type SubCategoryRow = typeof subCategories.$inferSelect;
export type BrandRow = typeof brands.$inferSelect;
export type ProductRow = typeof products.$inferSelect;
export type CustomerRow = typeof customers.$inferSelect;
export type SupplierRow = typeof suppliers.$inferSelect;
export type AccountRow = typeof accounts.$inferSelect;
export type SaleRow = typeof sales.$inferSelect;
export type SaleItemRow = typeof saleItems.$inferSelect;
export type PurchaseRow = typeof purchases.$inferSelect;
export type PurchaseItemRow = typeof purchaseItems.$inferSelect;
export type ExpenseRow = typeof expenses.$inferSelect;
