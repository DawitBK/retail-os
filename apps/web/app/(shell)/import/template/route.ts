import { importTemplateCsv } from '@/lib/import-template';

/** The blank CSV an owner fills in: the 14 columns the importer reads, with three example rows. */
export function GET() {
  return new Response(importTemplateCsv(), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="inventory-import-template.csv"',
      'cache-control': 'no-store',
    },
  });
}
