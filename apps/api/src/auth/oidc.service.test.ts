import { exportJWK, generateKeyPair, SignJWT } from 'jose';
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

const signing = await generateKeyPair('RS256');

/** The provider's back-channel logout token: signed with the key it publishes. */
async function logoutToken(
  overrides: {
    claims?: Record<string, unknown>;
    header?: Record<string, unknown>;
    audience?: string;
    issuer?: string;
    issuedAt?: number;
  } = {},
) {
  const jwt = new SignJWT({
    events: { 'http://schemas.openid.net/event/backchannel-logout': {} },
    ...overrides.claims,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1', typ: 'logout+jwt', ...overrides.header })
    .setIssuer(overrides.issuer ?? ISSUER)
    .setAudience(overrides.audience ?? 'shop')
    .setSubject('user-1')
    .setIssuedAt(overrides.issuedAt ?? Math.floor(Date.now() / 1000))
    .setJti('jti-1')
    .setExpirationTime('2m');
  return jwt.sign(signing.privateKey);
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
        jwks_uri: `${ISSUER}/jwks`,
        end_session_endpoint: `${ISSUER}/session/end`,
      });
    }
    if (u.endsWith('/jwks'))
      return Response.json({
        keys: [{ ...(await exportJWK(signing.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }],
      });
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

const auth = {
  loginWithVerifiedEmail: vi.fn(async (email: string) => ({ email }) as never),
  revokeSessionsBySsoSubject: vi.fn(async () => 1),
};
const service = () => new OidcService(config, auth as never);

afterEach(() => {
  vi.unstubAllGlobals();
  auth.loginWithVerifiedEmail.mockClear();
  auth.revokeSessionsBySsoSubject.mockClear();
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
      endSessionEndpoint: `${ISSUER}/session/end`,
      clientId: 'shop',
    });
  });

  it('signs in the account whose verified email the provider returns (lower-cased)', async () => {
    vi.stubGlobal('fetch', provider({ token: await idToken() }));
    await service().exchange(input);
    expect(auth.loginWithVerifiedEmail).toHaveBeenCalledWith('owner@shop.com', 'user-1');
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

describe('back-channel logout', () => {
  it('ends the sessions of the person named by a valid logout token', async () => {
    vi.stubGlobal('fetch', provider({}));
    await service().handleBackchannelLogout(await logoutToken());
    expect(auth.revokeSessionsBySsoSubject).toHaveBeenCalledWith('user-1');
  });

  it.each([
    ['a token for another client', () => logoutToken({ audience: 'someone-else' })],
    ['a token from another issuer', () => logoutToken({ issuer: 'https://evil.example.com' })],
    ['an ordinary token type', () => logoutToken({ header: { typ: 'JWT' } })],
    ['a token without the logout event', () => logoutToken({ claims: { events: {} } })],
    [
      'a token that carries a nonce (an ID token in disguise)',
      () => logoutToken({ claims: { nonce: 'n' } }),
    ],
    ['a stale token', () => logoutToken({ issuedAt: Math.floor(Date.now() / 1000) - 3600 })],
    ['text that is not a token', async () => 'not-a-token-at-all-not-a-token'],
  ])('refuses %s (400) and ends nothing', async (_label, make) => {
    vi.stubGlobal('fetch', provider({}));
    await expect(service().handleBackchannelLogout(await make())).rejects.toMatchObject({
      status: 400,
    });
    expect(auth.revokeSessionsBySsoSubject).not.toHaveBeenCalled();
  });

  it('refuses a token signed with a key the provider does not publish', async () => {
    vi.stubGlobal('fetch', provider({}));
    const other = await generateKeyPair('RS256');
    const forged = await new SignJWT({
      events: { 'http://schemas.openid.net/event/backchannel-logout': {} },
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1', typ: 'logout+jwt' })
      .setIssuer(ISSUER)
      .setAudience('shop')
      .setSubject('user-1')
      .setIssuedAt()
      .setExpirationTime('2m')
      .sign(other.privateKey);
    await expect(service().handleBackchannelLogout(forged)).rejects.toMatchObject({ status: 400 });
    expect(auth.revokeSessionsBySsoSubject).not.toHaveBeenCalled();
  });

  it('answers 401 when single sign-on is not configured', async () => {
    const off = new OidcService({ ...config, oidc: undefined }, auth as never);
    await expect(off.handleBackchannelLogout(await logoutToken())).rejects.toThrow();
  });
});
