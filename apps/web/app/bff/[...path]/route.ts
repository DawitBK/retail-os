import { NextResponse, type NextRequest } from 'next/server';
import { forwardedFor } from '@/lib/client-ip';
import { ACCESS_COOKIE, API_URL } from '@/lib/session';

/**
 * The only door from the browser to the API. It adds the bearer token from the httpOnly cookie, so
 * the token never reaches page JavaScript, and it forwards just the headers the API cares about.
 */
async function forward(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const token = request.cookies.get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ title: 'Signed out', status: 401 }, { status: 401 });

  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    ...forwardedFor(request.headers),
  };
  const contentType = request.headers.get('content-type');
  if (contentType) headers['content-type'] = contentType;
  const idem = request.headers.get('idempotency-key');
  if (idem) headers['idempotency-key'] = idem;

  const hasBody = request.method !== 'GET' && request.method !== 'DELETE';
  const upstream = await fetch(`${API_URL}/api/v1/${path.join('/')}${request.nextUrl.search}`, {
    method: request.method,
    headers,
    body: hasBody ? await request.text() : undefined,
    cache: 'no-store',
  });

  const body = upstream.status === 204 ? null : await upstream.text();
  return new NextResponse(body, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
  });
}

export { forward as GET, forward as POST, forward as PATCH, forward as DELETE };
