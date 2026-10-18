import { NextResponse, type NextRequest } from 'next/server';
import { forwardedFor } from './lib/client-ip';
import { refreshTokens } from './lib/refresh';
import { ACCESS_COOKIE, REFRESH_COOKIE, accessCookie, refreshCookie } from './lib/session';

const PUBLIC_PATHS = ['/login'];
const isPublic = (pathname: string) =>
  PUBLIC_PATHS.includes(pathname) || pathname.startsWith('/login/');

/**
 * Runs before every page and /bff request: keeps people without a session on the login page and
 * renews the short-lived access token from the refresh cookie, so server components always see a
 * live token.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const refresh = request.cookies.get(REFRESH_COOKIE)?.value;
  const access = request.cookies.get(ACCESS_COOKIE)?.value;
  if (access) return NextResponse.next();

  const toLogin = () => {
    if (pathname.startsWith('/bff/')) {
      return NextResponse.json({ title: 'Signed out', status: 401 }, { status: 401 });
    }
    const res = NextResponse.redirect(new URL('/login', request.url));
    res.cookies.delete(REFRESH_COOKIE);
    return res;
  };
  if (!refresh) return toLogin();

  // A prefetch must not spend the refresh token: let the real navigation do it.
  if (
    request.headers.get('next-router-prefetch') ||
    request.headers.get('purpose') === 'prefetch'
  ) {
    return NextResponse.next();
  }

  const tokens = await refreshTokens(refresh, forwardedFor(request.headers));
  if (!tokens) return toLogin();

  // Make the new token visible to this very request, and store it for the next ones.
  const headers = new Headers(request.headers);
  const cookies = request.cookies
    .getAll()
    .filter((c) => c.name !== ACCESS_COOKIE && c.name !== REFRESH_COOKIE);
  cookies.push(
    { name: ACCESS_COOKIE, value: tokens.accessToken },
    { name: REFRESH_COOKIE, value: tokens.refreshToken },
  );
  headers.set('cookie', cookies.map((c) => `${c.name}=${c.value}`).join('; '));
  const response = NextResponse.next({ request: { headers } });
  response.cookies.set(accessCookie(tokens));
  response.cookies.set(refreshCookie(tokens));
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg).*)'],
};
