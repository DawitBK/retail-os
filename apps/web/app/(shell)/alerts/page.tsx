import Link from 'next/link';
import { Badge, Empty, PageHeader, statusTone } from '@/components/ui';
import { formatMoney } from '@/lib/format';
import { api } from '@/lib/server-api';
import type { Alert } from '@/lib/types';

export const metadata = { title: 'Alerts' };

export default async function AlertsPage() {
  const { alerts, counts } = await api<{
    alerts: Alert[];
    counts: { critical: number; warning: number; info: number };
  }>('/alerts');
  return (
    <>
      <PageHeader
        title="Alerts"
        subtitle={`${counts.critical} critical · ${counts.warning} warnings · ${counts.info} for information`}
      />
      {alerts.length === 0 ? (
        <Empty>Nothing needs attention.</Empty>
      ) : (
        <ul className="space-y-2">
          {alerts.map((a, i) => (
            <li
              key={`${a.type}-${a.productId ?? i}`}
              className="card flex items-start justify-between gap-3 p-4"
            >
              <div>
                <div className="flex items-center gap-2">
                  <Badge tone={statusTone(a.severity)}>{a.severity.toLowerCase()}</Badge>
                  <span className="text-sm font-medium">{a.title}</span>
                </div>
                <p className="mt-1 text-sm text-muted">{a.message}</p>
              </div>
              <div className="text-right text-sm">
                {a.valueMinor !== null ? (
                  <div className="tabular-nums text-muted">{formatMoney(a.valueMinor)} tied up</div>
                ) : null}
                {a.productId ? (
                  <Link
                    className="text-brand hover:underline"
                    href={
                      a.type === 'DAMAGE_PENDING_APPROVAL'
                        ? '/damage?status=PENDING'
                        : `/products/${a.productId}`
                    }
                  >
                    {a.type === 'DAMAGE_PENDING_APPROVAL' ? 'Review' : 'Open product'}
                  </Link>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
