/** Response shapes the web app reads. The API's OpenAPI document is the source of truth. */
export type Role = 'owner' | 'manager' | 'accountant' | 'cashier';
export type PaymentMethod = 'CASH' | 'BANK_TRANSFER' | 'MOBILE_MONEY' | 'CREDIT';
export type SettlementMethod = 'CASH' | 'BANK_TRANSFER' | 'MOBILE_MONEY';

export interface Page<T> {
  items: T[];
  page: { limit: number; offset: number; total: number };
}

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  active: boolean;
  version: number;
  createdAt: string;
}

export interface Category {
  id: string;
  name: string;
  type: 'ELECTRONICS' | 'STATIONERY';
  version: number;
}
export interface SubCategory {
  id: string;
  categoryId: string;
  name: string;
  version: number;
}
export interface Brand {
  id: string;
  name: string;
  country: string | null;
  version: number;
}

export interface Product {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  description: string | null;
  categoryId: string;
  subCategoryId: string | null;
  brandId: string | null;
  unitOfMeasure: string;
  sellingPriceMinor: number;
  minSellingPriceMinor: number | null;
  currentStock: number;
  stockValueMinor: number;
  wacMinor: number | null;
  negativeMargin: boolean;
  reorderPoint: number;
  reorderQty: number;
  status: 'ACTIVE' | 'DISCONTINUED';
  lastSoldAt: string | null;
  lastRestockedAt: string | null;
  version: number;
}

export interface StockMovement {
  id: string;
  movementType: string;
  quantity: number;
  valueDeltaMinor: number;
  stockBefore: number;
  stockAfter: number;
  referenceType: string | null;
  createdAt: string;
}

export interface Customer {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  type: 'RETAIL' | 'WHOLESALE' | 'INSTITUTIONAL';
  creditLimitMinor: number;
  outstandingMinor: number;
  notes: string | null;
  version: number;
}

export interface Supplier {
  id: string;
  name: string;
  contactPerson: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  paymentTermsDays: number;
  payableMinor: number;
  notes: string | null;
  version: number;
}

export interface SaleItem {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPriceMinor: number;
  discountMinor: number;
  lineTotalMinor: number;
}

export interface Sale {
  id: string;
  number: string;
  customerId: string | null;
  saleDate: string;
  status: 'COMPLETED' | 'VOIDED';
  subtotalMinor: number;
  discountMinor: number;
  totalMinor: number;
  cogsMinor: number;
  grossProfitMinor: number;
  paymentMethod: PaymentMethod;
  amountPaidMinor: number;
  changeGivenMinor: number;
  outstandingMinor: number;
  items: SaleItem[];
  notes: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  version: number;
}

export interface PurchaseItem {
  id: string;
  productId: string;
  productName: string;
  orderedQty: number;
  receivedQty: number;
  unitCostMinor: number;
}
export interface Purchase {
  id: string;
  number: string;
  supplierId: string;
  status: string;
  orderDate: string;
  expectedDate: string | null;
  receivedDate: string | null;
  totalMinor: number;
  receivedValueMinor: number;
  paidMinor: number;
  payableMinor: number;
  paymentStatus: string;
  items: PurchaseItem[];
  notes: string | null;
  version: number;
}

export interface Alert {
  type: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  productId: string | null;
  title: string;
  message: string;
  valueMinor: number | null;
}

export interface Damage {
  id: string;
  number: string;
  productId: string;
  kind: 'DAMAGE' | 'WRITE_OFF';
  quantity: number;
  cause: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  lossMinor: number | null;
  decisionNote: string | null;
  createdAt: string;
}

export interface AuditItem {
  productId: string;
  productName: string;
  systemQty: number | null;
  physicalQty: number | null;
  variance: number | null;
  adjustmentValueMinor: number | null;
}
export interface StockAudit {
  id: string;
  number: string;
  status: 'IN_PROGRESS' | 'PENDING_APPROVAL' | 'APPROVED' | 'CANCELLED';
  notes: string | null;
  items?: AuditItem[];
  shortageUnits: number;
  overageUnits: number;
  createdAt: string;
}

export interface Kpis {
  revenueMinor: number;
  cogsMinor: number;
  grossProfitMinor: number;
  grossMarginPct: number | null;
  expensesMinor: number;
  netProfitMinor: number;
}
export interface Dashboard {
  asOf: string;
  today: Kpis & { transactions: number; averageTransactionMinor: number };
  monthToDate: Kpis;
  inventory: {
    totalValueMinor: number;
    skus: number;
    outOfStock: number;
    lowStock: number;
    negativeMargin: number;
    deadStock: number;
    deadStockValueMinor: number;
  };
  cash: {
    cashInHandMinor: number;
    cashInBankMinor: number;
    receivablesMinor: number;
    payablesMinor: number;
    workingCapitalMinor: number;
  };
  revenue30Days: {
    date: string;
    revenueMinor: number;
    cogsMinor: number;
    grossProfitMinor: number;
  }[];
  topProducts: {
    productId: string;
    name: string;
    unitsSold: number;
    revenueMinor: number;
    grossProfitMinor: number;
  }[];
}

export interface Account {
  code: string;
  name: string;
  type: string;
  normalBalance: 'DEBIT' | 'CREDIT';
  parentCode: string | null;
  balanceMinor: number;
}
export interface JournalEntry {
  id: string;
  entryNumber: string;
  entryDate: string;
  description: string;
  referenceType: string | null;
  status: 'POSTED' | 'VOIDED';
  totalMinor: number;
  lines: { accountCode: string; accountName: string; debitMinor: number; creditMinor: number }[];
}
export interface Expense {
  id: string;
  number: string;
  accountCode: string;
  description: string;
  amountMinor: number;
  paymentMethod: SettlementMethod;
  expenseDate: string;
  vendor: string | null;
  receiptNumber: string | null;
  voided: boolean;
  voidReason: string | null;
}
export interface StatementLine {
  code: string;
  name: string;
  amountMinor: number;
}
export interface TrialBalance {
  from: string;
  to: string;
  accounts: {
    code: string;
    name: string;
    openingMinor: number;
    debitMinor: number;
    creditMinor: number;
    closingMinor: number;
  }[];
  totalDebitMinor: number;
  totalCreditMinor: number;
  balanced: boolean;
}
export interface ProfitLoss {
  from: string;
  to: string;
  revenue: StatementLine[];
  netRevenueMinor: number;
  cogs: StatementLine[];
  totalCogsMinor: number;
  grossProfitMinor: number;
  grossMarginPct: number | null;
  expenses: StatementLine[];
  totalExpensesMinor: number;
  netProfitMinor: number;
  netMarginPct: number | null;
}
export interface BalanceSheet {
  asOf: string;
  assets: StatementLine[];
  totalAssetsMinor: number;
  liabilities: StatementLine[];
  totalLiabilitiesMinor: number;
  equity: StatementLine[];
  totalEquityMinor: number;
  balanced: boolean;
}
export interface InventoryValuation {
  products: {
    productId: string;
    sku: string;
    name: string;
    stock: number;
    valueMinor: number;
    wacMinor: number | null;
  }[];
  totalValueMinor: number;
  inventoryAccountMinor: number;
  reconciled: boolean;
}
