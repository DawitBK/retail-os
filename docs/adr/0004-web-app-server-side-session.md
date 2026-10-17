# ADR 0004: the web app keeps the session on the server

Status: accepted

## Context

The till and the back office are a Next.js 16 app. It talks to the API, which issues a short-lived
access token and a rotating refresh token, and treats the reuse of an old refresh token as theft
(it revokes the whole family).

## Decision

- **Tokens never reach page JavaScript.** Both live in `httpOnly`, `SameSite=Lax`, `Secure`
  (in production) cookies set by the web server. Server components call the API directly with the
  access token; browser code calls `/bff/*`, one route handler that adds the token and forwards the
  request, including the `Idempotency-Key` header the till uses.
- **`proxy.ts` renews the access token** before a page renders. The access cookie expires a few
  seconds before the token, so its absence means "refresh now". Concurrent requests that carry the
  same refresh token share one refresh (a short in-process cache), because several parallel
  refreshes would present an already-rotated token and get the whole session revoked. Prefetches
  never refresh.
- **The browser never decides money.** The till sends what was bought and how it was paid; the
  server prices it. The till shows a total for the cashier but the receipt always comes from the
  API's response.
- **One idempotency key per unchanged sale.** The till keeps the key across a retry after a network
  failure and discards it the moment the cart or payment changes, so a double click cannot sell
  twice and an edited cart is a new sale.
- **Roles hide, the API refuses.** The navigation and buttons follow the role, but every rule is
  enforced again by the API; the web app never grants anything.

## Consequences

- No token in `localStorage`, no token in a URL, nothing for an XSS payload to steal.
- Refresh de-duplication is per web server process. Running several instances behind a load balancer
  needs sticky sessions or a shared cache; one instance (the target) is exact.
- Every browser call costs one extra hop through the web server, which is the price of the first
  point.
