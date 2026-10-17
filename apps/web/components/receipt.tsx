import { formatDateTime, formatMoney, label } from '@/lib/format';
import type { Sale } from '@/lib/types';

/** A printable till slip. Used by the till right after a sale and by the sale page for reprints. */
export function Receipt({ sale, customerName }: { sale: Sale; customerName?: string | null }) {
  return (
    <article
      aria-label={`Receipt ${sale.number}`}
      className="mx-auto w-full max-w-xs bg-white p-4 font-mono text-xs"
    >
      <header className="mb-3 text-center">
        <div className="text-base font-semibold">Retail OS</div>
        <div>{sale.number}</div>
        <div>{formatDateTime(sale.saleDate)}</div>
        {customerName ? <div>Customer: {customerName}</div> : null}
        {sale.status === 'VOIDED' ? <div className="mt-1 font-bold uppercase">Voided</div> : null}
      </header>
      <table className="w-full">
        <tbody>
          {sale.items.map((i) => (
            <tr key={i.id} className="align-top">
              <td className="py-0.5 pr-2">
                {i.productName}
                <div className="text-muted">
                  {i.quantity} × {formatMoney(i.unitPriceMinor)}
                  {i.discountMinor > 0 ? ` − ${formatMoney(i.discountMinor)}` : ''}
                </div>
              </td>
              <td className="py-0.5 text-right tabular-nums">{formatMoney(i.lineTotalMinor)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="mt-3 space-y-0.5 border-t border-dashed border-ink pt-2">
        <Row k="Subtotal" v={formatMoney(sale.subtotalMinor)} />
        {sale.discountMinor > 0 ? (
          <Row k="Discount" v={`− ${formatMoney(sale.discountMinor)}`} />
        ) : null}
        <Row k="Total" v={formatMoney(sale.totalMinor)} strong />
        <Row k={`Paid (${label(sale.paymentMethod)})`} v={formatMoney(sale.amountPaidMinor)} />
        {sale.changeGivenMinor > 0 ? (
          <Row k="Change" v={formatMoney(sale.changeGivenMinor)} />
        ) : null}
        {sale.outstandingMinor > 0 ? (
          <Row k="Still owed" v={formatMoney(sale.outstandingMinor)} strong />
        ) : null}
      </dl>
      <footer className="mt-3 text-center">Thank you</footer>
    </article>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? 'text-sm font-bold' : ''}`}>
      <dt>{k}</dt>
      <dd className="tabular-nums">{v}</dd>
    </div>
  );
}
