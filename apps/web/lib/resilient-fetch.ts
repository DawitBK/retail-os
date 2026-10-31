/**
 * fetch for the web part's calls to its own API. The web part runs on Vercel and reaches the API through a tunnel, and a tunnel can
 * drop a connection for a moment (the log line is "ECONNRESET: socket disconnected before secure TLS connection was established").
 * A read that fails that way (the connection broke, or the gateway said 502, 503 or 504) is safe to ask again, up to two more times
 * with a growing pause; a write is never repeated, because an earlier try may have reached the API. All the tries share one time
 * budget that fits inside a Vercel function's limit, so a stuck link ends in a clear failure instead of a function that is killed.
 */
const RETRY_STATUSES = new Set([502, 503, 504]);
const READS = new Set(['GET', 'HEAD']);

export const BUDGET_MS = 9_000;
export const TRY_TIMEOUT_MS = 8_000;
export const RETRY_DELAYS_MS = [300, 900];

export interface RetryOptions {
  delaysMs?: number[];
  budgetMs?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  { delaysMs = RETRY_DELAYS_MS, budgetMs = BUDGET_MS }: RetryOptions = {},
): Promise<Response> {
  const attempts = READS.has((init.method ?? 'GET').toUpperCase()) ? delaysMs.length + 1 : 1;
  const started = Date.now();
  const left = () => budgetMs - (Date.now() - started);
  // Another try only if one is allowed for this kind of request and the budget can still cover the pause and a real attempt.
  const canTryAgain = (i: number) => i < attempts - 1 && left() >= (delaysMs[i] ?? 0) + 1_000;

  for (let i = 0; ; i += 1) {
    try {
      const res = await fetch(url, {
        ...init,
        signal:
          init.signal ?? AbortSignal.timeout(Math.max(1_000, Math.min(TRY_TIMEOUT_MS, left()))),
      });
      if (!RETRY_STATUSES.has(res.status) || !canTryAgain(i)) return res;
      await res.body?.cancel().catch(() => undefined);
    } catch (e) {
      if (!canTryAgain(i)) throw e;
    }
    await sleep(delaysMs[i] ?? 0);
  }
}
