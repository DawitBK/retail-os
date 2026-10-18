import { Inject, Injectable } from '@nestjs/common';
import { decodeJwt } from 'jose';
import { AUTH_CONFIG, type AuthConfig } from '../common/auth.js';
import { unauthorized } from '../common/errors.js';
import { AuthService } from './auth.service.js';
import type { OidcExchange, TokenPair } from './auth.contract.js';

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
}

export interface OidcPublicConfig {
  enabled: boolean;
  authorizationEndpoint?: string;
  clientId?: string;
}

const TIMEOUT_MS = 10_000;
const DISCOVERY_TTL_MS = 10 * 60_000;

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

  constructor(
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  private async discovery(): Promise<Discovery> {
    const oidc = this.config.oidc;
    if (!oidc) throw unauthorized('Single sign-on is not configured');
    if (this.cached && Date.now() - this.cached.at < DISCOVERY_TTL_MS) return this.cached.value;
    const issuer = oidc.issuer.replace(/\/+$/, '');
    const res = await fetch(`${issuer}/.well-known/openid-configuration`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw unauthorized('The identity provider could not be reached');
    const value = (await res.json()) as Discovery;
    if (value.issuer.replace(/\/+$/, '') !== issuer) {
      throw unauthorized('The identity provider reports a different issuer than configured');
    }
    this.cached = { value, at: Date.now() };
    return value;
  }

  async publicConfig(): Promise<OidcPublicConfig> {
    const oidc = this.config.oidc;
    if (!oidc) return { enabled: false };
    try {
      const d = await this.discovery();
      return {
        enabled: true,
        authorizationEndpoint: d.authorization_endpoint,
        clientId: oidc.clientId,
      };
    } catch {
      return { enabled: false };
    }
  }

  async exchange(input: OidcExchange): Promise<TokenPair> {
    const oidc = this.config.oidc;
    if (!oidc) throw unauthorized('Single sign-on is not configured');
    const d = await this.discovery();

    const tokenRes = await fetch(d.token_endpoint, {
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

    const infoRes = await fetch(d.userinfo_endpoint, {
      headers: { authorization: `Bearer ${tokens.access_token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!infoRes.ok) throw unauthorized('The identity provider did not return the profile');
    const info = (await infoRes.json()) as {
      sub?: string;
      email?: string;
      email_verified?: boolean;
    };
    if (info.sub !== claims.sub || !info.email || info.email_verified !== true) {
      throw unauthorized('The identity has no verified email');
    }
    return this.auth.loginWithVerifiedEmail(info.email.trim().toLowerCase());
  }
}
