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

const INTERNAL = 'http://sso:7300';
const internalConfig: AuthConfig = {
  ...config,
  oidc: { issuer: ISSUER, clientId: 'shop', clientSecret: 'secret', internalUrl: INTERNAL },
};
const internalService = () => new OidcService(internalConfig, auth as never);
const DISCOVERY_PATH = '/.well-known/openid-configuration';
/** The addresses a fetch mock was called with, in order. */
const called = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.map(([url]) => String(url));

afterEach(() => {
  vi.unstubAllGlobals();
  auth.loginWithVerifiedEmail.mockClear();
  auth.revokeSessionsBySsoSubject.mockClear();
});

describe('OidcService', () => {
  it('reports itself disabled (200, not an error) when no provider is configured, without asking anyone', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const off = new OidcService({ ...config, oidc: undefined }, auth as never);
    expect(await off.publicConfig()).toEqual({ enabled: false });
    await expect(off.exchange(input)).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
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

  it('keeps a successful discovery for later calls', async () => {
    const fetchSpy = provider({});
    vi.stubGlobal('fetch', fetchSpy);
    const svc = service();
    await svc.publicConfig();
    await svc.publicConfig();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  describe('when the provider cannot be asked', () => {
    const good = (over: Record<string, unknown> = {}) =>
      Response.json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/authorize`,
        token_endpoint: `${ISSUER}/token`,
        userinfo_endpoint: `${ISSUER}/me`,
        ...over,
      });

    it.each([
      ['a network error', () => Promise.reject(new TypeError('fetch failed'))],
      [
        'a timeout',
        () => Promise.reject(new DOMException('The operation timed out', 'TimeoutError')),
      ],
      ['a 500 answer', async () => new Response('down', { status: 500 })],
      ['a 404 answer', async () => new Response('missing', { status: 404 })],
      ['an answer that is not JSON', async () => new Response('<html>tunnel</html>')],
      ['JSON that is not a document', async () => Response.json(null)],
      ['a document without a token endpoint', async () => good({ token_endpoint: undefined })],
      ['a document with a non-text address', async () => good({ jwks_uri: 42 })],
      ['a document for another issuer', async () => good({ issuer: 'https://evil.example.com' })],
    ])('answers 503, never "disabled", after %s', async (_label, answer) => {
      vi.stubGlobal('fetch', vi.fn(answer));
      await expect(service().publicConfig()).rejects.toMatchObject({
        status: 503,
        code: 'service-unavailable',
      });
    });

    it('does not remember the failure: the next call asks again and recovers', async () => {
      const fetchSpy = vi
        .fn()
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce(new Response('down', { status: 502 }))
        .mockImplementation(provider({}));
      vi.stubGlobal('fetch', fetchSpy);
      const svc = service();

      await expect(svc.publicConfig()).rejects.toMatchObject({ status: 503 });
      await expect(svc.publicConfig()).rejects.toMatchObject({ status: 503 });
      expect(await svc.publicConfig()).toMatchObject({
        enabled: true,
        authorizationEndpoint: `${ISSUER}/authorize`,
        clientId: 'shop',
      });
      expect(fetchSpy).toHaveBeenCalledTimes(3);

      await svc.publicConfig();
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    });

    it('also answers 503 (not "no account") to a sign-in and to a back-channel logout', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.reject(new TypeError('fetch failed'))),
      );
      await expect(service().exchange(input)).rejects.toMatchObject({ status: 503 });
      await expect(service().handleBackchannelLogout(await logoutToken())).rejects.toMatchObject({
        status: 503,
      });
      expect(auth.loginWithVerifiedEmail).not.toHaveBeenCalled();
      expect(auth.revokeSessionsBySsoSubject).not.toHaveBeenCalled();
    });
  });

  describe('server calls and the internal provider address', () => {
    it('asks the issuer for discovery, and calls the published addresses, when no internal address is set', async () => {
      const spy = provider({ token: await idToken() });
      vi.stubGlobal('fetch', spy);
      await service().exchange(input);
      expect(called(spy)).toEqual([
        `${ISSUER}${DISCOVERY_PATH}`,
        `${ISSUER}/token`,
        `${ISSUER}/me`,
      ]);
    });

    it('asks the internal address for discovery when one is set, and still accepts the public issuer', async () => {
      const spy = provider({});
      vi.stubGlobal('fetch', spy);
      expect(await internalService().publicConfig()).toMatchObject({ enabled: true });
      expect(called(spy)).toEqual([`${INTERNAL}${DISCOVERY_PATH}`]);
    });

    it('still checks the document issuer against the PUBLIC issuer, not the internal address', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          Response.json({
            issuer: INTERNAL,
            authorization_endpoint: `${INTERNAL}/authorize`,
            token_endpoint: `${INTERNAL}/token`,
            userinfo_endpoint: `${INTERNAL}/me`,
          }),
        ),
      );
      await expect(internalService().publicConfig()).rejects.toMatchObject({ status: 503 });
    });

    it('sends the token and profile calls of a sign-in to the internal address', async () => {
      const spy = provider({ token: await idToken() });
      vi.stubGlobal('fetch', spy);
      await internalService().exchange(input);
      expect(called(spy)).toEqual([
        `${INTERNAL}${DISCOVERY_PATH}`,
        `${INTERNAL}/token`,
        `${INTERNAL}/me`,
      ]);
      expect(auth.loginWithVerifiedEmail).toHaveBeenCalledWith('owner@shop.com', 'user-1');
    });

    it('fetches the signing keys of a back-channel logout from the internal address', async () => {
      const spy = provider({});
      vi.stubGlobal('fetch', spy);
      await internalService().handleBackchannelLogout(await logoutToken());
      expect(called(spy)).toContain(`${INTERNAL}/jwks`);
      expect(called(spy).filter((url) => url.startsWith(ISSUER))).toEqual([]);
      expect(auth.revokeSessionsBySsoSubject).toHaveBeenCalledWith('user-1');
    });

    it('leaves a server address that is not under the issuer alone', async () => {
      const base = provider({ token: await idToken() });
      const spy = vi.fn(async (url: string | URL) =>
        String(url).endsWith(DISCOVERY_PATH)
          ? Response.json({
              issuer: ISSUER,
              authorization_endpoint: `${ISSUER}/authorize`,
              token_endpoint: 'https://other.example.com/token',
              userinfo_endpoint: `${ISSUER}/me`,
            })
          : base(url),
      );
      vi.stubGlobal('fetch', spy);
      await internalService().exchange(input);
      expect(called(spy)).toEqual([
        `${INTERNAL}${DISCOVERY_PATH}`,
        'https://other.example.com/token',
        `${INTERNAL}/me`,
      ]);
    });

    it('keeps the addresses the browser uses public', async () => {
      vi.stubGlobal('fetch', provider({}));
      expect(await internalService().publicConfig()).toEqual({
        enabled: true,
        authorizationEndpoint: `${ISSUER}/authorize`,
        endSessionEndpoint: `${ISSUER}/session/end`,
        clientId: 'shop',
      });
    });

    it('puts the public address on the browser endpoints when the provider names itself by the internal host', async () => {
      // The real provider builds every address in its discovery document from the host it was asked on.
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string | URL) => {
          if (String(url) !== `${INTERNAL}${DISCOVERY_PATH}`) return new Response('no', { status: 404 });
          return Response.json({
            issuer: ISSUER,
            authorization_endpoint: `${INTERNAL}/sso/authorize`,
            token_endpoint: `${INTERNAL}/sso/token`,
            userinfo_endpoint: `${INTERNAL}/sso/me`,
            jwks_uri: `${INTERNAL}/sso/jwks`,
            end_session_endpoint: `${INTERNAL}/sso/session/end`,
          });
        }),
      );
      expect(await internalService().publicConfig()).toEqual({
        enabled: true,
        authorizationEndpoint: 'https://idp.example.com/sso/authorize',
        endSessionEndpoint: 'https://idp.example.com/sso/session/end',
        clientId: 'shop',
      });
    });

    it('calls the provider on routes that exist when its document names the internal host with the issuer path prefix', async () => {
      // On the internal address the provider answers at its root (/token, /me); the /sso prefix exists only publicly.
      const seen: string[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string | URL) => {
          const u = String(url);
          seen.push(u);
          if (u === `${INTERNAL}${DISCOVERY_PATH}`) {
            return Response.json({
              issuer: ISSUER,
              authorization_endpoint: `${INTERNAL}/sso/authorize`,
              token_endpoint: `${INTERNAL}/sso/token`,
              userinfo_endpoint: `${INTERNAL}/sso/me`,
              jwks_uri: `${INTERNAL}/sso/jwks`,
              end_session_endpoint: `${INTERNAL}/sso/session/end`,
            });
          }
          if (u === `${INTERNAL}/token`) return Response.json({ id_token: await idToken(), access_token: 'at' });
          if (u === `${INTERNAL}/me`) {
            return Response.json({ sub: 'user-1', email: 'Owner@Shop.com', email_verified: true });
          }
          return new Response('no', { status: 404 });
        }),
      );
      await internalService().exchange(input);
      expect(seen).toEqual([`${INTERNAL}${DISCOVERY_PATH}`, `${INTERNAL}/token`, `${INTERNAL}/me`]);
      expect(auth.loginWithVerifiedEmail).toHaveBeenCalledWith('owner@shop.com', 'user-1');
    });

    it('still answers 503 when the internal address cannot be reached', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.reject(new TypeError('fetch failed'))),
      );
      await expect(internalService().publicConfig()).rejects.toMatchObject({
        status: 503,
        code: 'service-unavailable',
      });
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
