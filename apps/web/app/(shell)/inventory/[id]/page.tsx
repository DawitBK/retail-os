import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BarChart, CostPriceBar } from '@/components/charts';
import { NoAccess, Notice, PageHeader, Pager, Stat, Table, num } from '@/components/ui';
import { formatDays, formatRate, formatRatio } from '@/lib/analytics';
import { formatDate, formatDateTime, formatMoney, label, pct } from '@/lib/format';
import { WATCHERS, can } from '@/lib/roles';
import { api, apiOrNull, apiSafe } from '@/lib/server-api';
import type { Page, Product, ProductAnalytics, StockMovement, User } from '@/lib/types';

export const metadata = { title: 'Product analytics' };

export default async function ProductAnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ offset?: string }>;
}) {
  const { id } = await params;
  const offset = num((await searchParams).offset);
  const me = await api<User>('/me');
  if (!can(me.role, WATCHERS)) {
    return (
      <>
        <PageHeader title="Product analytics" />
        <NoAccess what="product analytics" />
      </>
    );
  }
  const [analytics, product, movements] = await Promise.all([
    apiOrNull<ProductAnalytics>(`/analytics/products/${id}`),
    apiOrNull<Product>(`/products/${id}`),
    apiSafe<Page<StockMovement>>(`/products/${id}/movements?limit=20&offset=${offset}`),
  ]);
  if (!analytics) notFound();

  const sold = analytics.last30Days.reduce((s, d) => s + d.units, 0);

  return (
    <>
      <PageHeader
        title={analytics.name}
        subtitle={product ? `${product.sku} · ${product.currentStock} in stock` : undefined}
        actions={
          <>
            <Link className="btn" href="/inventory">
              All inventory
            </Link>
            <Link className="btn" href={`/products/${id}`}>
              Product record
            </Link>
          </>
        }
      />

      <section aria-label="Key figures" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Sold per day"
          value={formatRate(analytics.velocityPerDay)}
          hint={`${analytics.unitsSold30} units in 30 days`}
        />
        <Stat
          label="Days of stock"
          value={formatDays(analytics.daysOfStock)}
          hint={analytics.daysOfStock === null ? 'Nothing sold in 30 days' : 'At the current pace'}
        />
        <Stat
          label="Margin"
          value={pct(analytics.marginPct)}
          tone={analytics.marginPct !== null && analytics.marginPct < 0 ? 'bad' : undefined}
          hint="Price against average cost"
        />
        <Stat
          label="Capital locked"
          value={formatMoney(analytics.capitalLockedMinor)}
          hint="Stock at cost"
        />
        <Stat
          label="Days inventory outstanding"
          value={formatDays(analytics.daysInventoryOutstanding)}
        />
        <Stat
          label="GMROI"
          value={formatRatio(analytics.gmroi)}
          hint="Yearly gross profit per birr of stock"
        />
        <Stat label="Stock coverage" value={formatDays(analytics.stockCoverageDays)} hint="Days" />
        <Stat
          label="Last sold"
          value={formatDate(product?.lastSoldAt)}
          hint={product?.lastRestockedAt ? `Restocked ${formatDate(product.lastRestockedAt)}` : ''}
        />
      </section>

      <section aria-label="Units sold, last 30 days" className="card mt-5 p-4">
        <h2 className="mb-3 text-sm font-semibold">Units sold, last 30 days ({sold} in total)</h2>
        <BarChart
          data={analytics.last30Days.map((d) => ({ label: d.date, value: d.units }))}
          ariaLabel={`Units of ${analytics.name} sold each day for the last 30 days, ${sold} in total`}
        />
      </section>

      {product ? (
        <section aria-label="Cost and price" className="card mt-5 p-4">
          <h2 className="mb-3 text-sm font-semibold">Average cost and price</h2>
          <CostPriceBar
            costMinor={product.wacMinor ?? 0}
            priceMinor={product.sellingPriceMinor}
            format={formatMoney}
          />
        </section>
      ) : null}

      <section aria-label="Stock movements" className="mt-6">
        <h2 className="mb-2 text-sm font-semibold">Last stock movements</h2>
        {!movements.ok ? (
          <Notice tone="bad">{movements.message}</Notice>
        ) : (
          <>
            <Table
              head={['When', 'Movement', '>Qty', '>Value', '>Stock after']}
              caption={`Stock movements of ${analytics.name}`}
            >
              {movements.data.items.map((mv) => (
                <tr key={mv.id}>
                  <td className="td">{formatDateTime(mv.createdAt)}</td>
                  <td className="td">{label(mv.movementType)}</td>
                  <td className={`td text-right tabular-nums ${mv.quantity < 0 ? 'text-bad' : ''}`}>
                    {mv.quantity > 0 ? `+${mv.quantity}` : mv.quantity}
                  </td>
                  <td className="td text-right tabular-nums">{formatMoney(mv.valueDeltaMinor)}</td>
                  <td className="td text-right tabular-nums">{mv.stockAfter}</td>
                </tr>
              ))}
              {movements.data.items.length === 0 ? (
                <tr>
                  <td className="td text-muted" colSpan={5}>
                    No movements yet.
                  </td>
                </tr>
              ) : null}
            </Table>
            <Pager page={movements.data.page} path={`/inventory/${id}`} params={{}} />
          </>
        )}
      </section>
    </>
  );
}
