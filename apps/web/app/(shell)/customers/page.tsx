import { EntityButton } from '@/components/entity-form';
import type { FieldDef } from '@/components/entity-form';
import { Badge, Empty, PageHeader, Pager, Table, num } from '@/components/ui';
import { formatMoney, label } from '@/lib/format';
import { MANAGERS, can } from '@/lib/roles';
import { api, qs } from '@/lib/server-api';
import type { Customer, Page, User } from '@/lib/types';

export const metadata = { title: 'Customers' };

const TYPES = ['RETAIL', 'WHOLESALE', 'INSTITUTIONAL'].map((t) => ({ value: t, label: label(t) }));

function fields(manager: boolean): FieldDef[] {
  return [
    { key: 'name', label: 'Name', required: true, maxLength: 200 },
    { key: 'phone', label: 'Phone', maxLength: 20 },
    { key: 'email', label: 'Email', kind: 'email', maxLength: 254 },
    { key: 'city', label: 'City', maxLength: 300 },
    { key: 'address', label: 'Address', maxLength: 300 },
    { key: 'type', label: 'Type', kind: 'select', options: TYPES, initial: 'RETAIL' },
    ...(manager
      ? [
          {
            key: 'creditLimitMinor',
            label: 'Credit limit',
            kind: 'money' as const,
            keepIfEmpty: true,
            createOnly: false,
            hint: 'The most this customer may owe at once',
          },
        ]
      : []),
    { key: 'notes', label: 'Notes', kind: 'textarea', maxLength: 1000 },
  ];
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; offset?: string }>;
}) {
  const sp = await searchParams;
  const me = await api<User>('/me');
  const manager = can(me.role, MANAGERS);
  const data = await api<Page<Customer>>(
    `/customers${qs({ type: sp.type, offset: num(sp.offset), limit: 25 })}`,
  );
  // A cashier may create a customer but only a manager may set a credit limit, so that field is edit-only.
  const createFields = fields(false);
  const editFields = fields(manager);

  return (
    <>
      <PageHeader
        title="Customers"
        subtitle={`${data.page.total} customers`}
        actions={
          <EntityButton
            primary
            label="New customer"
            title="New customer"
            fields={createFields}
            createPath="/customers"
          />
        }
      />
      {data.items.length === 0 ? (
        <Empty>No customers yet.</Empty>
      ) : (
        <Table head={['Name', 'Contact', 'Type', '>Credit limit', '>Owes', '']}>
          {data.items.map((c) => (
            <tr key={c.id} className="hover:bg-surface">
              <td className="td font-medium">{c.name}</td>
              <td className="td text-muted">
                {[c.phone, c.email].filter(Boolean).join(' · ') || '–'}
              </td>
              <td className="td">
                <Badge>{label(c.type)}</Badge>
              </td>
              <td className="td text-right tabular-nums">{formatMoney(c.creditLimitMinor)}</td>
              <td
                className={`td text-right tabular-nums ${c.outstandingMinor > 0 ? 'font-semibold' : ''}`}
              >
                {formatMoney(c.outstandingMinor)}
              </td>
              <td className="td text-right">
                {manager ? (
                  <EntityButton
                    label="Edit"
                    title={`Edit ${c.name}`}
                    fields={editFields}
                    record={c as unknown as Record<string, unknown> & { version: number }}
                    createPath="/customers"
                    updatePath={`/customers/${c.id}`}
                  />
                ) : null}
              </td>
            </tr>
          ))}
        </Table>
      )}
      <Pager page={data.page} path="/customers" params={{ type: sp.type }} />
    </>
  );
}
