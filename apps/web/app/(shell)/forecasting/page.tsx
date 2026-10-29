import Link from 'next/link';
import { Empty, NoAccess, Notice, PageHeader, Table } from '@/components/ui';
import { formatDays, formatRate, pickInt } from '@/lib/analytics';
import { formatDate, formatMoney } from '@/lib/format';
import { MANAGERS, can } from '@/lib/roles';
import { api, apiSafe, qs } from '@/lib/server-api';
import type {
  DeadStockForecast,
  PurchaseSuggestions,
  ReorderForecast,
  SalesForecast,
  User,
} from '@/lib/types';

export const metadata = { title: 'Forecasting' };

type Search = { leadTimeDays?: string };

export default async function ForecastingPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const me = await api<User>('/me');
  if (!can(me.role, MANAGERS)) {
    return (
      <>
        <PageHeader title="Forecasting" />
        <NoAccess what="forecasts" />
      </>
    );
  }
  const leadTimeDays = pickInt(sp.leadTimeDays, 0, 120, 7);
  const [reorder, dead, sales, suggestions] = await Promise.all([
    apiSafe<ReorderForecast>(`/forecasting/reorder${qs({ leadTimeDays, limit: 50 })}`),
    apiSafe<DeadStockForecast>(`/forecasting/dead-stock${qs({ limit: 50 })}`),
    apiSafe<SalesForecast>(`/forecasting/sales${qs({ limit: 50 })}`),
    apiSafe<PurchaseSuggestions>(`/forecasting/suggestions${qs({ leadTimeDays, limit: 50 })}`),
  ]);

  return (
    <>
      <PageHeader
        title="Forecasting"
        subtitle="What to buy, what to chase and what to expect, worked out from the last 30 days of sales."
        actions={
          <Link className="btn btn-primary" href="/purchases/new">
            Create purchase order
          </Link>
        }
      />
      <form className="no-print mb-5 flex flex-wrap items-end gap-2" method="get">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted">Supplier lead time, days (0 to 120)</span>
          <input
            className="input w-32"
            type="number"
            min={0}
            max={120}
            name="leadTimeDays"
            defaultValue={leadTimeDays}
          />
        </label>
        <button className="btn btn-primary">Show</button>
      </form>

      <div className="space-y-8">
        <Section title="Reorder soon" result={reorder}>
          {(d) =>
            d.rows.length === 0 ? (
              <Empty>Nothing needs reordering within {d.leadTimeDays} days.</Empty>
            ) : (
              <Table
                head={[
                  'Product',
                  '>Stock',
                  '>Reorder at',
                  '>Sold per day',
                  '>Days until stockout',
                  'Stockout date',
                  'Order by',
                ]}
                caption="Products that will run out"
              >
                {d.rows.map((r) => (
                  <tr key={r.productId}>
                    <td className="td font-medium">
                      <Link className="hover:underline" href={`/inventory/${r.productId}`}>
                        {r.name}
                      </Link>
                      <span className="ml-2 text-xs text-muted">{r.sku}</span>
                    </td>
                    <td className="td text-right tabular-nums">{r.currentStock}</td>
                    <td className="td text-right tabular-nums">{r.reorderPoint}</td>
                    <td className="td text-right tabular-nums">{formatRate(r.velocityPerDay)}</td>
                    <td className="td text-right tabular-nums">
                      {formatDays(r.daysUntilStockout)}
                    </td>
                    <td className="td whitespace-nowrap">{formatDate(r.stockoutDate)}</td>
                    <td className="td whitespace-nowrap">{formatDate(r.reorderByDate)}</td>
                  </tr>
                ))}
              </Table>
            )
          }
        </Section>

        <Section title="Dead stock" result={dead}>
          {(d) =>
            d.rows.length === 0 ? (
              <Empty>No stock is at risk of going dead.</Empty>
            ) : (
              <Table
                head={['Product', '>Stock', '>Days since last sale', '>Capital locked', '>Risk']}
                caption="Stock that is not selling"
              >
                {d.rows.map((r) => (
                  <tr key={r.productId}>
                    <td className="td font-medium">
                      <Link className="hover:underline" href={`/inventory/${r.productId}`}>
                        {r.name}
                      </Link>
                      <span className="ml-2 text-xs text-muted">{r.sku}</span>
                    </td>
                    <td className="td text-right tabular-nums">{r.currentStock}</td>
                    <td className="td text-right tabular-nums">{r.daysSinceLastSale}</td>
                    <td className="td text-right tabular-nums">
                      {formatMoney(r.capitalLockedMinor)}
                    </td>
                    <td className="td text-right tabular-nums">{r.riskScore}</td>
                  </tr>
                ))}
              </Table>
            )
          }
        </Section>

        <Section title="Sales in the next 30 days" result={sales}>
          {(d) =>
            d.rows.length === 0 ? (
              <Empty>No sales to forecast from yet.</Empty>
            ) : (
              <Table
                head={[
                  'Product',
                  '>Stock',
                  '>Sold, last 30 days',
                  '>Expected, next 30 days',
                  '>Expected revenue',
                  '>Stock after 30 days',
                ]}
                caption="Expected sales for the next 30 days"
              >
                {d.rows.map((r) => (
                  <tr key={r.productId}>
                    <td className="td font-medium">
                      <Link className="hover:underline" href={`/inventory/${r.productId}`}>
                        {r.name}
                      </Link>
                      <span className="ml-2 text-xs text-muted">{r.sku}</span>
                    </td>
                    <td className="td text-right tabular-nums">{r.currentStock}</td>
                    <td className="td text-right tabular-nums">{r.unitsSold30}</td>
                    <td className="td text-right tabular-nums">{r.predictedUnits30}</td>
                    <td className="td text-right tabular-nums">
                      {formatMoney(r.predictedRevenueMinor)}
                    </td>
                    <td
                      className={`td text-right tabular-nums ${r.predictedEndStock <= 0 ? 'text-bad' : ''}`}
                    >
                      {r.predictedEndStock}
                    </td>
                  </tr>
                ))}
              </Table>
            )
          }
        </Section>

        <Section title="Purchase suggestions" result={suggestions}>
          {(d) =>
            d.suppliers.length === 0 ? (
              <Empty>No purchases are suggested right now.</Empty>
            ) : (
              <div className="space-y-4">
                {d.suppliers.map((s) => (
                  <div key={s.supplierId ?? 'none'} className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold">
                        {s.supplierId ? s.supplierName : `${s.supplierName} (no supplier set)`}
                        <span className="ml-2 font-normal text-muted tabular-nums">
                          {formatMoney(s.totalMinor)}
                        </span>
                      </h3>
                      <Link className="btn no-print" href="/purchases/new">
                        Create purchase order
                      </Link>
                    </div>
                    <Table
                      head={['Product', '>Stock', '>Suggested qty', '>Unit cost', '>Line total']}
                      caption={`Suggested purchases from ${s.supplierName}`}
                    >
                      {s.lines.map((l) => (
                        <tr key={l.productId}>
                          <td className="td font-medium">
                            <Link className="hover:underline" href={`/inventory/${l.productId}`}>
                              {l.name}
                            </Link>
                          </td>
                          <td className="td text-right tabular-nums">{l.currentStock}</td>
                          <td className="td text-right tabular-nums">{l.suggestedQty}</td>
                          <td className="td text-right tabular-nums">
                            {formatMoney(l.unitCostMinor)}
                          </td>
                          <td className="td text-right tabular-nums">
                            {formatMoney(l.lineTotalMinor)}
                          </td>
                        </tr>
                      ))}
                      <tr className="font-semibold">
                        <td className="td" colSpan={4}>
                          Total
                        </td>
                        <td className="td text-right tabular-nums">{formatMoney(s.totalMinor)}</td>
                      </tr>
                    </Table>
                  </div>
                ))}
              </div>
            )
          }
        </Section>
      </div>
    </>
  );
}

/** One forecast block: heading, the API's own note about how it was worked out, then the rows. */
function Section<T extends { note: string; asOf: string }>({
  title,
  result,
  children,
}: {
  title: string;
  result: { ok: true; data: T } | { ok: false; message: string };
  children: (data: T) => React.ReactNode;
}) {
  return (
    <section aria-label={title}>
      <h2 className="text-sm font-semibold">{title}</h2>
      {result.ok ? (
        <>
          <p className="mt-0.5 mb-2 text-xs text-muted">
            {result.data.note} As of {formatDate(result.data.asOf)}.
          </p>
          {children(result.data)}
        </>
      ) : (
        <div className="mt-2">
          <Notice tone="bad">{result.message}</Notice>
        </div>
      )}
    </section>
  );
}
