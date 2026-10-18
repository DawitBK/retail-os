import { SignJWT } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthConfig } from '../common/auth.js';
import { OidcService } from './oidc.service.js';

const ISSUER = 'https://idp.example.com/sso';
const config: AuthConfig = {
  jwtSecret: 'x'.repeat(32),
  accessTtlSeconds: 900,
  refreshTtlSeconds: 3600,
  oidc: { issuer: ISSUER, clientId: 'shop', clientSecret: 'secret' },
};
const input = {
  code: 'abc',
  codeVerifier: 'v'.repeat(50),
  nonce: 'nonce-12345',
  redirectUri: 'https://shop.example.com/login/sso/callback',
};

async function idToken(overrides: Record<string, unknown> = {}) {
  return new SignJWT({ nonce: input.nonce, ...overrides })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience('shop')
    .setSubject('user-1')
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode('k'.repeat(32)));
}

/** A tiny identity provider: discovery, token endpoint and userinfo. */
function provider(opts: { token?: string; info?: Record<string, unknown>; tokenStatus?: number }) {
  return vi.fn(async (url: string | URL) => {
    const u = String(url);
    if (u.endsWith('/.well-known/openid-configuration')) {
      return Response.json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/authorize`,
        token_endpoint: `${ISSUER}/token`,
        userinfo_endpoint: `${ISSUER}/me`,
      });
    }
    if (u.endsWith('/token')) {
      return opts.tokenStatus && opts.tokenStatus !== 200
        ? new Response('no', { status: opts.tokenStatus })
        : Response.json({ id_token: opts.token, access_token: 'at' });
    }
    return Response.json(
      opts.info ?? { sub: 'user-1', email: 'Owner@Shop.com', email_verified: true },
    );
  });
}

const auth = { loginWithVerifiedEmail: vi.fn(async (email: string) => ({ email }) as never) };
const service = () => new OidcService(config, auth as never);

afterEach(() => {
  vi.unstubAllGlobals();
  auth.loginWithVerifiedEmail.mockClear();
});

describe('OidcService', () => {
  it('reports itself disabled when no provider is configured', async () => {
    const off = new OidcService({ ...config, oidc: undefined }, auth as never);
    expect(await off.publicConfig()).toEqual({ enabled: false });
    await expect(off.exchange(input)).rejects.toThrow();
  });

  it('advertises the provider authorization endpoint', async () => {
    vi.stubGlobal('fetch', provider({}));
    expect(await service().publicConfig()).toEqual({
      enabled: true,
      authorizationEndpoint: `${ISSUER}/authorize`,
      clientId: 'shop',
    });
  });

  it('signs in the account whose verified email the provider returns (lower-cased)', async () => {
    vi.stubGlobal('fetch', provider({ token: await idToken() }));
    await service().exchange(input);
    expect(auth.loginWithVerifiedEmail).toHaveBeenCalledWith('owner@shop.com');
  });

  it('refuses a wrong nonce, a wrong audience and an unverified email', async () => {
    vi.stubGlobal('fetch', provider({ token: await idToken({ nonce: 'other-nonce-1' }) }));
    await expect(service().exchange(input)).rejects.toThrow();
    vi.stubGlobal(
      'fetch',
      provider({
        token: await new SignJWT({ nonce: input.nonce })
          .setProtectedHeader({ alg: 'HS256' })
          .setIssuer(ISSUER)
          .setAudience('someone-else')
          .setSubject('user-1')
          .setExpirationTime('5m')
          .sign(new TextEncoder().encode('k'.repeat(32))),
      }),
    );
    await expect(service().exchange(input)).rejects.toThrow();
    vi.stubGlobal(
      'fetch',
      provider({
        token: await idToken(),
        info: { sub: 'user-1', email: 'owner@shop.com', email_verified: false },
      }),
    );
    await expect(service().exchange(input)).rejects.toThrow();
    expect(auth.loginWithVerifiedEmail).not.toHaveBeenCalled();
  });

  it('refuses when the provider rejects the code or the profile belongs to another subject', async () => {
    vi.stubGlobal('fetch', provider({ tokenStatus: 400 }));
    await expect(service().exchange(input)).rejects.toThrow();
    vi.stubGlobal(
      'fetch',
      provider({
        token: await idToken(),
        info: { sub: 'someone-else', email: 'owner@shop.com', email_verified: true },
      }),
    );
    await expect(service().exchange(input)).rejects.toThrow();
  });
});
