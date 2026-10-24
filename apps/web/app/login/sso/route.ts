import { createHash, randomBytes } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { SSO_COOKIE, appOrigin, ssoConfig } from '@/lib/sso';

export const dynamic = 'force-dynamic';

const b64 = (b: Buffer) => b.toString('base64url');

/** Start single sign-on: remember a one-time state, nonce and PKCE verifier, then send the browser to the provider. */
export async function GET(request: NextRequest) {
  const origin = appOrigin(request);
  const result = await ssoConfig();
  if (result.status === 'unavailable') {
    // Could not find out (slow or broken connection): say so, do not claim single sign-on is off.
    return NextResponse.redirect(new URL('/login?error=sso-unavailable', origin));
  }
  const config = result.status === 'enabled' ? result.config : undefined;
  if (!config?.authorizationEndpoint || !config.clientId) {
    return NextResponse.redirect(new URL('/login?error=sso-off', origin));
  }
  const state = b64(randomBytes(18));
  const nonce = b64(randomBytes(18));
  const verifier = b64(randomBytes(40));
  const next = request.nextUrl.searchParams.get('next');

  const url = new URL(config.authorizationEndpoint);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    scope: 'openid email profile',
    redirect_uri: `${origin}/login/sso/callback`,
    state,
    nonce,
    code_challenge: b64(createHash('sha256').update(verifier).digest()),
    code_challenge_method: 'S256',
  }).toString();

  const response = NextResponse.redirect(url);
  response.cookies.set(
    SSO_COOKIE,
    JSON.stringify({
      state,
      nonce,
      verifier,
      next: next?.startsWith('/') && !next.startsWith('//') ? next : '/',
    }),
    {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/login/sso',
      maxAge: 600,
    },
  );
  return response;
}
