import { NoAccess, PageHeader } from '@/components/ui';
import { IMPORT_COLUMNS } from '@/lib/import-template';
import { api } from '@/lib/server-api';
import type { User } from '@/lib/types';
import { ImportForm } from './import-form';

export const metadata = { title: 'Import' };

export default async function ImportPage() {
  const me = await api<User>('/me');
  if (me.role !== 'owner') {
    return (
      <>
        <PageHeader title="Import" />
        <NoAccess what="the stock import" />
      </>
    );
  }
  return (
    <>
      <PageHeader
        title="Import products and opening stock"
        subtitle="Bring a catalogue in from a CSV file. Products that already exist are left as they are."
        actions={
          <a className="btn" href="/import/template" download>
            Download the template
          </a>
        }
      />
      <section aria-label="Columns" className="card mb-5 p-4 text-sm">
        <h2 className="mb-1 font-semibold">The file</h2>
        <p className="text-muted">
          One header row, then one row per product. Columns:{' '}
          <code>{IMPORT_COLUMNS.join(', ')}</code>. Required: <code>sku</code>, <code>name</code>,{' '}
          <code>category</code> and <code>price</code>. Prices are in birr, for example 1200 or
          1200.50. A new category needs its <code>type</code> (ELECTRONICS or STATIONERY). Stock
          that comes in needs a <code>unit_cost</code> and is booked as the owner&apos;s capital.
        </p>
      </section>
      <ImportForm />
    </>
  );
}
