'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Field, Modal, useMutation } from '@/components/form';
import { Notice } from '@/components/ui';
import type { StockAudit } from '@/lib/types';

export function StartAudit({
  products,
}: {
  products: { id: string; name: string; sku: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [notes, setNotes] = useState('');
  const m = useMutation();
  const shown = products.filter((p) =>
    `${p.name} ${p.sku}`.toLowerCase().includes(filter.toLowerCase()),
  );

  function toggle(id: string) {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  }

  return (
    <>
      <button className="btn btn-primary" onClick={() => setOpen(true)}>
        Start a count
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Start a stock count" wide>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await m.run<StockAudit>(
              'POST',
              '/stock-audits',
              { productIds: [...picked], ...(notes.trim() ? { notes: notes.trim() } : {}) },
              { refresh: false },
            );
            if (r.ok && r.data) router.push(`/stock-audits/${r.data.id}`);
          }}
        >
          <Field label="Which products will be counted?">
            <input
              className="input"
              placeholder="Filter the list"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </Field>
          <div className="flex items-center justify-between text-sm">
            <span>{picked.size} selected</span>
            <span className="flex gap-3">
              <button
                type="button"
                className="text-brand hover:underline"
                onClick={() => setPicked(new Set([...picked, ...shown.map((p) => p.id)]))}
              >
                Select shown
              </button>
              <button
                type="button"
                className="text-muted hover:underline"
                onClick={() => setPicked(new Set())}
              >
                Clear
              </button>
            </span>
          </div>
          <ul className="max-h-64 divide-y divide-line overflow-y-auto rounded-md border border-line">
            {shown.map((p) => (
              <li key={p.id}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-surface">
                  <input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} />
                  <span className="flex-1">{p.name}</span>
                  <span className="text-xs text-muted">{p.sku}</span>
                </label>
              </li>
            ))}
          </ul>
          <Field label="Notes">
            <input
              className="input"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={500}
            />
          </Field>
          {m.error ? <Notice tone="bad">{m.error}</Notice> : null}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={m.busy || picked.size === 0}>
              Start count
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
