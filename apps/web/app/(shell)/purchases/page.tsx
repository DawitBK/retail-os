import Link from 'next/link';
import { Badge, Empty, PageHeader, Pager, Table, num, statusTone } from '@/components/ui';
import { formatDate, formatMoney, label } from '@/lib/format';
import { MANAGERS, can } from '@/lib/roles';
import { api, qs } from '@/lib/server-api';
import type { Page, Purchase, Supplier, User } from '@/lib/types';

export const metadata = { title: 'Purchases' };

export default async function PurchasesPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    paymentStatus?: string;
    supplierId?: string;
    offset?: string;
  }>;
}) {
  const sp = await searchParams;
  const me = await api<User>('/me');
  const [data, suppliers] = await Promise.all([
    api<Page<Purchase>>(
      `/purchases${qs({ status: sp.status, paymentStatus: sp.paymentStatus, supplierId: sp.supplierId, offset: num(sp.offset), limit: 25 })}`,
    ),
    api<Page<Supplier>>('/suppliers?limit=100'),
  ]);
  const name = (id: string) => suppliers.items.find((s) => s.id === id)?.name ?? '–';

  return (
    <>
      <PageHeader
        title="Purchases"
        subtitle={`${data.page.total} orders`}
        actions={
          can(me.role, MANAGERS) ? (
            <Link className="btn btn-primary" href="/purchases/new">
              New order
            </Link>
          ) : null
        }
      />
      <form className="no-print mb-4 flex flex-wrap items-end gap-2" method="get">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted">Supplier</span>
          <select className="input" name="supplierId" defaultValue={sp.supplierId ?? ''}>
            <option value="">All</option>
            {suppliers.items.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted">Payment</span>
          <select className="input" name="paymentStatus" defaultValue={sp.paymentStatus ?? ''}>
            <option value="">All</option>
            <option value="UNPAID">Unpaid</option>
            <option value="PARTIAL">Part paid</option>
            <option value="PAID">Paid</option>
          </select>
        </label>
        <button className="btn btn-primary">Filter</button>
      </form>
      {data.items.length === 0 ? (
        <Empty>No purchase orders.</Empty>
      ) : (
        <Table head={['Number', 'Supplier', 'Ordered', 'Status', 'Payment', '>Total', '>We owe']}>
          {data.items.map((p) => (
            <tr key={p.id} className="hover:bg-surface">
              <td className="td font-medium">
                <Link className="hover:underline" href={`/purchases/${p.id}`}>
                  {p.number}
                </Link>
              </td>
              <td className="td">{name(p.supplierId)}</td>
              <td className="td">{formatDate(p.orderDate)}</td>
              <td className="td">
                <Badge tone={statusTone(p.status)}>{label(p.status)}</Badge>
              </td>
              <td className="td">
                <Badge tone={statusTone(p.paymentStatus)}>{label(p.paymentStatus)}</Badge>
              </td>
              <td className="td text-right tabular-nums">{formatMoney(p.totalMinor)}</td>
              <td className="td text-right tabular-nums">
                {p.payableMinor > 0 ? formatMoney(p.payableMinor) : '–'}
              </td>
            </tr>
          ))}
        </Table>
      )}
      <Pager
        page={data.page}
        path="/purchases"
        params={{ status: sp.status, paymentStatus: sp.paymentStatus, supplierId: sp.supplierId }}
      />
    </>
  );
}
