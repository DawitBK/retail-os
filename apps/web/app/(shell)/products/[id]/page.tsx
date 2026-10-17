import { notFound } from 'next/navigation';
import { Badge, PageHeader, Pager, Stat, Table, num } from '@/components/ui';
import { formatDateTime, formatMoney, label } from '@/lib/format';
import { MANAGERS, can } from '@/lib/roles';
import { api, apiOrNull } from '@/lib/server-api';
import type { Brand, Category, Page, Product, StockMovement, User } from '@/lib/types';
import { EditProduct } from '../product-form';

export const metadata = { title: 'Product' };

export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ offset?: string }>;
}) {
  const { id } = await params;
  const offset = num((await searchParams).offset);
  const me = await api<User>('/me');
  const product = await apiOrNull<Product>(`/products/${id}`);
  if (!product) notFound();
  const history = can(me.role, ['owner', 'manager', 'accountant'])
    ? await apiOrNull<Page<StockMovement>>(`/products/${id}/movements?limit=20&offset=${offset}`)
    : null;
  const [categories, brands] = can(me.role, MANAGERS)
    ? await Promise.all([
        api<Page<Category>>('/categories?limit=100'),
        api<Page<Brand>>('/brands?limit=100'),
      ])
    : [null, null];

  return (
    <>
      <PageHeader
        title={product.name}
        subtitle={`${product.sku}${product.barcode ? ` · ${product.barcode}` : ''}`}
        actions={
          <>
            {product.status === 'DISCONTINUED' ? <Badge>Discontinued</Badge> : null}
            {categories && brands ? (
              <EditProduct product={product} categories={categories.items} brands={brands.items} />
            ) : null}
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Price" value={formatMoney(product.sellingPriceMinor)} />
        <Stat
          label="In stock"
          value={product.currentStock}
          hint={`Reorder at ${product.reorderPoint}`}
        />
        <Stat
          label="Average cost"
          value={formatMoney(product.wacMinor)}
          tone={product.negativeMargin ? 'bad' : undefined}
          hint={product.negativeMargin ? 'Selling below cost' : undefined}
        />
        <Stat label="Stock value" value={formatMoney(product.stockValueMinor)} />
      </div>
      {product.description ? (
        <p className="mt-4 max-w-prose text-sm text-muted">{product.description}</p>
      ) : null}

      {history ? (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold">Stock history</h2>
          <Table head={['When', 'Movement', '>Qty', '>Value', '>Stock after']}>
            {history.items.map((mv) => (
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
          </Table>
          <Pager page={history.page} path={`/products/${id}`} params={{}} />
        </section>
      ) : null}
    </>
  );
}
