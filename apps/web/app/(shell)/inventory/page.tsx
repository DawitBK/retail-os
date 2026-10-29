import Link from 'next/link';
import {
  Badge,
  Empty,
  NoAccess,
  Notice,
  PageHeader,
  Pager,
  Table,
  movementTone,
  num,
} from '@/components/ui';
import { formatDays, formatRate, pickOne } from '@/lib/analytics';
import { formatDate, formatMoney, label, pct } from '@/lib/format';
import { WATCHERS, can } from '@/lib/roles';
import { api, apiSafe, qs } from '@/lib/server-api';
import type { Brand, Category, Movement, Page, ProductHealth, StockFlag, User } from '@/lib/types';

export const metadata = { title: 'Inventory' };

const MOVEMENTS = ['FAST', 'NORMAL', 'SLOW', 'DEAD'] as const satisfies readonly Movement[];
const FLAGS = [
  'OUT_OF_STOCK',
  'LOW_STOCK',
  'NEGATIVE_MARGIN',
] as const satisfies readonly StockFlag[];

type Search = {
  q?: string;
  movement?: string;
  flag?: string;
  categoryId?: string;
  brandId?: string;
  offset?: string;
};

const HEAD = [
  'SKU',
  'Product',
  'Category',
  'Brand',
  '>Stock',
  '>Reorder at',
  '>Avg cost',
  '>Price',
  '>Margin',
  '>Stock value',
  '>Sold per day',
  '>Days of stock',
  'Status',
  'Last sold',
];

export default async function InventoryPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const me = await api<User>('/me');
  if (!can(me.role, WATCHERS)) {
    return (
      <>
        <PageHeader title="Inventory" />
        <NoAccess what="inventory health" />
      </>
    );
  }
  const movement = pickOne(sp.movement, MOVEMENTS);
  const flag = pickOne(sp.flag, FLAGS);
  const q = sp.q?.trim() || undefined;
  const categoryId = sp.categoryId || undefined;
  const brandId = sp.brandId || undefined;

  const [data, categories, brands] = await Promise.all([
    apiSafe<Page<ProductHealth>>(
      `/analytics/products${qs({ search: q, movement, flag, categoryId, brandId, offset: num(sp.offset), limit: 25 })}`,
    ),
    apiSafe<Page<Category>>('/categories?limit=100'),
    apiSafe<Page<Brand>>('/brands?limit=100'),
  ]);

  return (
    <>
      <PageHeader
        title="Inventory"
        subtitle={
          data.ok
            ? `${data.data.page.total} products, with how fast each one sells and how long its stock will last`
            : 'Stock health'
        }
      />
      <form className="no-print mb-4 flex flex-wrap items-end gap-2" method="get">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted">Search</span>
          <input className="input" name="q" defaultValue={q} placeholder="Name, SKU or barcode" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted">Movement</span>
          <select className="input" name="movement" defaultValue={movement ?? ''}>
            <option value="">All</option>
            {MOVEMENTS.map((m) => (
              <option key={m} value={m}>
                {label(m)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted">Flag</span>
          <select className="input" name="flag" defaultValue={flag ?? ''}>
            <option value="">None</option>
            {FLAGS.map((f) => (
              <option key={f} value={f}>
                {label(f)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted">Category</span>
          <select className="input" name="categoryId" defaultValue={categoryId ?? ''}>
            <option value="">All</option>
            {categories.ok
              ? categories.data.items.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))
              : null}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted">Brand</span>
          <select className="input" name="brandId" defaultValue={brandId ?? ''}>
            <option value="">All</option>
            {brands.ok
              ? brands.data.items.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))
              : null}
          </select>
        </label>
        <button className="btn btn-primary">Filter</button>
      </form>

      {!data.ok ? (
        <Notice tone="bad">{data.message}</Notice>
      ) : data.data.items.length === 0 ? (
        <Empty>No products match.</Empty>
      ) : (
        <Table head={HEAD} caption="Stock health of every product">
          {data.data.items.map((p) => (
            <tr key={p.id} className="hover:bg-surface">
              <td className="td text-muted">{p.sku}</td>
              <td className="td font-medium">
                <Link className="hover:underline" href={`/inventory/${p.id}`}>
                  {p.name}
                </Link>
              </td>
              <td className="td">{p.category}</td>
              <td className="td">{p.brand ?? '–'}</td>
              <td className="td text-right tabular-nums">{p.currentStock}</td>
              <td className="td text-right tabular-nums">{p.reorderPoint}</td>
              <td className="td text-right tabular-nums">{formatMoney(p.averageCostMinor)}</td>
              <td className="td text-right tabular-nums">{formatMoney(p.sellingPriceMinor)}</td>
              <td
                className={`td text-right tabular-nums ${p.marginPct !== null && p.marginPct < 0 ? 'text-bad' : ''}`}
              >
                {pct(p.marginPct)}
              </td>
              <td className="td text-right tabular-nums">{formatMoney(p.stockValueMinor)}</td>
              <td className="td text-right tabular-nums">{formatRate(p.velocityPerDay)}</td>
              <td className="td text-right tabular-nums">{formatDays(p.daysOfStock)}</td>
              <td className="td space-x-1 whitespace-nowrap">
                <Badge tone={movementTone(p.movement)}>{label(p.movement)}</Badge>
                {p.outOfStock ? <Badge>Out of stock</Badge> : null}
                {p.lowStock && !p.outOfStock ? <Badge tone="orange">Low stock</Badge> : null}
                {p.negativeMargin ? <Badge tone="bad">Negative margin</Badge> : null}
              </td>
              <td className="td whitespace-nowrap">{formatDate(p.lastSoldAt)}</td>
            </tr>
          ))}
        </Table>
      )}
      {data.ok ? (
        <Pager
          page={data.data.page}
          path="/inventory"
          params={{ q, movement, flag, categoryId, brandId }}
        />
      ) : null}
    </>
  );
}
