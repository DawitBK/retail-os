'use client';

import { useState } from 'react';
import { Field, Modal, useMutation } from '@/components/form';
import { Notice } from '@/components/ui';

export function ReportDamage({
  products,
}: {
  products: { id: string; name: string; stock: number }[];
}) {
  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState('');
  const [kind, setKind] = useState<'DAMAGE' | 'WRITE_OFF'>('DAMAGE');
  const [quantity, setQuantity] = useState('1');
  const [cause, setCause] = useState('');
  const m = useMutation();
  const product = products.find((p) => p.id === productId);
  const qty = Number(quantity);
  const valid = productId && Number.isInteger(qty) && qty > 0 && cause.trim().length >= 3;

  return (
    <>
      <button className="btn btn-primary" onClick={() => setOpen(true)}>
        Report damage
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Report damaged or lost stock">
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!valid) return;
            const r = await m.run('POST', '/damage', {
              productId,
              kind,
              quantity: qty,
              cause: cause.trim(),
            });
            if (r.ok) {
              setOpen(false);
              setCause('');
              setQuantity('1');
            }
          }}
        >
          <Field label="Product" error={m.fieldErrors['productId']}>
            <select
              className="input"
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              required
            >
              <option value="">Choose…</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.stock} in stock)
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Kind">
              <select
                className="input"
                value={kind}
                onChange={(e) => setKind(e.target.value as 'DAMAGE' | 'WRITE_OFF')}
              >
                <option value="DAMAGE">Damaged</option>
                <option value="WRITE_OFF">Write-off (lost, expired)</option>
              </select>
            </Field>
            <Field
              label="Quantity"
              error={
                product && qty > product.stock
                  ? `Only ${product.stock} in stock`
                  : m.fieldErrors['quantity']
              }
            >
              <input
                className="input"
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                required
              />
            </Field>
          </div>
          <Field label="What happened" error={m.fieldErrors['cause']}>
            <textarea
              className="input min-h-20 py-2"
              value={cause}
              onChange={(e) => setCause(e.target.value)}
              required
              minLength={3}
              maxLength={500}
            />
          </Field>
          {m.error ? <Notice tone="bad">{m.error}</Notice> : null}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={m.busy || !valid}>
              Send for approval
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
