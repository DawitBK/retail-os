import Link from 'next/link';
import { Badge, Empty, PageHeader, Pager, Table, num, statusTone } from '@/components/ui';
import { formatDateTime, formatMoney, label } from '@/lib/format';
import { api, qs } from '@/lib/server-api';
import type { Page, Sale } from '@/lib/types';

export const metadata = { title: 'Sales' };

type Search = {
  status?: string;
  paymentMethod?: string;
  from?: string;
  to?: string;
  offset?: string;
};

export default async function SalesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const offset = num(sp.offset);
  const data = await api<Page<Sale>>(
    `/sales${qs({ status: sp.status, paymentMethod: sp.paymentMethod, from: sp.from, to: sp.to, offset, limit: 25 })}`,
  );

  return (
    <>
      <PageHeader title="Sales" subtitle={`${data.page.total} sales`} />
      <form className="no-print mb-4 flex flex-wrap items-end gap-2" method="get">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted">From</span>
          <input className="input" type="date" name="from" defaultValue={sp.from} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted">To</span>
          <input className="input" type="date" name="to" defaultValue={sp.to} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted">Payment</span>
          <select className="input" name="paymentMethod" defaultValue={sp.paymentMethod ?? ''}>
            <option value="">All</option>
            {['CASH', 'MOBILE_MONEY', 'BANK_TRANSFER', 'CREDIT'].map((m) => (
              <option key={m} value={m}>
                {label(m)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted">Status</span>
          <select className="input" name="status" defaultValue={sp.status ?? ''}>
            <option value="">All</option>
            <option value="COMPLETED">Completed</option>
            <option value="VOIDED">Voided</option>
          </select>
        </label>
        <button className="btn btn-primary">Filter</button>
      </form>

      {data.items.length === 0 ? (
        <Empty>No sales match these filters.</Empty>
      ) : (
        <Table head={['Number', 'Date', 'Payment', 'Status', '>Total', '>Owed']}>
          {data.items.map((s) => (
            <tr key={s.id} className="hover:bg-surface">
              <td className="td font-medium">
                <Link className="hover:underline" href={`/sales/${s.id}`}>
                  {s.number}
                </Link>
              </td>
              <td className="td">{formatDateTime(s.saleDate)}</td>
              <td className="td">{label(s.paymentMethod)}</td>
              <td className="td">
                <Badge tone={statusTone(s.status)}>{label(s.status)}</Badge>
              </td>
              <td className="td text-right tabular-nums">{formatMoney(s.totalMinor)}</td>
              <td className="td text-right tabular-nums">
                {s.outstandingMinor > 0 ? formatMoney(s.outstandingMinor) : '–'}
              </td>
            </tr>
          ))}
        </Table>
      )}
      <Pager
        page={data.page}
        path="/sales"
        params={{ status: sp.status, paymentMethod: sp.paymentMethod, from: sp.from, to: sp.to }}
      />
    </>
  );
}
