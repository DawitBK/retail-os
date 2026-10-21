import { NextResponse, type NextRequest } from 'next/server';
import { appOrigin, ssoConfig } from '@/lib/sso';

export const dynamic = 'force-dynamic';

/**
 * "Sign in as someone else": ends the person's single sign-on session at the provider (it asks for one confirmation) and brings the browser back
 * to this app's sign-in page, so the next "Sign in with SSO" asks who it is instead of reusing the person who is already signed in there.
 */
export async function GET(request: NextRequest) {
  const origin = appOrigin(request);
  const config = await ssoConfig();
  if (!config.enabled || !config.endSessionEndpoint || !config.clientId) {
    return NextResponse.redirect(new URL('/login', origin));
  }
  const url = new URL(config.endSessionEndpoint);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    post_logout_redirect_uri: `${origin}/login`,
  }).toString();
  return NextResponse.redirect(url);
}
