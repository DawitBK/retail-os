import { describe, expect, it } from 'vitest';
import { envSchema } from './config.js';

const base = { DATABASE_URL: 'postgres://u:p@localhost:5432/db', JWT_SECRET: 'x'.repeat(32) };
const parse = (extra: Record<string, string>) => envSchema.safeParse({ ...base, ...extra });

describe('OIDC_INTERNAL_URL', () => {
  it("is optional: absent keeps today's behaviour", () => {
    const result = parse({});
    expect(result.success).toBe(true);
    expect(result.data?.OIDC_INTERNAL_URL).toBeUndefined();
  });

  it.each([
    'http://sso:7300',
    'https://idp.internal',
    'http://127.0.0.1:7300',
    'http://gateway:8080/idp',
  ])('accepts the absolute http or https address %s', (value) => {
    const result = parse({ OIDC_INTERNAL_URL: value });
    expect(result.success).toBe(true);
    expect(result.data?.OIDC_INTERNAL_URL).toBe(value);
  });

  it.each([
    ['a trailing slash', 'http://sso:7300/'],
    ['another scheme', 'ftp://sso:7300'],
    ['a file address', 'file:///sso'],
    ['a scheme-less host', 'sso:7300'],
    ['a relative path', '/sso'],
    ['an empty value', ''],
  ])('rejects %s', (_label, value) => {
    expect(parse({ OIDC_INTERNAL_URL: value }).success).toBe(false);
  });
});
