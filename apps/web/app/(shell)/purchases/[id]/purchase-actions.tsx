'use client';

import { useState } from 'react';
import { Field, Modal, useMutation } from '@/components/form';
import { Notice } from '@/components/ui';
import { newIdempotencyKey } from '@/lib/client-api';
import { formatMoney, label, parseMoney, toInput } from '@/lib/format';
import type { Purchase, SettlementMethod } from '@/lib/types';

export function ReceivePurchase({ purchase }: { purchase: Purchase }) {
  const [open, setOpen] = useState(false);
  const outstanding = purchase.items
    .map((i) => ({ ...i, left: i.orderedQty - i.receivedQty }))
    .filter((i) => i.left > 0);
  const [qty, setQty] = useState<Record<string, number>>({});
  const m = useMutation();
  const lines = outstanding
    .map((i) => ({ itemId: i.id, quantity: qty[i.id] ?? i.left }))
    .filter((l) => l.quantity > 0);

  return (
    <>
      <button className="btn btn-primary" onClick={() => setOpen(true)}>
        Receive goods
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Receive against ${purchase.number}`}
      >
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await m.run('POST', `/purchases/${purchase.id}/receive`, { items: lines });
            if (r.ok) setOpen(false);
          }}
        >
          <p className="text-sm text-muted">
            Stock goes up and the amount owed to the supplier is recorded for what arrives now.
          </p>
          <ul className="space-y-2">
            {outstanding.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3 text-sm">
                <span>
                  {i.productName} <span className="text-muted">(waiting for {i.left})</span>
                </span>
                <input
                  className="input w-24"
                  type="number"
                  min={0}
                  max={i.left}
                  aria-label={`Quantity received of ${i.productName}`}
                  value={qty[i.id] ?? i.left}
                  onChange={(e) =>
                    setQty({
                      ...qty,
                      [i.id]: Math.max(0, Math.min(i.left, Number(e.target.value) || 0)),
                    })
                  }
                />
              </li>
            ))}
          </ul>
          {m.error ? <Notice tone="bad">{m.error}</Notice> : null}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={m.busy || lines.length === 0}>
              Confirm receipt
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function PayPurchase({ purchase }: { purchase: Purchase }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(toInput(purchase.payableMinor));
  const [method, setMethod] = useState<SettlementMethod>('BANK_TRANSFER');
  const m = useMutation();
  const minor = parseMoney(amount);
  return (
    <>
      <button className="btn" onClick={() => setOpen(true)}>
        Pay supplier
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Pay for ${purchase.number}`}>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (minor === null || minor <= 0) return;
            const r = await m.run(
              'POST',
              `/purchases/${purchase.id}/payments`,
              { amountMinor: minor, method },
              {
                headers: { 'idempotency-key': newIdempotencyKey() },
              },
            );
            if (r.ok) setOpen(false);
          }}
        >
          <p className="text-sm text-muted">Owed now: {formatMoney(purchase.payableMinor)}</p>
          <Field label="Amount" error={m.fieldErrors['amountMinor']}>
            <input
              className="input"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </Field>
          <Field label="Paid by">
            <select
              className="input"
              value={method}
              onChange={(e) => setMethod(e.target.value as SettlementMethod)}
            >
              {(['CASH', 'MOBILE_MONEY', 'BANK_TRANSFER'] as const).map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
            </select>
          </Field>
          {m.error ? <Notice tone="bad">{m.error}</Notice> : null}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={m.busy || minor === null || minor <= 0}>
              Record payment
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
