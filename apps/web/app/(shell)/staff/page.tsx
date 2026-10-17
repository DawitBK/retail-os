import { redirect } from 'next/navigation';
import { EntityButton } from '@/components/entity-form';
import type { FieldDef } from '@/components/entity-form';
import { Badge, Empty, PageHeader, Pager, Table, num } from '@/components/ui';
import { formatDate, label } from '@/lib/format';
import { api, qs } from '@/lib/server-api';
import type { Page, User } from '@/lib/types';

export const metadata = { title: 'Staff' };

const ROLES = ['owner', 'manager', 'accountant', 'cashier'].map((r) => ({
  value: r,
  label: label(r),
}));

const NEW: FieldDef[] = [
  { key: 'firstName', label: 'First name', required: true, maxLength: 100 },
  { key: 'lastName', label: 'Last name', required: true, maxLength: 100 },
  { key: 'email', label: 'Email', kind: 'email', required: true, createOnly: true, maxLength: 254 },
  { key: 'role', label: 'Role', kind: 'select', options: ROLES, initial: 'cashier' },
  {
    key: 'password',
    label: 'Password',
    kind: 'password',
    required: true,
    createOnly: true,
    hint: 'At least 12 characters. They can change it after signing in.',
  },
];
const EDIT: FieldDef[] = [
  { key: 'firstName', label: 'First name', required: true, maxLength: 100 },
  { key: 'lastName', label: 'Last name', required: true, maxLength: 100 },
  { key: 'role', label: 'Role', kind: 'select', options: ROLES },
  {
    key: 'active',
    label: 'Account',
    kind: 'select',
    boolean: true,
    options: [
      { value: 'true', label: 'Active' },
      { value: 'false', label: 'Disabled (signs out immediately)' },
    ],
  },
  {
    key: 'password',
    label: 'New password',
    kind: 'password',
    keepIfEmpty: true,
    hint: 'Leave empty to keep the current one',
  },
];

export default async function StaffPage({
  searchParams,
}: {
  searchParams: Promise<{ offset?: string }>;
}) {
  const sp = await searchParams;
  const me = await api<User>('/me');
  if (me.role !== 'owner') redirect('/');
  const data = await api<Page<User>>(`/staff${qs({ offset: num(sp.offset), limit: 25 })}`);

  return (
    <>
      <PageHeader
        title="Staff"
        subtitle="Only the owner creates accounts; there is no public sign-up."
        actions={
          <EntityButton
            primary
            label="Add staff"
            title="Add a staff member"
            fields={NEW}
            createPath="/staff"
          />
        }
      />
      {data.items.length === 0 ? (
        <Empty>No staff.</Empty>
      ) : (
        <Table head={['Name', 'Email', 'Role', 'Account', 'Since', '']}>
          {data.items.map((u) => (
            <tr key={u.id}>
              <td className="td font-medium">
                {u.firstName} {u.lastName}
              </td>
              <td className="td text-muted">{u.email}</td>
              <td className="td">
                <Badge tone={u.role === 'owner' ? 'info' : 'neutral'}>{label(u.role)}</Badge>
              </td>
              <td className="td">
                {u.active ? <Badge tone="good">Active</Badge> : <Badge tone="bad">Disabled</Badge>}
              </td>
              <td className="td">{formatDate(u.createdAt)}</td>
              <td className="td text-right">
                <EntityForm2 user={u} />
              </td>
            </tr>
          ))}
        </Table>
      )}
      <Pager page={data.page} path="/staff" params={{}} />
    </>
  );
}

/** Active is a boolean in the API but a select string in the form, so the record is adapted here. */
function EntityForm2({ user }: { user: User }) {
  const record = { ...user, active: String(user.active) } as unknown as Record<string, unknown> & {
    version: number;
  };
  return (
    <EntityButton
      label="Edit"
      title={`Edit ${user.firstName} ${user.lastName}`}
      fields={EDIT}
      record={record}
      createPath="/staff"
      updatePath={`/staff/${user.id}`}
    />
  );
}
