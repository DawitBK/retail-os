# ADR 0005: rate limiting and sign-in lockout

Status: accepted

## Decision

- **Two limits, two jobs.** A middleware limits requests per client address: 10 sign-in, sign-up or
  organization-selection attempts a minute (the endpoints a password can be guessed through), 60
  token refreshes a minute and 600 requests a minute for everything else. Health probes are never
  limited. A refused request gets 429, a `Retry-After` header, `RateLimit-*` headers and a
  problem+json body with the code `rate-limited`.
- **Failures are counted per account too.** Five failed sign-ins for one email in fifteen minutes lock
  that email for fifteen minutes, even against the right password, so a guess spread across many
  addresses is still slow. Unknown emails are counted exactly like known ones, so the lock does not
  reveal which accounts exist. A success clears the count. The cost is that someone can lock a known
  email out for a quarter of an hour; that is the standard trade, and it expires by itself.
- **The address is only believed when it is trustworthy.** `X-Forwarded-For` is ignored unless
  `TRUST_PROXY_HOPS` says how many reverse proxies sit in front of the API. The web app passes the
  client address on (the last entry its own proxy appended, which a client cannot choose), so one
  person's attempts do not count against everyone behind the web server.
- **Off under tests, on everywhere else.** `RATE_LIMIT=off|on` overrides; the dedicated test file
  turns it on in its own process.

## Consequences

- Counters live in the API process's memory: exact for one process (the deployment target). Several
  processes need a shared store (Redis); the interface is small enough to swap.
- A restart clears the counters and the locks.
