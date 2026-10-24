import 'server-only';
import { API_URL } from './session';

export interface SsoConfig {
  enabled: boolean;
  authorizationEndpoint?: string;
  /** Where the provider ends the person's single sign-on session ("sign in as someone else"). */
  endSessionEndpoint?: string;
  clientId?: string;
}

/**
 * What the API said about single sign-on.
 * - enabled: the API answered 200 and said it is on (with the provider's addresses).
 * - disabled: the API answered 200 and said it is off. This is the ONLY way to get "disabled".
 * - unavailable: we could not find out (timeout, network error, 5xx, any other answer). A slow or broken
 *   connection is not a configuration state, so callers must never treat this as "off".
 */
export type SsoConfigResult =
  { status: 'enabled'; config: SsoConfig } | { status: 'disabled' } | { status: 'unavailable' };

export interface SsoConfigOptions {
  /** Total tries while the answer is "unavailable" (default 3). A definite answer is never retried. */
  attempts?: number;
  /** For tests: replaces the global fetch. */
  fetchImpl?: typeof fetch;
  /** For tests: replaces the wait between tries. */
  sleep?: (ms: number) => Promise<void>;
}

/** Each try gets this long; the wait before the next try is 300 ms, then 900 ms. */
const ATTEMPT_TIMEOUT_MS = 8000;
const BACKOFF_MS = [300, 900];
const DEFAULT_ATTEMPTS = 3;

const UNAVAILABLE: SsoConfigResult = { status: 'unavailable' };

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** One try. Only a 200 answer with a boolean `enabled` is definite; everything else is "unavailable". */
async function attempt(fetchImpl: typeof fetch): Promise<SsoConfigResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${API_URL}/api/v1/auth/oidc/config`, {
      cache: 'no-store',
      signal: controller.signal,
    });
    if (res.status !== 200) return UNAVAILABLE;
    const body: unknown = await res.json();
    if (typeof body !== 'object' || body === null) return UNAVAILABLE;
    const enabled = (body as { enabled?: unknown }).enabled;
    if (enabled === false) return { status: 'disabled' };
    if (enabled === true) return { status: 'enabled', config: body as SsoConfig };
    return UNAVAILABLE;
  } catch {
    return UNAVAILABLE;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Whether the API offers single sign-on, and where the provider's sign-in page is. Never throws.
 * The API is reached through a tunnel that can stall for a moment, so an "unavailable" answer is tried
 * again (up to 3 tries in all); a definite answer, on or off, is returned at once.
 */
export async function ssoConfig(options: SsoConfigOptions = {}): Promise<SsoConfigResult> {
  const attempts = Math.max(1, Math.floor(options.attempts ?? DEFAULT_ATTEMPTS));
  const sleep = options.sleep ?? wait;
  const fetchImpl = options.fetchImpl ?? fetch;
  let result = UNAVAILABLE;
  for (let i = 0; i < attempts; i += 1) {
    result = await attempt(fetchImpl);
    if (result.status !== 'unavailable' || i === attempts - 1) break;
    await sleep(BACKOFF_MS[Math.min(i, BACKOFF_MS.length - 1)] ?? 0);
  }
  return result;
}

/** The address visitors use for this web app (Vercel puts it in the request; APP_ORIGIN overrides it). */
export function appOrigin(request: Request): string {
  return (process.env.APP_ORIGIN ?? new URL(request.url).origin).replace(/\/+$/, '');
}

export const SSO_COOKIE = 'sso_flow';
