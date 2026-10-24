/**
 * Where this SERVER should call an address the identity provider published. The provider's documents name
 * public addresses (the ones browsers use). When an internal base URL is configured, an address that lies
 * under the public issuer is called on the same path under the internal URL instead, so server-to-server
 * traffic stays off the public internet. Any other address is returned unchanged, and so is every address
 * when no internal URL is set.
 *
 * "Under the issuer" is decided at a path boundary: https://idp.example.com/sso-other is NOT under
 * https://idp.example.com/sso, and https://idp.example.com:8443 is not under https://idp.example.com.
 * Trailing slashes on the issuer and on the internal URL are ignored.
 */
export function internalAddress(address: string, issuer: string, internalUrl?: string): string {
  if (!internalUrl) return address;
  const base = issuer.replace(/\/+$/, '');
  if (!address.startsWith(base)) return address;
  const rest = address.slice(base.length);
  if (rest !== '' && !/^[/?#]/.test(rest)) return address;
  return internalUrl.replace(/\/+$/, '') + rest;
}
