import { describe, expect, it } from 'vitest';
import {
  IMPORT_COLUMNS,
  IMPORT_MAX_CHARS,
  importTemplateCsv,
  importTextProblem,
} from './import-template';
import { BOM } from './csv';

/** Counts comma-separated cells in one row, ignoring commas inside double quotes. */
function cellCount(row: string): number {
  let quoted = false;
  let cells = 1;
  for (const ch of row) {
    if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) cells += 1;
  }
  return cells;
}

describe('import template', () => {
  const lines = importTemplateCsv().slice(BOM.length).trim().split('\r\n');

  it('has the 14 columns the API reads, in order', () => {
    expect(IMPORT_COLUMNS).toHaveLength(14);
    expect(lines[0]).toBe(
      'sku,name,type,category,sub_category,brand,barcode,unit,price,min_price,reorder_point,reorder_qty,quantity,unit_cost',
    );
  });

  it('has three example rows, each with one cell per column', () => {
    expect(lines).toHaveLength(4);
    for (const row of lines.slice(1)) expect(cellCount(row)).toBe(IMPORT_COLUMNS.length);
  });

  it('refuses empty and oversized text before it is sent', () => {
    expect(importTextProblem('   ')).not.toBeNull();
    expect(importTextProblem('x'.repeat(IMPORT_MAX_CHARS + 1))).toContain('too large');
    expect(importTextProblem('sku,name,price,category\nA,B,1,C')).toBeNull();
  });
});
