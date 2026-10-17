import 'server-only';
import { cookies, headers } from 'next/headers';
import { forwardedFor } from './client-ip';
import { redirect } from 'next/navigation';
import { ACCESS_COOKIE, API_URL } from './session';

export interface Problem {
  title?: string;
  detail?: string;
  status?: number;
  errors?: { path?: string; message?: string }[];
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem: Problem,
  ) {
    super(problem.detail ?? problem.title ?? `Request failed (${status})`);
  }
}

/** Server-side call to the Retail OS API as the signed-in person. */
export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect('/login');
  const res = await fetch(`${API_URL}/api/v1${path}`, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      ...forwardedFor(await headers()),
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: 'no-store',
  });
  if (res.status === 401) redirect('/login');
  if (!res.ok) {
    const problem = (await res.json().catch(() => ({}))) as Problem;
    throw new ApiError(res.status, problem);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** Like api(), but a 403 or 404 becomes null so a page can say "not allowed" instead of crashing. */
export async function apiOrNull<T>(path: string): Promise<T | null> {
  try {
    return await api<T>(path);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 403 || e.status === 404)) return null;
    throw e;
  }
}

export function qs(params: Record<string, string | number | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}
