import { notFound } from 'next/navigation';
import { Receipt } from '@/components/receipt';
import { Badge, PageHeader, Table, statusTone } from '@/components/ui';
import { formatMoney, label } from '@/lib/format';
import { MANAGERS, FLOOR, can } from '@/lib/roles';
import { api, apiOrNull } from '@/lib/server-api';
import type { Customer, Page, Sale, User } from '@/lib/types';
import { SaleActions } from './sale-actions';

export const metadata = { title: 'Sale' };

interface SaleReturn {
  id: string;
  number: string;
  reason: string;
  refundMinor: number;
  createdAt: string;
}

export default async function SalePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await api<User>('/me');
  const sale = await apiOrNull<Sale>(`/sales/${id}`);
  if (!sale) notFound();
  const customer = sale.customerId
    ? await apiOrNull<Customer>(`/customers/${sale.customerId}`)
    : null;
  const returns = can(me.role, ['owner', 'manager', 'accountant'])
    ? await apiOrNull<Page<SaleReturn>>(`/returns?saleId=${id}`)
    : null;

  return (
    <>
      <PageHeader
        title={`Sale ${sale.number}`}
        subtitle={customer ? `Customer: ${customer.name}` : 'Walk-in customer'}
        actions={<Badge tone={statusTone(sale.status)}>{label(sale.status)}</Badge>}
      />
      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-5">
          <Table head={['Product', '>Qty', '>Unit', '>Discount', '>Line total']}>
            {sale.items.map((i) => (
              <tr key={i.id}>
                <td className="td">{i.productName}</td>
                <td className="td text-right tabular-nums">{i.quantity}</td>
                <td className="td text-right tabular-nums">{formatMoney(i.unitPriceMinor)}</td>
                <td className="td text-right tabular-nums">{formatMoney(i.discountMinor)}</td>
                <td className="td text-right tabular-nums">{formatMoney(i.lineTotalMinor)}</td>
              </tr>
            ))}
          </Table>

          {can(me.role, MANAGERS) || can(me.role, FLOOR) ? (
            <div className="card grid grid-cols-2 gap-3 p-4 text-sm sm:grid-cols-4">
              <Fact k="Total" v={formatMoney(sale.totalMinor)} />
              <Fact k="Paid" v={formatMoney(sale.amountPaidMinor)} />
              <Fact k="Owed" v={formatMoney(sale.outstandingMinor)} />
              {can(me.role, ['owner', 'manager', 'accountant']) ? (
                <Fact k="Gross profit" v={formatMoney(sale.grossProfitMinor)} />
              ) : null}
            </div>
          ) : null}

          {sale.status === 'VOIDED' ? (
            <p className="text-sm text-bad">Voided: {sale.voidReason}</p>
          ) : null}

          <SaleActions sale={sale} role={me.role} />

          {returns && returns.items.length > 0 ? (
            <section>
              <h2 className="mb-2 text-sm font-semibold">Returns</h2>
              <Table head={['Number', 'Reason', '>Refunded']}>
                {returns.items.map((r) => (
                  <tr key={r.id}>
                    <td className="td font-medium">{r.number}</td>
                    <td className="td">{r.reason}</td>
                    <td className="td text-right tabular-nums">{formatMoney(r.refundMinor)}</td>
                  </tr>
                ))}
              </Table>
            </section>
          ) : null}
        </div>
        <div className="card self-start">
          <Receipt sale={sale} customerName={customer?.name} />
        </div>
      </div>
    </>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="text-xs text-muted">{k}</div>
      <div className="font-semibold tabular-nums">{v}</div>
    </div>
  );
}
