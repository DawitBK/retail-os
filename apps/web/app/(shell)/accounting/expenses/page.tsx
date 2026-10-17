import { EntityButton } from '@/components/entity-form';
import type { FieldDef } from '@/components/entity-form';
import { ReasonButton } from '@/components/form';
import { Badge, Empty, PageHeader, Pager, Table, num } from '@/components/ui';
import { formatDate, formatMoney, label, today } from '@/lib/format';
import { MANAGERS, can } from '@/lib/roles';
import { api, qs } from '@/lib/server-api';
import type { Account, Expense, Page, User } from '@/lib/types';

export const metadata = { title: 'Expenses' };

const EXPENSE_CODES = ['6000', '6010', '6020', '6030', '6040', '6050', '6900'];

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ accountCode?: string; from?: string; to?: string; offset?: string }>;
}) {
  const sp = await searchParams;
  const me = await api<User>('/me');
  const manager = can(me.role, MANAGERS);
  const [data, accounts] = await Promise.all([
    api<Page<Expense>>(
      `/expenses${qs({ accountCode: sp.accountCode, from: sp.from, to: sp.to, offset: num(sp.offset), limit: 25 })}`,
    ),
    api<Account[] | Page<Account>>('/accounting/accounts'),
  ]);
  const list = Array.isArray(accounts) ? accounts : accounts.items;
  const expenseAccounts = list.filter((a) => EXPENSE_CODES.includes(a.code));
  const fields: FieldDef[] = [
    {
      key: 'accountCode',
      label: 'Type of expense',
      kind: 'select',
      options: expenseAccounts.map((a) => ({ value: a.code, label: a.name })),
      required: true,
    },
    { key: 'description', label: 'What for', required: true, maxLength: 300 },
    { key: 'amountMinor', label: 'Amount', kind: 'money', required: true },
    {
      key: 'paymentMethod',
      label: 'Paid by',
      kind: 'select',
      options: ['CASH', 'BANK_TRANSFER', 'MOBILE_MONEY'].map((m) => ({
        value: m,
        label: label(m),
      })),
    },
    { key: 'expenseDate', label: 'Date', kind: 'date', initial: today() },
    { key: 'vendor', label: 'Paid to', maxLength: 200 },
    { key: 'receiptNumber', label: 'Receipt number', maxLength: 100 },
  ];
  const name = (code: string) => expenseAccounts.find((a) => a.code === code)?.name ?? code;

  return (
    <>
      <PageHeader
        title="Expenses"
        subtitle="Rent, wages, utilities and the like. Each posts to the journal."
        actions={
          <EntityButton
            primary
            label="Record expense"
            title="Record an expense"
            fields={fields}
            createPath="/expenses"
          />
        }
      />
      <form className="no-print mb-4 flex flex-wrap items-end gap-2" method="get">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted">Type</span>
          <select className="input" name="accountCode" defaultValue={sp.accountCode ?? ''}>
            <option value="">All</option>
            {expenseAccounts.map((a) => (
              <option key={a.code} value={a.code}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted">From</span>
          <input className="input" type="date" name="from" defaultValue={sp.from} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted">To</span>
          <input className="input" type="date" name="to" defaultValue={sp.to} />
        </label>
        <button className="btn btn-primary">Filter</button>
      </form>
      {data.items.length === 0 ? (
        <Empty>No expenses recorded.</Empty>
      ) : (
        <Table head={['Number', 'Date', 'Type', 'Description', 'Paid by', '>Amount', '']}>
          {data.items.map((e) => (
            <tr key={e.id} className={e.voided ? 'text-muted line-through' : ''}>
              <td className="td font-medium">{e.number}</td>
              <td className="td">{formatDate(e.expenseDate)}</td>
              <td className="td">{name(e.accountCode)}</td>
              <td className="td">
                {e.description}
                {e.vendor ? <span className="text-muted"> · {e.vendor}</span> : null}
              </td>
              <td className="td">{label(e.paymentMethod)}</td>
              <td className="td text-right tabular-nums">{formatMoney(e.amountMinor)}</td>
              <td className="td text-right">
                {e.voided ? (
                  <Badge tone="bad">Voided</Badge>
                ) : manager ? (
                  <ReasonButton
                    label="Void"
                    title={`Void ${e.number}`}
                    path={`/expenses/${e.id}/void`}
                    danger
                  />
                ) : null}
              </td>
            </tr>
          ))}
        </Table>
      )}
      <Pager
        page={data.page}
        path="/accounting/expenses"
        params={{ accountCode: sp.accountCode, from: sp.from, to: sp.to }}
      />
    </>
  );
}
