import { money, toCsv, type Cell } from './csv';
import type {
  BalanceSheet,
  CashFlowStatement,
  ProfitLoss,
  StatementLine,
  TrialBalance,
} from './types';

export const EXPORT_VIEWS = ['profit-loss', 'balance-sheet', 'trial-balance', 'cash-flow'] as const;
export type ExportView = (typeof EXPORT_VIEWS)[number];

export function isExportView(value: string | null | undefined): value is ExportView {
  return (EXPORT_VIEWS as readonly string[]).includes(value ?? '');
}

const section = (
  title: string,
  lines: StatementLine[],
  totalLabel: string,
  total: number,
): Cell[][] => [
  [title],
  ...lines.map((l): Cell[] => [l.code, l.name, money(l.amountMinor)]),
  ['', totalLabel, money(total)],
  [],
];

export function profitLossCsv(p: ProfitLoss): string {
  return toCsv([
    ['Profit and loss', `${p.from} to ${p.to}`],
    [],
    ['Code', 'Account', 'Amount (ETB)'],
    ...section('Revenue', p.revenue, 'Net revenue', p.netRevenueMinor),
    ...section('Cost of goods sold', p.cogs, 'Total cost of goods sold', p.totalCogsMinor),
    ['', 'Gross profit', money(p.grossProfitMinor)],
    [],
    ...section('Expenses', p.expenses, 'Total expenses', p.totalExpensesMinor),
    ['', 'Net profit', money(p.netProfitMinor)],
  ]);
}

export function balanceSheetCsv(b: BalanceSheet): string {
  return toCsv([
    ['Balance sheet', `as of ${b.asOf}`],
    [],
    ['Code', 'Account', 'Amount (ETB)'],
    ...section('Assets', b.assets, 'Total assets', b.totalAssetsMinor),
    ...section('Liabilities', b.liabilities, 'Total liabilities', b.totalLiabilitiesMinor),
    ...section('Equity', b.equity, 'Total equity', b.totalEquityMinor),
    ['', 'Balanced', b.balanced ? 'yes' : 'no'],
  ]);
}

export function trialBalanceCsv(t: TrialBalance): string {
  return toCsv([
    ['Trial balance', `${t.from} to ${t.to}`],
    [],
    ['Code', 'Account', 'Opening', 'Debit', 'Credit', 'Closing'],
    ...t.accounts.map((a): Cell[] => [
      a.code,
      a.name,
      money(a.openingMinor),
      money(a.debitMinor),
      money(a.creditMinor),
      money(a.closingMinor),
    ]),
    ['', 'Totals', '', money(t.totalDebitMinor), money(t.totalCreditMinor), ''],
    ['', 'Balanced', t.balanced ? 'yes' : 'no'],
  ]);
}

export function cashFlowCsv(c: CashFlowStatement): string {
  return toCsv([
    ['Cash flow', `${c.from} to ${c.to}`],
    [],
    ['Line', 'Amount (ETB)'],
    ['Opening cash', money(c.openingCashMinor)],
    ['Receipts'],
    ...c.receipts.map((r): Cell[] => [r.label, money(r.amountMinor)]),
    ['Total receipts', money(c.totalReceiptsMinor)],
    ['Payments'],
    ...c.payments.map((r): Cell[] => [r.label, money(r.amountMinor)]),
    ['Total payments', money(c.totalPaymentsMinor)],
    ['Net change', money(c.netChangeMinor)],
    ['Closing cash', money(c.closingCashMinor)],
    ['Reconciled to the ledger', c.reconciled ? 'yes' : 'no'],
  ]);
}
