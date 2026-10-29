/** Building CSV text for downloads: quoting, spreadsheet-formula safety and exact money. */

/** A value written exactly as given (used for money, so "12.50" keeps its trailing zero). */
export interface RawCell {
  raw: string;
}
export type Cell = string | number | null | undefined | RawCell;

/** Integer minor units as a plain decimal string, with no float arithmetic: 1250 -> "12.50". */
export function minorToDecimal(minor: number): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(minor));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export function money(minor: number | null | undefined): RawCell {
  return { raw: minor === null || minor === undefined ? '' : minorToDecimal(minor) };
}

/** Free text that a spreadsheet would read as a formula gets a leading apostrophe. */
function guard(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

export function csvCell(cell: Cell): string {
  if (cell === null || cell === undefined) return '';
  const text =
    typeof cell === 'object' ? cell.raw : typeof cell === 'number' ? String(cell) : guard(cell);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The byte-order mark that makes Excel read the file as UTF-8. */
export const BOM = String.fromCharCode(0xfeff);

/** CRLF rows, as RFC 4180 says; a leading byte-order mark makes Excel read UTF-8 correctly. */
export function toCsv(rows: Cell[][]): string {
  return `${BOM}${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
