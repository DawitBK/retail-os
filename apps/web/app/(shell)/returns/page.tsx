import Link from 'next/link';
import { Empty, NoAccess, Notice, PageHeader, Pager, Table, num } from '@/components/ui';
import { formatDate, formatMoney, label } from '@/lib/format';
import { WATCHERS, can } from '@/lib/roles';
import { api, apiOrNull, apiSafe } from '@/lib/server-api';
import type { Page, Purchase, PurchaseReturn, Sale, SaleReturn, User } from '@/lib/types';

export const metadata = { title: 'Returns' };

const VIEWS = [
  ['sales', 'Sale returns'],
  ['purchases', 'Purchase returns'],
] as const;

type Search = { view?: string; offset?: string };

export default async function ReturnsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const me = await api<User>('/me');
  if (!can(me.role, WATCHERS)) {
    return (
      <>
        <PageHeader title="Returns" />
        <NoAccess what="returns" />
      </>
    );
  }
  const view = VIEWS.find(([v]) => v === sp.view)?.[0] ?? 'sales';
  const offset = num(sp.offset);

  return (
    <>
      <PageHeader
        title="Returns"
        subtitle="Goods customers brought back, and goods sent back to suppliers."
      />
      <nav aria-label="Kind of return" className="no-print mb-4 flex flex-wrap gap-1">
        {VIEWS.map(([v, text]) => (
          <Link
            key={v}
            href={`/returns?view=${v}`}
            aria-current={view === v ? 'page' : undefined}
            className={`btn ${view === v ? 'btn-primary' : ''}`}
          >
            {text}
          </Link>
        ))}
      </nav>
      {view === 'sales' ? <SaleReturns offset={offset} /> : <PurchaseReturns offset={offset} />}
    </>
  );
}

async function SaleReturns({ offset }: { offset: number }) {
  const r = await apiSafe<Page<SaleReturn>>(`/returns?limit=25&offset=${offset}`);
  if (!r.ok) return <Notice tone="bad">{r.message}</Notice>;
  const ids = [...new Set(r.data.items.map((x) => x.saleId))];
  const sales = await Promise.all(ids.map((id) => apiOrNull<Sale>(`/sales/${id}`)));
  const numberOf = new Map(ids.map((id, i) => [id, sales[i]?.number]));
  if (r.data.items.length === 0) return <Empty>No sale returns yet.</Empty>;
  return (
    <>
      <Table
        head={[
          'Number',
          'Date',
          'Sale',
          '>Refund',
          '>Set against debt',
          '>Paid out',
          'Paid by',
          'Reason',
        ]}
        caption="Sale returns"
      >
        {r.data.items.map((x) => (
          <tr key={x.id}>
            <td className="td font-medium">{x.number}</td>
            <td className="td whitespace-nowrap">{formatDate(x.createdAt)}</td>
            <td className="td">
              <Link className="hover:underline" href={`/sales/${x.saleId}`}>
                {numberOf.get(x.saleId) ?? 'View sale'}
              </Link>
            </td>
            <td className="td text-right tabular-nums">{formatMoney(x.refundMinor)}</td>
            <td className="td text-right tabular-nums">
              {formatMoney(x.appliedToReceivableMinor)}
            </td>
            <td className="td text-right tabular-nums">{formatMoney(x.cashRefundMinor)}</td>
            <td className="td">{x.refundMethod ? label(x.refundMethod) : '–'}</td>
            <td className="td">{x.reason}</td>
          </tr>
        ))}
      </Table>
      <Pager page={r.data.page} path="/returns" params={{ view: 'sales' }} />
    </>
  );
}

async function PurchaseReturns({ offset }: { offset: number }) {
  const r = await apiSafe<Page<PurchaseReturn>>(`/purchase-returns?limit=25&offset=${offset}`);
  if (!r.ok) return <Notice tone="bad">{r.message}</Notice>;
  const ids = [...new Set(r.data.items.map((x) => x.purchaseId))];
  const purchases = await Promise.all(ids.map((id) => apiOrNull<Purchase>(`/purchases/${id}`)));
  const numberOf = new Map(ids.map((id, i) => [id, purchases[i]?.number]));
  if (r.data.items.length === 0) return <Empty>No purchase returns yet.</Empty>;
  return (
    <>
      <Table
        head={[
          'Number',
          'Date',
          'Purchase',
          '>Credit from supplier',
          '>Set against what we owe',
          '>Paid back to us',
          'Paid by',
          'Reason',
        ]}
        caption="Purchase returns"
      >
        {r.data.items.map((x) => (
          <tr key={x.id}>
            <td className="td font-medium">{x.number}</td>
            <td className="td whitespace-nowrap">{formatDate(x.createdAt)}</td>
            <td className="td">
              <Link className="hover:underline" href={`/purchases/${x.purchaseId}`}>
                {numberOf.get(x.purchaseId) ?? 'View purchase'}
              </Link>
            </td>
            <td className="td text-right tabular-nums">{formatMoney(x.valueMinor)}</td>
            <td className="td text-right tabular-nums">{formatMoney(x.creditAppliedMinor)}</td>
            <td className="td text-right tabular-nums">{formatMoney(x.refundMinor)}</td>
            <td className="td">{x.refundMethod ? label(x.refundMethod) : '–'}</td>
            <td className="td">{x.reason}</td>
          </tr>
        ))}
      </Table>
      <Pager page={r.data.page} path="/returns" params={{ view: 'purchases' }} />
    </>
  );
}
