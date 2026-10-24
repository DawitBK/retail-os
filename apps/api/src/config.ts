import { baseEnvSchema } from '@retail/kit';
import { z } from 'zod';

export const envSchema = baseEnvSchema.extend({
  DATABASE_URL: z
    .string()
    .min(1)
    .regex(/^postgres(ql)?:\/\//, 'must be a postgres:// URL'),
  /** HMAC key for access tokens; at least 32 characters so a weak key fails at boot. */
  JWT_SECRET: z.string().min(32, 'must be at least 32 characters'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(3600)
    .default(60 * 60 * 24 * 14),
  /** Single sign-on: set all three, or none. */
  OIDC_ISSUER: z.url().optional(),
  OIDC_CLIENT_ID: z.string().min(1).optional(),
  OIDC_CLIENT_SECRET: z.string().min(1).optional(),
  /**
   * Single sign-on, optional: where THIS server reaches the provider (for example http://sso:7300), so server-to-server
   * calls stay off the public internet. An absolute http or https URL without a trailing slash. Browsers keep using OIDC_ISSUER.
   */
  OIDC_INTERNAL_URL: z
    .url({ protocol: /^https?$/, error: 'must be an absolute http or https URL' })
    .refine((value) => !value.endsWith('/'), 'must not end with a slash')
    .optional(),
  /** The shop's time zone: it decides which day a sale or an expense belongs to. */
  BUSINESS_TIMEZONE: z.string().min(1).default('Africa/Addis_Ababa'),
});

export type Env = z.output<typeof envSchema>;
