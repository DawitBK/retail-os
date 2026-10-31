import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { MANAGERS, can } from '@/lib/roles';
import { allPages, api } from '@/lib/server-api';
import type { Page, Product, Supplier, User } from '@/lib/types';
import { PurchaseForm } from './purchase-form';

export const metadata = { title: 'New purchase order' };

/** `?supplierId=...&lines=productId:qty:unitCostMinor,...` fills the form, as the purchase suggestions do. */
function startingLines(raw: string | undefined) {
  return (raw ?? '')
    .split(',')
    .map((part) => part.split(':'))
    .flatMap(([productId, qty, cost]) =>
      productId && /^\d+$/.test(qty ?? '')
        ? [{ productId, qty: qty!, costMinor: Number(cost) || 0 }]
        : [],
    )
    .slice(0, 200);
}

export default async function NewPurchasePage({
  searchParams,
}: {
  searchParams: Promise<{ supplierId?: string; lines?: string }>;
}) {
  const sp = await searchParams;
  const me = await api<User>('/me');
  if (!can(me.role, MANAGERS)) redirect('/purchases');
  const [suppliers, products] = await Promise.all([
    api<Page<Supplier>>('/suppliers?limit=100'),
    allPages<Product>('/products?status=ACTIVE&sort=name'),
  ]);
  return (
    <>
      <PageHeader
        title="New purchase order"
        subtitle="Stock and the amount owed arrive when the goods are received."
      />
      <PurchaseForm
        suppliers={suppliers.items.map((s) => ({ id: s.id, name: s.name }))}
        products={products.map((p) => ({
          id: p.id,
          name: p.name,
          sku: p.sku,
          wacMinor: p.wacMinor,
        }))}
        initialSupplierId={sp.supplierId}
        initialLines={startingLines(sp.lines)}
      />
    </>
  );
}
