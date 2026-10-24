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

/**
 * The reverse of internalAddress, for the addresses a BROWSER will follow. The provider builds the addresses in its discovery document
 * from the host it was asked on, so a document fetched through the internal URL names the internal host (http://sso:7300/...), which no
 * browser can reach. An address on the internal URL's origin is put on the issuer's origin, keeping its path and query. Any other
 * address is returned unchanged, and so is every address when no internal URL is set (the document then already names public addresses).
 */
export function publicAddress(address: string, issuer: string, internalUrl?: string): string {
  if (!internalUrl) return address;
  let internalOrigin: string;
  let publicOrigin: string;
  try {
    internalOrigin = new URL(internalUrl).origin;
    publicOrigin = new URL(issuer).origin;
  } catch {
    return address;
  }
  if (!address.startsWith(internalOrigin)) return address;
  const rest = address.slice(internalOrigin.length);
  if (rest !== '' && !/^[/?#]/.test(rest)) return address;
  return publicOrigin + rest;
}
