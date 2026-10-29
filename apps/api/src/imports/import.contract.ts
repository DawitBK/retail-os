import { z } from 'zod';

export const importInventorySchema = z
  .object({
    format: z.literal('csv').default('csv'),
    content: z
      .string()
      .min(1)
      .max(2_000_000)
      .describe(
        'The CSV text. Columns: sku, name, type, category, sub_category, brand, barcode, unit, price, min_price, reorder_point, reorder_qty, quantity, unit_cost. Prices are in birr, e.g. 1200.50.',
      ),
    dryRun: z
      .boolean()
      .default(false)
      .describe('Check the file and report what would happen without changing anything'),
  })
  .strict();
export type ImportInventory = z.output<typeof importInventorySchema>;

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

export const importReportSchema = z.object({
  applied: z.boolean(),
  dryRun: z.boolean(),
  rows: z.number().int(),
  categoriesCreated: z.number().int(),
  subCategoriesCreated: z.number().int(),
  brandsCreated: z.number().int(),
  productsCreated: z.number().int(),
  skippedExisting: z
    .array(z.string())
    .describe('SKUs that already exist; left exactly as they are'),
  stockUnits: z.number().int(),
  stockValueMinor: z.number().int(),
  entryNumber: z.string().nullable().describe('The journal entry that booked the imported stock'),
});
export type ImportReport = z.output<typeof importReportSchema>;
