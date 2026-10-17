import { EntityButton } from '@/components/entity-form';
import type { FieldDef } from '@/components/entity-form';
import { Empty, PageHeader, Pager, Table, num } from '@/components/ui';
import { formatMoney } from '@/lib/format';
import { MANAGERS, can } from '@/lib/roles';
import { api, qs } from '@/lib/server-api';
import type { Page, Supplier, User } from '@/lib/types';

export const metadata = { title: 'Suppliers' };

const FIELDS: FieldDef[] = [
  { key: 'name', label: 'Name', required: true, maxLength: 200 },
  { key: 'contactPerson', label: 'Contact person', maxLength: 300 },
  { key: 'phone', label: 'Phone', maxLength: 20 },
  { key: 'email', label: 'Email', kind: 'email', maxLength: 254 },
  { key: 'city', label: 'City', maxLength: 300 },
  { key: 'country', label: 'Country', maxLength: 300 },
  { key: 'address', label: 'Address', maxLength: 300 },
  {
    key: 'paymentTermsDays',
    label: 'Payment terms (days)',
    kind: 'number',
    min: 0,
    keepIfEmpty: true,
    initial: '0',
  },
  { key: 'notes', label: 'Notes', kind: 'textarea', maxLength: 1000 },
];

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<{ offset?: string }>;
}) {
  const sp = await searchParams;
  const me = await api<User>('/me');
  const manager = can(me.role, MANAGERS);
  const data = await api<Page<Supplier>>(`/suppliers${qs({ offset: num(sp.offset), limit: 25 })}`);

  return (
    <>
      <PageHeader
        title="Suppliers"
        subtitle={`${data.page.total} suppliers`}
        actions={
          manager ? (
            <EntityButton
              primary
              label="New supplier"
              title="New supplier"
              fields={FIELDS}
              createPath="/suppliers"
            />
          ) : null
        }
      />
      {data.items.length === 0 ? (
        <Empty>No suppliers yet.</Empty>
      ) : (
        <Table head={['Name', 'Contact', 'Terms', '>We owe', '']}>
          {data.items.map((s) => (
            <tr key={s.id} className="hover:bg-surface">
              <td className="td font-medium">{s.name}</td>
              <td className="td text-muted">
                {[s.contactPerson, s.phone, s.email].filter(Boolean).join(' · ') || '–'}
              </td>
              <td className="td">
                {s.paymentTermsDays === 0 ? 'On delivery' : `${s.paymentTermsDays} days`}
              </td>
              <td
                className={`td text-right tabular-nums ${s.payableMinor > 0 ? 'font-semibold' : ''}`}
              >
                {formatMoney(s.payableMinor)}
              </td>
              <td className="td text-right">
                {manager ? (
                  <EntityButton
                    label="Edit"
                    title={`Edit ${s.name}`}
                    fields={FIELDS}
                    record={s as unknown as Record<string, unknown> & { version: number }}
                    createPath="/suppliers"
                    updatePath={`/suppliers/${s.id}`}
                  />
                ) : null}
              </td>
            </tr>
          ))}
        </Table>
      )}
      <Pager page={data.page} path="/suppliers" params={{}} />
    </>
  );
}
