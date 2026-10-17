'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Field, useMutation } from '@/components/form';
import { Notice } from '@/components/ui';
import { formatMoney, parseMoney, toInput } from '@/lib/format';
import type { Purchase } from '@/lib/types';

interface Option {
  id: string;
  name: string;
  sku?: string;
  wacMinor?: number | null;
}
interface Line {
  productId: string;
  qty: string;
  cost: string;
}

export function PurchaseForm({ suppliers, products }: { suppliers: Option[]; products: Option[] }) {
  const router = useRouter();
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? '');
  const [expected, setExpected] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([{ productId: '', qty: '1', cost: '' }]);
  const m = useMutation();

  const parsed = lines.map((l) => ({
    productId: l.productId,
    orderedQty: Number(l.qty),
    unitCostMinor: parseMoney(l.cost),
  }));
  const valid =
    supplierId !== '' &&
    parsed.length > 0 &&
    parsed.every(
      (l) =>
        l.productId &&
        Number.isInteger(l.orderedQty) &&
        l.orderedQty > 0 &&
        l.unitCostMinor !== null,
    );
  const total = parsed.reduce(
    (s, l) => s + (l.unitCostMinor ?? 0) * (Number.isInteger(l.orderedQty) ? l.orderedQty : 0),
    0,
  );

  function setLine(i: number, patch: Partial<Line>) {
    setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!valid) return;
        const r = await m.run<Purchase>(
          'POST',
          '/purchases',
          {
            supplierId,
            ...(expected ? { expectedDate: expected } : {}),
            ...(notes.trim() ? { notes: notes.trim() } : {}),
            items: parsed,
          },
          { refresh: false },
        );
        if (r.ok && r.data) router.push(`/purchases/${r.data.id}`);
      }}
    >
      <div className="card grid gap-3 p-4 sm:grid-cols-3">
        <Field label="Supplier" error={m.fieldErrors['supplierId']}>
          <select
            className="input"
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            required
          >
            {suppliers.length === 0 ? <option value="">Add a supplier first</option> : null}
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Expected on">
          <input
            className="input"
            type="date"
            value={expected}
            onChange={(e) => setExpected(e.target.value)}
          />
        </Field>
        <Field label="Notes">
          <input
            className="input"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={500}
          />
        </Field>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-max">
          <thead className="border-b border-line">
            <tr>
              <th className="th">Product</th>
              <th className="th">Quantity</th>
              <th className="th">Unit cost</th>
              <th className="th text-right">Line total</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {lines.map((l, i) => {
              const cost = parseMoney(l.cost);
              const qty = Number(l.qty);
              const product = products.find((p) => p.id === l.productId);
              return (
                <tr key={i}>
                  <td className="td">
                    <select
                      className="input min-w-56"
                      aria-label={`Product, line ${i + 1}`}
                      value={l.productId}
                      onChange={(e) => {
                        const p = products.find((x) => x.id === e.target.value);
                        setLine(i, {
                          productId: e.target.value,
                          cost: l.cost || (p?.wacMinor ? toInput(p.wacMinor) : ''),
                        });
                      }}
                    >
                      <option value="">Choose…</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.sku})
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="td">
                    <input
                      className="input w-24"
                      type="number"
                      min={1}
                      aria-label={`Quantity, line ${i + 1}`}
                      value={l.qty}
                      onChange={(e) => setLine(i, { qty: e.target.value })}
                    />
                  </td>
                  <td className="td">
                    <input
                      className="input w-28"
                      inputMode="decimal"
                      aria-label={`Unit cost, line ${i + 1}`}
                      value={l.cost}
                      placeholder={product?.wacMinor ? toInput(product.wacMinor) : '0.00'}
                      onChange={(e) => setLine(i, { cost: e.target.value })}
                    />
                  </td>
                  <td className="td text-right tabular-nums">
                    {cost !== null && Number.isInteger(qty) ? formatMoney(cost * qty) : '–'}
                  </td>
                  <td className="td text-right">
                    {lines.length > 1 ? (
                      <button
                        type="button"
                        className="text-xs text-muted hover:text-bad"
                        onClick={() => setLines(lines.filter((_, j) => j !== i))}
                      >
                        Remove
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="flex items-center justify-between border-t border-line px-3 py-2">
          <button
            type="button"
            className="btn"
            onClick={() => setLines([...lines, { productId: '', qty: '1', cost: '' }])}
          >
            Add line
          </button>
          <div className="text-sm">
            Order total{' '}
            <span className="ml-2 text-lg font-semibold tabular-nums">{formatMoney(total)}</span>
          </div>
        </div>
      </div>

      {m.error ? <Notice tone="bad">{m.error}</Notice> : null}
      <div className="flex justify-end">
        <button className="btn btn-primary" disabled={!valid || m.busy}>
          Place order
        </button>
      </div>
    </form>
  );
}
