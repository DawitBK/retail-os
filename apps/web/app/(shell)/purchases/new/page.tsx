import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { MANAGERS, can } from '@/lib/roles';
import { api } from '@/lib/server-api';
import type { Page, Product, Supplier, User } from '@/lib/types';
import { PurchaseForm } from './purchase-form';

export const metadata = { title: 'New purchase order' };

export default async function NewPurchasePage() {
  const me = await api<User>('/me');
  if (!can(me.role, MANAGERS)) redirect('/purchases');
  const [suppliers, products] = await Promise.all([
    api<Page<Supplier>>('/suppliers?limit=100'),
    api<Page<Product>>('/products?limit=100&status=ACTIVE&sort=name'),
  ]);
  return (
    <>
      <PageHeader
        title="New purchase order"
        subtitle="Stock and the amount owed arrive when the goods are received."
      />
      <PurchaseForm
        suppliers={suppliers.items.map((s) => ({ id: s.id, name: s.name }))}
        products={products.items.map((p) => ({
          id: p.id,
          name: p.name,
          sku: p.sku,
          wacMinor: p.wacMinor,
        }))}
      />
    </>
  );
}
