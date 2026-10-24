import { Inject, Injectable } from '@nestjs/common';
import { createRemoteJWKSet, decodeJwt, jwtVerify } from 'jose';
import { AUTH_CONFIG, type AuthConfig } from '../common/auth.js';
import { serviceUnavailable, unauthorized } from '../common/errors.js';
import { ProblemException } from '@retail/kit';
import { AuthService } from './auth.service.js';
import type { OidcExchange, TokenPair } from './auth.contract.js';
import { internalAddress, publicAddress } from './oidc-address.js';

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  jwks_uri?: string;
  end_session_endpoint?: string;
}

export interface OidcPublicConfig {
  enabled: boolean;
  authorizationEndpoint?: string;
  /** Where the provider ends the person's single sign-on session (offered as "sign in as someone else"). */
  endSessionEndpoint?: string;
  clientId?: string;
}

const BACKCHANNEL_LOGOUT_EVENT = 'http://schemas.openid.net/event/backchannel-logout';

const TIMEOUT_MS = 10_000;
const DISCOVERY_TTL_MS = 10 * 60_000;

/** A discovery document is usable when it names the addresses the sign-in flow needs. */
function isDiscovery(value: unknown): value is Discovery {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  const required = ['issuer', 'authorization_endpoint', 'token_endpoint', 'userinfo_endpoint'];
  const optional = ['jwks_uri', 'end_session_endpoint'];
  return (
    required.every((key) => typeof v[key] === 'string' && v[key] !== '') &&
    optional.every((key) => v[key] === undefined || typeof v[key] === 'string')
  );
}

/**
 * Single sign-on through an OpenID Connect identity provider: the authorization code flow with PKCE and a
 * confidential client. The web app sends the browser to the provider and brings the code back here; this
 * service trades it for tokens, checks them, and signs in the person whose VERIFIED email matches an existing
 * active account. It never creates an account: there is no public sign-up, and an identity the owner did
 * not add is refused.
 */
@Injectable()
export class OidcService {
  private cached?: { value: Discovery; at: number };
  private jwks?: ReturnType<typeof createRemoteJWKSet>;

  constructor(
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  /**
   * A provider address as THIS server should call it: under OIDC_INTERNAL_URL when that is set, otherwise as
   * published. Only server-to-server calls use it; the addresses browsers follow (and the issuer that is
   * checked and put in tokens) always stay public.
   */
  private server(address: string): string {
    const oidc = this.config.oidc;
    return oidc ? internalAddress(address, oidc.issuer, oidc.internalUrl) : address;
  }

  /**
   * A provider address as a BROWSER should follow it. The provider names its endpoints after the host it was asked on, so a document
   * fetched through OIDC_INTERNAL_URL carries the internal host; this puts the public origin back (see publicAddress).
   */
  private browser(address: string): string {
    const oidc = this.config.oidc;
    return oidc ? publicAddress(address, oidc.issuer, oidc.internalUrl) : address;
  }

  /**
   * The provider's discovery document. Not configured is a definite answer (401). Failing to get a usable
   * document (network error, timeout, non-200, malformed, wrong issuer) is 503: the caller may try again.
   * Only a good document is cached, so the next call after a failure asks the provider again.
   */
  private async discovery(): Promise<Discovery> {
    const oidc = this.config.oidc;
    if (!oidc) throw unauthorized('Single sign-on is not configured');
    if (this.cached && Date.now() - this.cached.at < DISCOVERY_TTL_MS) return this.cached.value;
    const issuer = oidc.issuer.replace(/\/+$/, '');
    let body: unknown;
    try {
      const res = await fetch(`${this.server(issuer)}/.well-known/openid-configuration`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`discovery answered ${res.status}`);
      body = await res.json();
    } catch {
      throw serviceUnavailable('The identity provider could not be reached');
    }
    if (!isDiscovery(body)) {
      throw serviceUnavailable(
        'The identity provider sent a discovery document that cannot be used',
      );
    }
    if (body.issuer.replace(/\/+$/, '') !== issuer) {
      throw serviceUnavailable('The identity provider reports a different issuer than configured');
    }
    this.cached = { value: body, at: Date.now() };
    return body;
  }

  /** Off by design (no OIDC settings) is 200 with enabled false; an unreachable provider is 503, never "off". */
  async publicConfig(): Promise<OidcPublicConfig> {
    const oidc = this.config.oidc;
    if (!oidc) return { enabled: false };
    const d = await this.discovery();
    return {
      enabled: true,
      authorizationEndpoint: this.browser(d.authorization_endpoint),
      endSessionEndpoint: d.end_session_endpoint ? this.browser(d.end_session_endpoint) : undefined,
      clientId: oidc.clientId,
    };
  }

  async exchange(input: OidcExchange): Promise<TokenPair> {
    const oidc = this.config.oidc;
    if (!oidc) throw unauthorized('Single sign-on is not configured');
    const d = await this.discovery();

    const tokenRes = await fetch(this.server(d.token_endpoint), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: input.code,
        redirect_uri: input.redirectUri,
        client_id: oidc.clientId,
        client_secret: oidc.clientSecret,
        code_verifier: input.codeVerifier,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!tokenRes.ok) throw unauthorized('The identity provider refused the sign-in');
    const tokens = (await tokenRes.json()) as { id_token?: string; access_token?: string };
    if (!tokens.id_token || !tokens.access_token)
      throw unauthorized('The identity provider sent no identity');

    // The token came straight from the provider's token endpoint over TLS, so its signature need not be checked
    // (OpenID Connect Core 3.1.3.7); issuer, audience, nonce and expiry still are.
    const claims = decodeJwt(tokens.id_token);
    const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (
      claims.iss?.replace(/\/+$/, '') !== d.issuer.replace(/\/+$/, '') ||
      !audience.includes(oidc.clientId) ||
      claims.nonce !== input.nonce ||
      (claims.exp ?? 0) * 1000 < Date.now()
    ) {
      throw unauthorized('The identity token is not valid');
    }

    const infoRes = await fetch(this.server(d.userinfo_endpoint), {
      headers: { authorization: `Bearer ${tokens.access_token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!infoRes.ok) throw unauthorized('The identity provider did not return the profile');
    const info = (await infoRes.json()) as {
      sub?: string;
      email?: string;
      email_verified?: boolean;
    };
    if (!info.sub || info.sub !== claims.sub || !info.email || info.email_verified !== true) {
      throw unauthorized('The identity has no verified email');
    }
    return this.auth.loginWithVerifiedEmail(info.email.trim().toLowerCase(), info.sub);
  }

  /**
   * The provider's back-channel logout (OpenID Connect Back-Channel Logout 1.0): a signed logout token says this person signed out or was disabled there.
   * Verified against the provider's published keys, issuer, this client's id, type and age; then every session of that person here ends.
   * An invalid token is answered 400 and changes nothing.
   */
  async handleBackchannelLogout(logoutToken: string): Promise<void> {
    const oidc = this.config.oidc;
    if (!oidc) throw unauthorized('Single sign-on is not configured');
    const d = await this.discovery();
    if (!d.jwks_uri)
      throw new ProblemException(
        400,
        'invalid-logout-token',
        'The identity provider publishes no keys',
      );
    this.jwks ??= createRemoteJWKSet(new URL(this.server(d.jwks_uri)), {
      timeoutDuration: TIMEOUT_MS,
    });
    let subject: string;
    try {
      const { payload } = await jwtVerify(logoutToken, this.jwks, {
        issuer: d.issuer,
        audience: oidc.clientId,
        algorithms: ['RS256'],
        typ: 'logout+jwt',
        maxTokenAge: '5m',
        clockTolerance: 30,
      });
      const events = payload['events'] as Record<string, unknown> | undefined;
      if (
        !events ||
        !(BACKCHANNEL_LOGOUT_EVENT in events) ||
        'nonce' in payload ||
        typeof payload.sub !== 'string'
      ) {
        throw new Error('not a logout token');
      }
      subject = payload.sub;
    } catch {
      throw new ProblemException(400, 'invalid-logout-token', 'The logout token is not valid');
    }
    await this.auth.revokeSessionsBySsoSubject(subject);
  }
}
