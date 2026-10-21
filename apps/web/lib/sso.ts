import 'server-only';
import { API_URL } from './session';

export interface SsoConfig {
  enabled: boolean;
  authorizationEndpoint?: string;
  /** Where the provider ends the person's single sign-on session ("sign in as someone else"). */
  endSessionEndpoint?: string;
  clientId?: string;
}

/** Whether the API offers single sign-on, and where the provider's sign-in page is. Never throws. */
export async function ssoConfig(): Promise<SsoConfig> {
  try {
    const res = await fetch(`${API_URL}/api/v1/auth/oidc/config`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    return res.ok ? ((await res.json()) as SsoConfig) : { enabled: false };
  } catch {
    return { enabled: false };
  }
}

/** The address visitors use for this web app (Vercel puts it in the request; APP_ORIGIN overrides it). */
export function appOrigin(request: Request): string {
  return (process.env.APP_ORIGIN ?? new URL(request.url).origin).replace(/\/+$/, '');
}

export const SSO_COOKIE = 'sso_flow';
