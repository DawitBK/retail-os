import Link from 'next/link';
import { Badge, Empty, PageHeader, Pager, Table, num } from '@/components/ui';
import { formatMoney } from '@/lib/format';
import { MANAGERS, can } from '@/lib/roles';
import { api, qs } from '@/lib/server-api';
import type { Brand, Category, Page, Product, User } from '@/lib/types';
import { NewProduct } from './product-form';

export const metadata = { title: 'Products' };

type Search = {
  q?: string;
  categoryId?: string;
  lowStock?: string;
  negativeMargin?: string;
  status?: string;
  offset?: string;
};

export default async function ProductsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const me = await api<User>('/me');
  const [data, categories, brands] = await Promise.all([
    api<Page<Product>>(
      `/products${qs({
        q: sp.q,
        categoryId: sp.categoryId,
        lowStock: sp.lowStock,
        negativeMargin: sp.negativeMargin,
        status: sp.status,
        offset: num(sp.offset),
        limit: 25,
      })}`,
    ),
    api<Page<Category>>('/categories?limit=100'),
    api<Page<Brand>>('/brands?limit=100'),
  ]);
  const manager = can(me.role, MANAGERS);
  const showCost = can(me.role, ['owner', 'manager', 'accountant']);
  const head = ['Product', 'SKU', '>Price', ...(showCost ? ['>Avg cost'] : []), '>Stock', 'Flags'];

  return (
    <>
      <PageHeader
        title="Products"
        subtitle={`${data.page.total} products`}
        actions={
          manager ? (
            <>
              <Link className="btn" href="/products/setup">
                Categories and brands
              </Link>
              <NewProduct categories={categories.items} brands={brands.items} />
            </>
          ) : null
        }
      />
      <form className="no-print mb-4 flex flex-wrap items-end gap-2" method="get">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted">Search</span>
          <input
            className="input"
            name="q"
            defaultValue={sp.q}
            placeholder="Name, SKU or barcode"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted">Category</span>
          <select className="input" name="categoryId" defaultValue={sp.categoryId ?? ''}>
            <option value="">All</option>
            {categories.items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            name="lowStock"
            value="true"
            defaultChecked={sp.lowStock === 'true'}
          />{' '}
          Low stock
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            name="negativeMargin"
            value="true"
            defaultChecked={sp.negativeMargin === 'true'}
          />{' '}
          Below cost
        </label>
        <button className="btn btn-primary">Filter</button>
      </form>

      {data.items.length === 0 ? (
        <Empty>No products match.</Empty>
      ) : (
        <Table head={head}>
          {data.items.map((p) => (
            <tr key={p.id} className="hover:bg-surface">
              <td className="td font-medium">
                <Link className="hover:underline" href={`/products/${p.id}`}>
                  {p.name}
                </Link>
              </td>
              <td className="td text-muted">{p.sku}</td>
              <td className="td text-right tabular-nums">{formatMoney(p.sellingPriceMinor)}</td>
              {showCost ? (
                <td className="td text-right tabular-nums">{formatMoney(p.wacMinor)}</td>
              ) : null}
              <td className="td text-right tabular-nums">{p.currentStock}</td>
              <td className="td space-x-1">
                {p.currentStock === 0 ? (
                  <Badge tone="bad">Out</Badge>
                ) : p.currentStock <= p.reorderPoint ? (
                  <Badge tone="warn">Low</Badge>
                ) : null}
                {p.negativeMargin ? <Badge tone="bad">Below cost</Badge> : null}
                {p.status === 'DISCONTINUED' ? <Badge>Discontinued</Badge> : null}
              </td>
            </tr>
          ))}
        </Table>
      )}
      <Pager
        page={data.page}
        path="/products"
        params={{
          q: sp.q,
          categoryId: sp.categoryId,
          lowStock: sp.lowStock,
          negativeMargin: sp.negativeMargin,
          status: sp.status,
        }}
      />
    </>
  );
}
