import { notFound } from 'next/navigation';
import { ActionButton } from '@/components/form';
import { Badge, PageHeader, Stat, statusTone } from '@/components/ui';
import { label } from '@/lib/format';
import { MANAGERS, can } from '@/lib/roles';
import { api, apiOrNull } from '@/lib/server-api';
import type { StockAudit, User } from '@/lib/types';
import { CountSheet } from './count-sheet';

export const metadata = { title: 'Stock count' };

export default async function AuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await api<User>('/me');
  const audit = await apiOrNull<StockAudit>(`/stock-audits/${id}`);
  if (!audit) notFound();
  const manager = can(me.role, MANAGERS);

  return (
    <>
      <PageHeader
        title={`Count ${audit.number}`}
        subtitle={audit.notes ?? undefined}
        actions={<Badge tone={statusTone(audit.status)}>{label(audit.status)}</Badge>}
      />
      <div className="mb-4 grid grid-cols-2 gap-3">
        <Stat
          label="Units short"
          value={audit.shortageUnits}
          tone={audit.shortageUnits > 0 ? 'bad' : undefined}
        />
        <Stat label="Units over" value={audit.overageUnits} />
      </div>
      <CountSheet audit={audit} canSubmit={can(me.role, ['owner', 'manager', 'cashier'])} />
      {manager && audit.status === 'PENDING_APPROVAL' ? (
        <div className="no-print mt-4 flex gap-2">
          <ActionButton
            primary
            label="Approve and adjust stock"
            path={`/stock-audits/${audit.id}/approve`}
            confirm="Post these differences to the stock records and the books?"
          />
          <ActionButton
            danger
            label="Cancel count"
            path={`/stock-audits/${audit.id}/cancel`}
            confirm="Cancel this count? Nothing will be adjusted."
          />
        </div>
      ) : null}
      {manager && audit.status === 'IN_PROGRESS' ? (
        <div className="no-print mt-4">
          <ActionButton
            danger
            label="Cancel count"
            path={`/stock-audits/${audit.id}/cancel`}
            confirm="Cancel this count?"
          />
        </div>
      ) : null}
    </>
  );
}
