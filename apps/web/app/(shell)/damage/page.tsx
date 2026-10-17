import { ActionButton, ReasonButton } from '@/components/form';
import { Badge, Empty, PageHeader, Pager, Table, num, statusTone } from '@/components/ui';
import { formatDateTime, formatMoney, label } from '@/lib/format';
import { MANAGERS, can } from '@/lib/roles';
import { api, qs } from '@/lib/server-api';
import type { Damage, Page, Product, User } from '@/lib/types';
import { ReportDamage } from './report-damage';

export const metadata = { title: 'Damage and write-offs' };

export default async function DamagePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; offset?: string }>;
}) {
  const sp = await searchParams;
  const me = await api<User>('/me');
  const manager = can(me.role, MANAGERS);
  const [data, products] = await Promise.all([
    api<Page<Damage>>(`/damage${qs({ status: sp.status, offset: num(sp.offset), limit: 25 })}`),
    api<Page<Product>>('/products?limit=100&status=ACTIVE&sort=name'),
  ]);
  const name = (id: string) => products.items.find((p) => p.id === id)?.name ?? 'Product';

  return (
    <>
      <PageHeader
        title="Damage and write-offs"
        subtitle="Stock only leaves the books when someone other than the reporter approves."
        actions={
          <ReportDamage
            products={products.items.map((p) => ({
              id: p.id,
              name: p.name,
              stock: p.currentStock,
            }))}
          />
        }
      />
      <form className="no-print mb-4 flex items-end gap-2" method="get">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted">Status</span>
          <select className="input" name="status" defaultValue={sp.status ?? ''}>
            <option value="">All</option>
            <option value="PENDING">Waiting for a decision</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
          </select>
        </label>
        <button className="btn btn-primary">Filter</button>
      </form>
      {data.items.length === 0 ? (
        <Empty>No records.</Empty>
      ) : (
        <Table head={['Number', 'Product', 'Kind', '>Qty', 'Cause', 'Status', '>Loss', '']}>
          {data.items.map((d) => (
            <tr key={d.id}>
              <td className="td font-medium">{d.number}</td>
              <td className="td">
                {name(d.productId)}
                <div className="text-xs text-muted">{formatDateTime(d.createdAt)}</div>
              </td>
              <td className="td">{label(d.kind)}</td>
              <td className="td text-right tabular-nums">{d.quantity}</td>
              <td className="td max-w-64 truncate" title={d.cause}>
                {d.cause}
              </td>
              <td className="td">
                <Badge tone={statusTone(d.status)}>{label(d.status)}</Badge>
              </td>
              <td className="td text-right tabular-nums">
                {d.lossMinor !== null ? formatMoney(d.lossMinor) : '–'}
              </td>
              <td className="td">
                {manager && d.status === 'PENDING' ? (
                  <div className="flex justify-end gap-2">
                    <ActionButton
                      label="Approve"
                      primary
                      path={`/damage/${d.id}/approve`}
                      confirm="Approve and write this stock off?"
                    />
                    <ReasonButton
                      label="Reject"
                      title={`Reject ${d.number}`}
                      path={`/damage/${d.id}/reject`}
                      field="note"
                      danger
                    />
                  </div>
                ) : d.decisionNote ? (
                  <span className="text-xs text-muted">{d.decisionNote}</span>
                ) : null}
              </td>
            </tr>
          ))}
        </Table>
      )}
      <Pager page={data.page} path="/damage" params={{ status: sp.status }} />
    </>
  );
}
