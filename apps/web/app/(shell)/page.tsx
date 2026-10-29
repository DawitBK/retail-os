import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Empty, PageHeader, Stat, Table } from '@/components/ui';
import { formatDays, formatRate } from '@/lib/analytics';
import { formatMoney, pct } from '@/lib/format';
import { MANAGERS, can, homeFor } from '@/lib/roles';
import { api, apiSafe } from '@/lib/server-api';
import type { Dashboard, ReorderForecast, User } from '@/lib/types';

export const metadata = { title: 'Dashboard' };

export default async function DashboardPage() {
  const me = await api<User>('/me');
  if (homeFor(me.role) !== '/') redirect(homeFor(me.role));
  const [d, reorder] = await Promise.all([
    api<Dashboard>('/dashboard'),
    // Only the people who buy see this; a refusal just leaves the table out.
    can(me.role, MANAGERS) ? apiSafe<ReorderForecast>('/forecasting/reorder?limit=8') : null,
  ]);
  const max = Math.max(1, ...d.revenue30Days.map((x) => x.revenueMinor));

  return (
    <>
      <PageHeader title="Dashboard" subtitle={`As of ${d.asOf}`} />

      <section aria-label="Today" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Sales today"
          value={formatMoney(d.today.revenueMinor)}
          hint={`${d.today.transactions} sales`}
        />
        <Stat
          label="Gross profit today"
          value={formatMoney(d.today.grossProfitMinor)}
          hint={`Margin ${pct(d.today.grossMarginPct)}`}
        />
        <Stat
          label="Month to date"
          value={formatMoney(d.monthToDate.revenueMinor)}
          hint={`Gross margin ${pct(d.monthToDate.grossMarginPct)}`}
        />
        <Stat
          label="Net profit, month"
          value={formatMoney(d.monthToDate.netProfitMinor)}
          tone={d.monthToDate.netProfitMinor < 0 ? 'bad' : 'good'}
          hint={`After ${formatMoney(d.monthToDate.expensesMinor)} of expenses`}
        />
      </section>

      <section aria-label="Cash and stock" className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Cash in hand" value={formatMoney(d.cash.cashInHandMinor)} />
        <Stat label="In the bank" value={formatMoney(d.cash.cashInBankMinor)} />
        <Stat label="Owed to us" value={formatMoney(d.cash.receivablesMinor)} />
        <Stat label="We owe" value={formatMoney(d.cash.payablesMinor)} />
        <Stat
          label="Stock at cost"
          value={formatMoney(d.inventory.totalValueMinor)}
          hint={`${d.inventory.skus} products`}
        />
      </section>

      <section aria-label="Sales, last 30 days" className="card mt-5 p-4">
        <h2 className="mb-3 text-sm font-semibold">Sales, last 30 days</h2>
        <div
          className="flex h-36 items-end gap-1"
          role="img"
          aria-label="Daily sales for the last 30 days"
        >
          {d.revenue30Days.map((x) => (
            <div key={x.date} className="group relative flex-1">
              <div
                className="rounded-t bg-brand/70 group-hover:bg-brand"
                style={{
                  height: `${Math.max((x.revenueMinor / max) * 100, x.revenueMinor > 0 ? 3 : 0.5)}%`,
                }}
              />
              <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 rounded bg-ink px-2 py-1 text-xs whitespace-nowrap text-white group-hover:block">
                {x.date}: {formatMoney(x.revenueMinor)}
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <section aria-label="Needs attention">
          <h2 className="mb-2 text-sm font-semibold">Needs attention</h2>
          <div className="card divide-y divide-line">
            <AttentionRow href="/alerts" label="Out of stock" n={d.inventory.outOfStock} />
            <AttentionRow
              href="/products?lowStock=true"
              label="Low stock"
              n={d.inventory.lowStock}
            />
            <AttentionRow
              href="/products?negativeMargin=true"
              label="Selling below cost"
              n={d.inventory.negativeMargin}
            />
            <AttentionRow
              href="/alerts"
              label={`Dead stock (${formatMoney(d.inventory.deadStockValueMinor)} tied up)`}
              n={d.inventory.deadStock}
            />
          </div>
        </section>
        <section aria-label="Top products">
          <h2 className="mb-2 text-sm font-semibold">Top products, this month</h2>
          {d.topProducts.length === 0 ? (
            <Empty>No sales yet this month.</Empty>
          ) : (
            <Table head={['Product', '>Units', '>Revenue', '>Profit']}>
              {d.topProducts.map((p) => (
                <tr key={p.productId}>
                  <td className="td">
                    <Link className="hover:underline" href={`/products/${p.productId}`}>
                      {p.name}
                    </Link>
                  </td>
                  <td className="td text-right tabular-nums">{p.unitsSold}</td>
                  <td className="td text-right tabular-nums">{formatMoney(p.revenueMinor)}</td>
                  <td className="td text-right tabular-nums">{formatMoney(p.grossProfitMinor)}</td>
                </tr>
              ))}
            </Table>
          )}
        </section>
      </div>

      {reorder?.ok ? (
        <section aria-label="Reorder needed" className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Reorder needed</h2>
            <Link className="text-sm text-brand hover:underline" href="/forecasting">
              All forecasts
            </Link>
          </div>
          {reorder.data.rows.length === 0 ? (
            <Empty>Nothing needs reordering soon.</Empty>
          ) : (
            <Table
              head={['Product', '>Stock', '>Sold per day', '>Days until stockout']}
              caption="Products that will run out soonest"
            >
              {reorder.data.rows.map((r) => (
                <tr key={r.productId}>
                  <td className="td">
                    <Link className="hover:underline" href={`/inventory/${r.productId}`}>
                      {r.name}
                    </Link>
                  </td>
                  <td className="td text-right tabular-nums">{r.currentStock}</td>
                  <td className="td text-right tabular-nums">{formatRate(r.velocityPerDay)}</td>
                  <td className="td text-right tabular-nums">{formatDays(r.daysUntilStockout)}</td>
                </tr>
              ))}
            </Table>
          )}
        </section>
      ) : null}
    </>
  );
}

function AttentionRow({ href, label, n }: { href: string; label: string; n: number }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-surface"
    >
      <span>{label}</span>
      <span className={`font-semibold tabular-nums ${n > 0 ? 'text-bad' : 'text-muted'}`}>{n}</span>
    </Link>
  );
}
