import { toCsv, type Cell } from './csv';

/** The columns the API reads; sku, name, category and price are required, the rest have defaults. */
export const IMPORT_COLUMNS = [
  'sku',
  'name',
  'type',
  'category',
  'sub_category',
  'brand',
  'barcode',
  'unit',
  'price',
  'min_price',
  'reorder_point',
  'reorder_qty',
  'quantity',
  'unit_cost',
] as const;

/** The API accepts at most this many characters of CSV text in one request. */
export const IMPORT_MAX_CHARS = 2_000_000;

const EXAMPLES: Cell[][] = [
  [
    'LAP-001',
    'Laptop 15 inch',
    'ELECTRONICS',
    'Computers',
    'Laptops',
    'Acme',
    '6901234567890',
    'piece',
    '45000.00',
    '42000',
    '3',
    '5',
    '10',
    '38000.00',
  ],
  [
    'PEN-010',
    'Ballpoint pen, blue (box of 50)',
    'STATIONERY',
    'Writing',
    '',
    'Bic',
    '',
    'box',
    '120.50',
    '100',
    '20',
    '40',
    '200',
    '85.25',
  ],
  [
    'NBK-020',
    'Exercise book, 40 leaves',
    'STATIONERY',
    'Paper',
    'Notebooks',
    '',
    '',
    'piece',
    '15',
    '',
    '50',
    '100',
    '0',
    '',
  ],
];

/** Header plus three example rows; cells with commas are quoted by toCsv. */
export function importTemplateCsv(): string {
  return toCsv([[...IMPORT_COLUMNS], ...EXAMPLES]);
}

/** A message when the text cannot be sent as it is; null when it is worth sending to the API. */
export function importTextProblem(text: string): string | null {
  if (text.trim() === '') return 'Choose a file or paste the rows first.';
  if (text.length > IMPORT_MAX_CHARS) {
    return `The file is too large: the limit is ${IMPORT_MAX_CHARS.toLocaleString('en-GB')} characters.`;
  }
  return null;
}
