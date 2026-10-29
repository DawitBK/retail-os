'use client';

export interface CallResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  message?: string;
  fieldErrors?: Record<string, string>;
  /** The API's list of problems, in order and unmerged (a file import can report hundreds of rows). */
  errors?: { path: string; message: string }[];
}

/** Browser call to the API through the web server's /bff route; it adds the token. */
export async function call<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<CallResult<T>> {
  const res = await fetch(`/bff${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) {
    window.location.href = '/login';
    return { ok: false, status: 401, message: 'Signed out' };
  }
  const json = res.status === 204 ? undefined : await res.json().catch(() => undefined);
  if (res.ok) return { ok: true, status: res.status, data: json as T };
  const problem = (json ?? {}) as {
    title?: string;
    detail?: string;
    errors?: { path?: string; message?: string }[];
  };
  const fieldErrors: Record<string, string> = {};
  const errors: { path: string; message: string }[] = [];
  for (const e of problem.errors ?? []) {
    if (e.path && e.message) fieldErrors[e.path] = e.message;
    if (e.message) errors.push({ path: e.path ?? '', message: e.message });
  }
  return {
    ok: false,
    status: res.status,
    message: problem.detail ?? problem.title ?? `Request failed (${res.status})`,
    fieldErrors,
    errors,
  };
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
