/**
 * The API limits requests by client address. Behind the web server every request would look like
 * it came from the web server, so one person's sign-in attempts would count against everyone.
 * The web server therefore passes the client address on. It takes the LAST entry of
 * X-Forwarded-For: that is the one the reverse proxy in front of it appended, which a client
 * cannot choose (run the API with TRUST_PROXY_HOPS=1 so it believes this header).
 */
export function clientIpFrom(h: { get(name: string): string | null }): string | undefined {
  const forwarded = h.get('x-forwarded-for');
  if (!forwarded) return undefined;
  return forwarded
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .at(-1);
}

export function forwardedFor(h: { get(name: string): string | null }): Record<string, string> {
  const ip = clientIpFrom(h);
  return ip ? { 'x-forwarded-for': ip } : {};
}
