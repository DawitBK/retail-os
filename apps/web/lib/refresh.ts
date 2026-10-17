import { API_URL, type TokenPair } from './session';

/**
 * The API rotates refresh tokens and treats the reuse of an old one as theft, revoking the whole
 * family. A page that issues several requests at once (prefetches, parallel server components)
 * would present the same old token more than once, so concurrent and just-finished refreshes of
 * the same token share one result.
 */
const inflight = new Map<string, { at: number; result: Promise<TokenPair | null> }>();
const REUSE_WINDOW_MS = 30_000;

export function refreshTokens(refreshToken: string): Promise<TokenPair | null> {
  const now = Date.now();
  for (const [key, entry] of inflight) {
    if (now - entry.at > REUSE_WINDOW_MS) inflight.delete(key);
  }
  const existing = inflight.get(refreshToken);
  if (existing) return existing.result;

  const result = fetch(`${API_URL}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
    cache: 'no-store',
  })
    .then(async (res) => (res.ok ? ((await res.json()) as TokenPair) : null))
    .catch(() => null);
  inflight.set(refreshToken, { at: now, result });
  return result;
}
