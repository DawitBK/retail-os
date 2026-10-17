import { Badge, Empty, PageHeader, Pager, num, statusTone } from '@/components/ui';
import { formatDate, formatMoney } from '@/lib/format';
import { api, qs } from '@/lib/server-api';
import type { JournalEntry, Page } from '@/lib/types';

export const metadata = { title: 'Journal' };

export default async function JournalPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; referenceType?: string; offset?: string }>;
}) {
  const sp = await searchParams;
  const data = await api<Page<JournalEntry>>(
    `/accounting/journal${qs({ from: sp.from, to: sp.to, referenceType: sp.referenceType, offset: num(sp.offset), limit: 20 })}`,
  );
  return (
    <>
      <PageHeader
        title="Journal"
        subtitle="Every entry balances. A mistake is reversed, never edited."
      />
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
          <span className="mb-1 block text-xs text-muted">Source</span>
          <select className="input" name="referenceType" defaultValue={sp.referenceType ?? ''}>
            <option value="">All</option>
            {[
              'SALE',
              'SALE_RETURN',
              'PURCHASE_RECEIPT',
              'SUPPLIER_PAYMENT',
              'EXPENSE',
              'CUSTOMER_RECEIPT',
              'DAMAGE',
              'STOCK_AUDIT',
              'OPENING_BALANCE',
              'REVERSAL',
            ].map((r) => (
              <option key={r} value={r}>
                {r.toLowerCase().replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </label>
        <button className="btn btn-primary">Filter</button>
      </form>
      {data.items.length === 0 ? (
        <Empty>No entries.</Empty>
      ) : (
        <ul className="space-y-3">
          {data.items.map((e) => (
            <li key={e.id} className="card overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface px-3 py-2">
                <div className="text-sm">
                  <span className="font-semibold">{e.entryNumber}</span>
                  <span className="ml-2 text-muted">{formatDate(e.entryDate)}</span>
                  <span className="ml-2">{e.description}</span>
                </div>
                <Badge tone={statusTone(e.status)}>{e.status.toLowerCase()}</Badge>
              </div>
              <table className="w-full">
                <tbody className="divide-y divide-line">
                  {e.lines.map((l, i) => (
                    <tr key={i}>
                      <td className="td w-16 text-muted">{l.accountCode}</td>
                      <td className={`td ${l.creditMinor > 0 ? 'pl-8' : ''}`}>{l.accountName}</td>
                      <td className="td w-32 text-right tabular-nums">
                        {l.debitMinor > 0 ? formatMoney(l.debitMinor) : ''}
                      </td>
                      <td className="td w-32 text-right tabular-nums">
                        {l.creditMinor > 0 ? formatMoney(l.creditMinor) : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </li>
          ))}
        </ul>
      )}
      <Pager
        page={data.page}
        path="/accounting/journal"
        params={{ from: sp.from, to: sp.to, referenceType: sp.referenceType }}
      />
    </>
  );
}
