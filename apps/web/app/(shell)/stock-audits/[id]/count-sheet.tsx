'use client';

import { useState } from 'react';
import { useMutation } from '@/components/form';
import { Notice } from '@/components/ui';
import { formatMoney } from '@/lib/format';
import type { StockAudit } from '@/lib/types';

export function CountSheet({ audit, canSubmit }: { audit: StockAudit; canSubmit: boolean }) {
  const editable = canSubmit && audit.status === 'IN_PROGRESS';
  const items = audit.items ?? [];
  const [counts, setCounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      items.map((i) => [i.productId, i.physicalQty === null ? '' : String(i.physicalQty)]),
    ),
  );
  const save = useMutation();
  const submit = useMutation();

  const entered = items.flatMap((i) => {
    const raw = counts[i.productId];
    return raw !== undefined && raw !== '' && Number.isInteger(Number(raw)) && Number(raw) >= 0
      ? [{ productId: i.productId, physicalQty: Number(raw) }]
      : [];
  });

  return (
    <div className="space-y-3">
      <div className="card overflow-x-auto">
        <table className="w-full min-w-max">
          <thead className="border-b border-line">
            <tr>
              <th className="th">Product</th>
              <th className="th text-right">On the books</th>
              <th className="th text-right">Counted</th>
              <th className="th text-right">Difference</th>
              <th className="th text-right">Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {items.map((i) => {
              const raw = counts[i.productId] ?? '';
              const local =
                raw !== '' && i.systemQty !== null ? Number(raw) - i.systemQty : i.variance;
              return (
                <tr key={i.productId}>
                  <td className="td">{i.productName}</td>
                  <td className="td text-right tabular-nums">{i.systemQty ?? '–'}</td>
                  <td className="td text-right">
                    {editable ? (
                      <input
                        className="input w-24 text-right tabular-nums"
                        type="number"
                        min={0}
                        aria-label={`Counted quantity of ${i.productName}`}
                        value={raw}
                        onChange={(e) => setCounts({ ...counts, [i.productId]: e.target.value })}
                      />
                    ) : (
                      <span className="tabular-nums">{i.physicalQty ?? '–'}</span>
                    )}
                  </td>
                  <td
                    className={`td text-right tabular-nums ${local !== null && local < 0 ? 'font-semibold text-bad' : ''}`}
                  >
                    {local === null ? '–' : local > 0 ? `+${local}` : local}
                  </td>
                  <td className="td text-right tabular-nums">
                    {i.adjustmentValueMinor !== null ? formatMoney(i.adjustmentValueMinor) : '–'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {editable ? (
        <div className="no-print space-y-2">
          {save.error ? <Notice tone="bad">{save.error}</Notice> : null}
          {submit.error ? <Notice tone="bad">{submit.error}</Notice> : null}
          <div className="flex gap-2">
            <button
              className="btn"
              disabled={save.busy || entered.length === 0}
              onClick={() =>
                save.run('POST', `/stock-audits/${audit.id}/counts`, { counts: entered })
              }
            >
              Save counts
            </button>
            <button
              className="btn btn-primary"
              disabled={submit.busy || save.busy || entered.length !== items.length}
              onClick={async () => {
                const saved = await save.run(
                  'POST',
                  `/stock-audits/${audit.id}/counts`,
                  { counts: entered },
                  { refresh: false },
                );
                if (saved.ok) await submit.run('POST', `/stock-audits/${audit.id}/submit`, {});
              }}
            >
              Submit for approval
            </button>
          </div>
          {entered.length !== items.length ? (
            <p className="text-xs text-muted">
              Every product must be counted before the count can be submitted.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
