import { describe, expect, it } from 'vitest';
import { internalAddress } from './oidc-address.js';

const ISSUER = 'https://portal.example.com/sso';
const INTERNAL = 'http://sso:7300';

describe('internalAddress', () => {
  it('replaces the public issuer prefix with the internal address and keeps the rest', () => {
    expect(internalAddress(`${ISSUER}/token`, ISSUER, INTERNAL)).toBe('http://sso:7300/token');
    expect(internalAddress(`${ISSUER}/oauth/jwks?kid=1`, ISSUER, INTERNAL)).toBe(
      'http://sso:7300/oauth/jwks?kid=1',
    );
    expect(internalAddress(`${ISSUER}/.well-known/openid-configuration`, ISSUER, INTERNAL)).toBe(
      'http://sso:7300/.well-known/openid-configuration',
    );
  });

  it('maps the issuer itself', () => {
    expect(internalAddress(ISSUER, ISSUER, INTERNAL)).toBe('http://sso:7300');
  });

  it('leaves an address alone when it is not under the issuer', () => {
    expect(internalAddress('https://other.example.com/sso/token', ISSUER, INTERNAL)).toBe(
      'https://other.example.com/sso/token',
    );
    expect(internalAddress('https://portal.example.com/token', ISSUER, INTERNAL)).toBe(
      'https://portal.example.com/token',
    );
    expect(internalAddress('http://portal.example.com/sso/token', ISSUER, INTERNAL)).toBe(
      'http://portal.example.com/sso/token',
    );
  });

  it('does not match a longer path or host that merely starts with the issuer', () => {
    expect(internalAddress('https://portal.example.com/sso-other/token', ISSUER, INTERNAL)).toBe(
      'https://portal.example.com/sso-other/token',
    );
    expect(
      internalAddress(
        'https://portal.example.com:8443/token',
        'https://portal.example.com',
        INTERNAL,
      ),
    ).toBe('https://portal.example.com:8443/token');
  });

  it('works for an issuer without a path', () => {
    const bare = 'https://idp.example.com';
    expect(internalAddress('https://idp.example.com/token', bare, INTERNAL)).toBe(
      'http://sso:7300/token',
    );
    expect(internalAddress('https://idp.example.com', bare, INTERNAL)).toBe('http://sso:7300');
    expect(internalAddress('https://idp.example.com?x=1', bare, INTERNAL)).toBe(
      'http://sso:7300?x=1',
    );
  });

  it('ignores trailing slashes on the issuer and on the internal address', () => {
    expect(internalAddress(`${ISSUER}/token`, `${ISSUER}/`, INTERNAL)).toBe(
      'http://sso:7300/token',
    );
    expect(internalAddress(`${ISSUER}/token`, ISSUER, `${INTERNAL}/`)).toBe(
      'http://sso:7300/token',
    );
    expect(internalAddress(`${ISSUER}/token`, `${ISSUER}//`, `${INTERNAL}//`)).toBe(
      'http://sso:7300/token',
    );
  });

  it('keeps a path on the internal address', () => {
    expect(internalAddress(`${ISSUER}/token`, ISSUER, 'http://gateway:8080/idp')).toBe(
      'http://gateway:8080/idp/token',
    );
  });

  it('returns every address unchanged when no internal address is set', () => {
    expect(internalAddress(`${ISSUER}/token`, ISSUER, undefined)).toBe(`${ISSUER}/token`);
    expect(internalAddress(`${ISSUER}/token`, ISSUER, '')).toBe(`${ISSUER}/token`);
  });
});
