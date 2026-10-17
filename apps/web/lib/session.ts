/**
 * The browser never holds a token it can read: both tokens live in httpOnly cookies that only the
 * web server touches, and every API call goes through the server (pages) or the /bff route (client
 * components).
 */
export const ACCESS_COOKIE = 'ros_access';
export const REFRESH_COOKIE = 'ros_refresh';

export const API_URL = process.env.API_URL ?? 'http://127.0.0.1:3000';

/** Refresh tokens are rotated by the API; the cookie only has to outlive the API's own limit. */
const REFRESH_MAX_AGE_SECONDS = 60 * 60 * 24 * 14;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge,
  };
}

export function accessCookie(tokens: TokenPair) {
  // Expire the cookie a little early so the proxy refreshes before the API starts answering 401.
  return {
    name: ACCESS_COOKIE,
    value: tokens.accessToken,
    ...cookieOptions(Math.max(tokens.expiresIn - 15, 1)),
  };
}

export function refreshCookie(tokens: TokenPair) {
  return {
    name: REFRESH_COOKIE,
    value: tokens.refreshToken,
    ...cookieOptions(REFRESH_MAX_AGE_SECONDS),
  };
}
