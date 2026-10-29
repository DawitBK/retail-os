import { describe, expect, it } from 'vitest';
import { BOM, csvCell, minorToDecimal, money, toCsv } from './csv';
import { cashFlowCsv, isExportView, profitLossCsv } from './statements-csv';
import type { CashFlowStatement, ProfitLoss } from './types';

describe('csv building', () => {
  it('writes minor units as exact decimals', () => {
    expect(minorToDecimal(0)).toBe('0.00');
    expect(minorToDecimal(5)).toBe('0.05');
    expect(minorToDecimal(1250)).toBe('12.50');
    expect(minorToDecimal(-1250)).toBe('-12.50');
    expect(minorToDecimal(-5)).toBe('-0.05');
    expect(minorToDecimal(123456789)).toBe('1234567.89');
  });

  it('quotes cells that need it and doubles inner quotes', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(7)).toBe('7');
  });

  it('defuses text that a spreadsheet would run as a formula, but not money', () => {
    expect(csvCell('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)");
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell(money(-100))).toBe('-1.00');
  });

  it('ends rows with CRLF and starts with a byte-order mark', () => {
    expect(toCsv([['a', 'b'], ['c']])).toBe(`${BOM}a,b\r\nc\r\n`);
  });
});

describe('statement exports', () => {
  const pl: ProfitLoss = {
    from: '2026-10-01',
    to: '2026-10-31',
    revenue: [{ code: '4000', name: 'Sales, retail', amountMinor: 100000 }],
    netRevenueMinor: 100000,
    cogs: [{ code: '5000', name: 'Cost of goods sold', amountMinor: 60000 }],
    totalCogsMinor: 60000,
    grossProfitMinor: 40000,
    grossMarginPct: 40,
    expenses: [],
    totalExpensesMinor: 0,
    netProfitMinor: 40000,
    netMarginPct: 40,
  };

  it('puts every figure of the profit and loss in the file', () => {
    const csv = profitLossCsv(pl);
    expect(csv).toContain('4000,"Sales, retail",1000.00');
    expect(csv).toContain(',Gross profit,400.00');
    expect(csv).toContain(',Net profit,400.00');
  });

  it('writes the cash flow statement with its reconciled flag', () => {
    const cf: CashFlowStatement = {
      from: '2026-10-01',
      to: '2026-10-31',
      openingCashMinor: 1000,
      receipts: [{ label: 'Cash sales', amountMinor: 5000 }],
      payments: [{ label: 'Suppliers', amountMinor: 2000 }],
      totalReceiptsMinor: 5000,
      totalPaymentsMinor: 2000,
      netChangeMinor: 3000,
      closingCashMinor: 4000,
      reconciled: true,
    };
    const csv = cashFlowCsv(cf);
    expect(csv).toContain('Closing cash,40.00');
    expect(csv).toContain('Reconciled to the ledger,yes');
  });

  it('knows which views can be exported', () => {
    expect(isExportView('cash-flow')).toBe(true);
    expect(isExportView('valuation')).toBe(false);
    expect(isExportView(null)).toBe(false);
  });
});
