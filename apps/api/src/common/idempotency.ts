import { createHash } from 'node:crypto';
import { conflict, unprocessable } from '@retail/kit';
import { and, eq } from 'drizzle-orm';
import type { Database, Tx } from '../db/db.module.js';
import { idempotencyKeys } from '../db/schema.js';

export interface Outcome<T> {
  status: number;
  body: T;
  replayed: boolean;
}

/**
 * Run `work` in one transaction. With an `Idempotency-Key` the first call stores its response in
 * the same transaction, and a repeat of the same key (same request) returns that stored response
 * instead of doing the work again. A concurrent duplicate blocks on the key insert until the first
 * transaction commits, then replays. The same key with a different request is rejected (422).
 */
export async function runIdempotent<T>(
  db: Database,
  userId: string,
  key: string | undefined,
  request: unknown,
  work: (tx: Tx) => Promise<{ status: number; body: T }>,
): Promise<Outcome<T>> {
  return db.transaction(async (tx) => {
    if (!key) return { ...(await work(tx)), replayed: false };
    const requestHash = createHash('sha256').update(JSON.stringify(request)).digest('hex');
    const claimed = await tx
      .insert(idempotencyKeys)
      .values({ userId, key, requestHash })
      .onConflictDoNothing()
      .returning({ key: idempotencyKeys.key });
    if (claimed.length === 0) {
      const [stored] = await tx
        .select()
        .from(idempotencyKeys)
        .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key)));
      if (!stored || stored.responseBody === null || stored.responseStatus === null) {
        throw conflict('idempotency-in-progress', 'Request still in progress');
      }
      if (stored.requestHash !== requestHash) {
        throw unprocessable(
          'idempotency-key-reuse',
          'Idempotency key reused',
          'This key was already used with a different request',
        );
      }
      return { status: stored.responseStatus, body: stored.responseBody as T, replayed: true };
    }
    const result = await work(tx);
    await tx
      .update(idempotencyKeys)
      .set({ responseStatus: result.status, responseBody: result.body })
      .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key)));
    return { ...result, replayed: false };
  });
}
