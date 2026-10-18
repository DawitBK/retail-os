import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { forwardedFor } from '@/lib/client-ip';
import { API_URL, accessCookie, refreshCookie, type TokenPair } from '@/lib/session';
import { SSO_COOKIE, appOrigin } from '@/lib/sso';

export const dynamic = 'force-dynamic';

const same = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** The provider sends the browser back here with a code: trade it (through the API) for a session. */
export async function GET(request: NextRequest) {
  const origin = appOrigin(request);
  const fail = (reason: string) => {
    const response = NextResponse.redirect(new URL(`/login?error=${reason}`, origin));
    response.cookies.delete({ name: SSO_COOKIE, path: '/login/sso' });
    return response;
  };

  const raw = request.cookies.get(SSO_COOKIE)?.value;
  const params = request.nextUrl.searchParams;
  const code = params.get('code');
  const state = params.get('state');
  if (!raw || !code || !state) return fail('sso');
  let flow: { state: string; nonce: string; verifier: string; next: string };
  try {
    flow = JSON.parse(raw);
  } catch {
    return fail('sso');
  }
  if (!same(flow.state, state)) return fail('sso');

  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/v1/auth/oidc/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...forwardedFor(request.headers) },
      body: JSON.stringify({
        code,
        codeVerifier: flow.verifier,
        nonce: flow.nonce,
        redirectUri: `${origin}/login/sso/callback`,
      }),
      cache: 'no-store',
    });
  } catch {
    return fail('unreachable');
  }
  if (res.status === 401) return fail('no-account');
  if (!res.ok) return fail('sso');

  const tokens = (await res.json()) as TokenPair;
  const response = NextResponse.redirect(new URL(flow.next || '/', origin));
  response.cookies.set(accessCookie(tokens));
  response.cookies.set(refreshCookie(tokens));
  response.cookies.delete({ name: SSO_COOKIE, path: '/login/sso' });
  return response;
}
