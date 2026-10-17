'use client';

import { useState } from 'react';
import { Field, Modal, ReasonButton, useMutation } from '@/components/form';
import { Notice } from '@/components/ui';
import { newIdempotencyKey } from '@/lib/client-api';
import { formatMoney, label, parseMoney } from '@/lib/format';
import { MANAGERS, FLOOR, can } from '@/lib/roles';
import type { Role, Sale, SettlementMethod } from '@/lib/types';

const SETTLEMENT: SettlementMethod[] = ['CASH', 'MOBILE_MONEY', 'BANK_TRANSFER'];

export function SaleActions({ sale, role }: { sale: Sale; role: Role }) {
  const completed = sale.status === 'COMPLETED';
  return (
    <div className="no-print flex flex-wrap gap-2">
      <button className="btn" onClick={() => window.print()}>
        Print receipt
      </button>
      {completed && sale.outstandingMinor > 0 && can(role, FLOOR) ? (
        <TakePayment sale={sale} />
      ) : null}
      {completed && can(role, MANAGERS) ? <ReturnGoods sale={sale} /> : null}
      {completed && can(role, MANAGERS) ? (
        <ReasonButton
          label="Void sale"
          title={`Void ${sale.number}`}
          path={`/sales/${sale.id}/void`}
          danger
          confirmLabel="Void sale"
        />
      ) : null}
    </div>
  );
}

function TakePayment({ sale }: { sale: Sale }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<SettlementMethod>('CASH');
  const m = useMutation();
  const minor = parseMoney(amount);
  return (
    <>
      <button className="btn btn-primary" onClick={() => setOpen(true)}>
        Take payment
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Payment on ${sale.number}`}>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (minor === null || minor <= 0) return;
            const r = await m.run(
              'POST',
              `/sales/${sale.id}/payments`,
              { amountMinor: minor, method },
              {
                headers: { 'idempotency-key': newIdempotencyKey() },
              },
            );
            if (r.ok) setOpen(false);
          }}
        >
          <p className="text-sm text-muted">Still owed: {formatMoney(sale.outstandingMinor)}</p>
          <Field label="Amount" error={m.fieldErrors['amountMinor']}>
            <input
              className="input"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </Field>
          <Field label="Method">
            <select
              className="input"
              value={method}
              onChange={(e) => setMethod(e.target.value as SettlementMethod)}
            >
              {SETTLEMENT.map((s) => (
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

function ReturnGoods({ sale }: { sale: Sale }) {
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [restock, setRestock] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState('');
  const [method, setMethod] = useState<SettlementMethod>('CASH');
  const m = useMutation();
  const lines = sale.items
    .map((i) => ({
      saleItemId: i.id,
      quantity: qty[i.id] ?? 0,
      restockable: restock[i.id] ?? true,
    }))
    .filter((l) => l.quantity > 0);
  return (
    <>
      <button className="btn" onClick={() => setOpen(true)}>
        Return goods
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Return from ${sale.number}`} wide>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await m.run('POST', `/sales/${sale.id}/returns`, {
              reason: reason.trim(),
              refundMethod: method,
              items: lines,
            });
            if (r.ok) setOpen(false);
          }}
        >
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="py-1">Product</th>
                <th className="py-1">Sold</th>
                <th className="py-1">Return</th>
                <th className="py-1">Fit to resell</th>
              </tr>
            </thead>
            <tbody>
              {sale.items.map((i) => (
                <tr key={i.id}>
                  <td className="py-1 pr-2">{i.productName}</td>
                  <td className="py-1 tabular-nums">{i.quantity}</td>
                  <td className="py-1">
                    <input
                      className="input w-20"
                      type="number"
                      min={0}
                      max={i.quantity}
                      value={qty[i.id] ?? 0}
                      aria-label={`Quantity to return of ${i.productName}`}
                      onChange={(e) =>
                        setQty({
                          ...qty,
                          [i.id]: Math.max(0, Math.min(i.quantity, Number(e.target.value) || 0)),
                        })
                      }
                    />
                  </td>
                  <td className="py-1">
                    <input
                      type="checkbox"
                      checked={restock[i.id] ?? true}
                      aria-label={`${i.productName} can be sold again`}
                      onChange={(e) => setRestock({ ...restock, [i.id]: e.target.checked })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Reason" error={m.fieldErrors['reason']}>
              <input
                className="input"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                required
                minLength={3}
              />
            </Field>
            <Field
              label="Refund paid out as"
              hint="Only used for the part that is not set against a debt"
            >
              <select
                className="input"
                value={method}
                onChange={(e) => setMethod(e.target.value as SettlementMethod)}
              >
                {SETTLEMENT.map((s) => (
                  <option key={s} value={s}>
                    {label(s)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {m.error ? <Notice tone="bad">{m.error}</Notice> : null}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              disabled={m.busy || lines.length === 0 || reason.trim().length < 3}
            >
              Record return
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
