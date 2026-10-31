/**
 * fetch for the web part's calls to its own API. The web part runs on Vercel and reaches the API through a tunnel, and a tunnel can
 * drop a connection for a moment. A read that fails that way (the connection broke, or the gateway said 502, 503 or 504) is safe to
 * ask again once; a write is never repeated, because the first try may have reached the API. Every try has a time limit, so a stuck
 * link ends in a clear failure instead of a page that hangs.
 */
const RETRY_STATUSES = new Set([502, 503, 504]);
const READS = new Set(['GET', 'HEAD']);

export const TRY_TIMEOUT_MS = 15_000;
export const RETRY_DELAY_MS = 400;

export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  delayMs: number = RETRY_DELAY_MS,
): Promise<Response> {
  const attempts = READS.has((init.method ?? 'GET').toUpperCase()) ? 2 : 1;
  let last: unknown;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      const res = await fetch(url, {
        ...init,
        signal: init.signal ?? AbortSignal.timeout(TRY_TIMEOUT_MS),
      });
      if (i < attempts && RETRY_STATUSES.has(res.status)) {
        await res.body?.cancel().catch(() => undefined);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      return res;
    } catch (e) {
      last = e;
      if (i < attempts) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw last;
}
