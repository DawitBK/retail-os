import { notFound } from 'next/navigation';
import { Badge, PageHeader, Stat, Table, statusTone } from '@/components/ui';
import { ActionButton } from '@/components/form';
import { formatDate, formatMoney, label } from '@/lib/format';
import { MANAGERS, WATCHERS, can } from '@/lib/roles';
import { api, apiOrNull } from '@/lib/server-api';
import type { Page, Purchase, PurchaseReturn, Supplier, User } from '@/lib/types';
import { PayPurchase, ReceivePurchase, ReturnToSupplier } from './purchase-actions';

export const metadata = { title: 'Purchase order' };

export default async function PurchasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await api<User>('/me');
  const p = await apiOrNull<Purchase>(`/purchases/${id}`);
  if (!p) notFound();
  const supplier = await apiOrNull<Supplier>(`/suppliers/${p.supplierId}`);
  const returns = can(me.role, WATCHERS)
    ? await apiOrNull<Page<PurchaseReturn>>(`/purchase-returns?purchaseId=${id}`)
    : null;
  const manager = can(me.role, MANAGERS);
  const hasReceived = p.items.some((i) => i.receivedQty > 0);
  const open = p.status === 'ORDERED' || p.status === 'PARTIALLY_RECEIVED';

  return (
    <>
      <PageHeader
        title={`Order ${p.number}`}
        subtitle={`${supplier?.name ?? 'Supplier'} · ordered ${formatDate(p.orderDate)}${p.expectedDate ? ` · expected ${formatDate(p.expectedDate)}` : ''}`}
        actions={
          <>
            <Badge tone={statusTone(p.status)}>{label(p.status)}</Badge>
            <Badge tone={statusTone(p.paymentStatus)}>{label(p.paymentStatus)}</Badge>
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Ordered" value={formatMoney(p.totalMinor)} />
        <Stat label="Received" value={formatMoney(p.receivedValueMinor)} />
        <Stat label="Paid" value={formatMoney(p.paidMinor)} />
        <Stat
          label="We owe"
          value={formatMoney(p.payableMinor)}
          tone={p.payableMinor > 0 ? 'bad' : undefined}
        />
      </div>

      <div className="mt-5">
        <Table head={['Product', '>Ordered', '>Received', '>Unit cost', '>Line total']}>
          {p.items.map((i) => (
            <tr key={i.id}>
              <td className="td">{i.productName}</td>
              <td className="td text-right tabular-nums">{i.orderedQty}</td>
              <td className="td text-right tabular-nums">{i.receivedQty}</td>
              <td className="td text-right tabular-nums">{formatMoney(i.unitCostMinor)}</td>
              <td className="td text-right tabular-nums">
                {formatMoney(i.unitCostMinor * i.orderedQty)}
              </td>
            </tr>
          ))}
        </Table>
      </div>
      {p.notes ? <p className="mt-3 text-sm text-muted">{p.notes}</p> : null}

      <div className="no-print mt-5 flex flex-wrap gap-2">
        {manager && open ? <ReceivePurchase purchase={p} /> : null}
        {p.payableMinor > 0 ? <PayPurchase purchase={p} /> : null}
        {manager && hasReceived && p.status !== 'CANCELLED' ? (
          <ReturnToSupplier purchase={p} />
        ) : null}
        {manager && p.status === 'ORDERED' ? (
          <ActionButton
            label="Cancel order"
            path={`/purchases/${p.id}/cancel`}
            danger
            confirm="Cancel this order? Nothing has been received yet."
          />
        ) : null}
      </div>

      {returns && returns.items.length > 0 ? (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold">Returns to the supplier</h2>
          <Table
            head={['Number', 'Date', 'Reason', '>Credit', '>Set against debt', '>Paid back']}
            caption="Returns to the supplier on this order"
          >
            {returns.items.map((r) => (
              <tr key={r.id}>
                <td className="td font-medium">{r.number}</td>
                <td className="td whitespace-nowrap">{formatDate(r.createdAt)}</td>
                <td className="td">{r.reason}</td>
                <td className="td text-right tabular-nums">{formatMoney(r.valueMinor)}</td>
                <td className="td text-right tabular-nums">{formatMoney(r.creditAppliedMinor)}</td>
                <td className="td text-right tabular-nums">{formatMoney(r.refundMinor)}</td>
              </tr>
            ))}
          </Table>
        </section>
      ) : null}
    </>
  );
}
