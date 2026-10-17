import { getRequestId } from '@retail/kit';
import type { Tx } from '../db/db.module.js';
import { auditLog } from '../db/schema.js';

export interface AuditEntry {
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
}

/** Write an audit row. Call it with the transaction that makes the change, never outside it. */
export async function recordAudit(tx: Tx, entry: AuditEntry): Promise<void> {
  await tx.insert(auditLog).values({
    ...entry,
    before: entry.before ?? null,
    after: entry.after ?? null,
    requestId: getRequestId() ?? null,
  });
}
