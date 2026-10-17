import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Rate limiting in two parts.
 *
 * `rateLimitMiddleware` limits requests per client address, with a strict rule for the endpoints a
 * password can be guessed through. `FailureLimiter` limits *failed* attempts per account, so a
 * distributed guess at one person's password is slowed even when it comes from many addresses.
 *
 * Both keep their counters in memory: exact for one API process (the deployment target), and a
 * shared store (Redis) is the upgrade for several. Counters are bounded and expire on their own.
 */

/** On unless the environment says otherwise; off by default under tests so suites can sign in freely. */
export function rateLimitEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (env['RATE_LIMIT'] === 'on') return true;
  if (env['RATE_LIMIT'] === 'off') return false;
  return env['NODE_ENV'] !== 'test';
}

export interface Window {
  limit: number;
  windowMs: number;
}

export interface Rule extends Window {
  name: string;
  /** Upper-case HTTP methods this rule covers; every method when omitted. */
  methods?: string[];
  path: RegExp;
}

const MAX_ENTRIES = 50_000;

interface Counter {
  count: number;
  resetAt: number;
}

/** A fixed-window counter per key, bounded in size, swept as it is used. */
export class WindowCounter {
  private readonly counters = new Map<string, Counter>();
  private lastSweep = 0;

  hit(
    key: string,
    window: Window,
    now: number,
  ): { allowed: boolean; remaining: number; resetAt: number } {
    this.sweep(now);
    let c = this.counters.get(key);
    if (!c || c.resetAt <= now) {
      if (!c && this.counters.size >= MAX_ENTRIES) this.evictOldest();
      c = { count: 0, resetAt: now + window.windowMs };
      this.counters.set(key, c);
    }
    c.count += 1;
    return {
      allowed: c.count <= window.limit,
      remaining: Math.max(window.limit - c.count, 0),
      resetAt: c.resetAt,
    };
  }

  private sweep(now: number): void {
    if (now - this.lastSweep < 30_000) return;
    this.lastSweep = now;
    for (const [k, c] of this.counters) if (c.resetAt <= now) this.counters.delete(k);
  }

  private evictOldest(): void {
    const first = this.counters.keys().next();
    if (!first.done) this.counters.delete(first.value);
  }
}

export interface RateLimitOptions {
  /** Checked in order; the first match applies. Anything else gets `fallback`. */
  rules: Rule[];
  fallback: Window;
  /** Paths that are never limited (health probes). */
  skip?: RegExp;
  now?: () => number;
  enabled?: () => boolean;
}

export const AUTH_PATH = /^\/api\/v1\/auth\/(login|register|select-organization)$/;

/** The defaults every service uses: 10 sign-in or sign-up attempts a minute, 600 requests a minute. */
export const DEFAULT_RATE_LIMITS: RateLimitOptions = {
  rules: [
    { name: 'auth', methods: ['POST'], path: AUTH_PATH, limit: 10, windowMs: 60_000 },
    {
      name: 'refresh',
      methods: ['POST'],
      path: /^\/api\/v1\/auth\/refresh$/,
      limit: 60,
      windowMs: 60_000,
    },
  ],
  fallback: { limit: 600, windowMs: 60_000 },
  skip: /^\/health(\/|$)/,
};

function problem(res: Response, retryAfterSeconds: number, detail: string): void {
  res
    .status(429)
    .set('Retry-After', String(retryAfterSeconds))
    .type('application/problem+json')
    .send({
      type: 'urn:problem:rate-limited',
      title: 'Too many requests',
      status: 429,
      detail,
      code: 'rate-limited',
      retryAfterSeconds,
    });
}

/** Express middleware limiting requests per client address. Apply before the routes. */
export function rateLimitMiddleware(
  options: RateLimitOptions = DEFAULT_RATE_LIMITS,
): RequestHandler {
  const counter = new WindowCounter();
  const now = options.now ?? Date.now;
  const enabled = options.enabled ?? (() => rateLimitEnabled());
  return (req: Request, res: Response, next: NextFunction) => {
    if (!enabled() || options.skip?.test(req.path)) return next();
    const rule = options.rules.find(
      (r) => r.path.test(req.path) && (!r.methods || r.methods.includes(req.method)),
    );
    const window = rule ?? options.fallback;
    const t = now();
    const key = `${rule?.name ?? 'all'}:${req.ip ?? 'unknown'}`;
    const result = counter.hit(key, window, t);
    res.set('RateLimit-Limit', String(window.limit));
    res.set('RateLimit-Remaining', String(result.remaining));
    res.set('RateLimit-Reset', String(Math.max(Math.ceil((result.resetAt - t) / 1000), 0)));
    if (result.allowed) return next();
    problem(
      res,
      Math.max(Math.ceil((result.resetAt - t) / 1000), 1),
      'Slow down and try again shortly.',
    );
  };
}

export interface FailureLimiterOptions {
  /** Failed attempts allowed inside the window before the key is locked. */
  maxFailures: number;
  windowMs: number;
  lockMs: number;
  now?: () => number;
  enabled?: () => boolean;
}

interface Failures {
  count: number;
  windowEnds: number;
  lockedUntil: number;
}

/** Thrown by `assertAllowed`; the problem filter has no special case, so callers map it themselves. */
export class LockedOutError extends Error {
  override name = 'LockedOutError';
  constructor(readonly retryAfterSeconds: number) {
    super(`Too many failed attempts; try again in ${retryAfterSeconds} seconds`);
  }
}

/**
 * Counts failed attempts per key (an email address, say). Reaching the limit locks the key for a
 * while, even against the right password, which is what makes guessing slow. A success clears it.
 */
export class FailureLimiter {
  private readonly map = new Map<string, Failures>();

  constructor(private readonly options: FailureLimiterOptions) {}

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private on(): boolean {
    return (this.options.enabled ?? (() => rateLimitEnabled()))();
  }

  /** Throws `LockedOutError` while the key is locked. Call before checking the password. */
  assertAllowed(key: string): void {
    if (!this.on()) return;
    const f = this.map.get(key);
    const t = this.now();
    if (f && f.lockedUntil > t) throw new LockedOutError(Math.ceil((f.lockedUntil - t) / 1000));
  }

  recordFailure(key: string): void {
    if (!this.on()) return;
    const t = this.now();
    if (this.map.size >= MAX_ENTRIES && !this.map.has(key)) {
      const first = this.map.keys().next();
      if (!first.done) this.map.delete(first.value);
    }
    let f = this.map.get(key);
    if (!f || (f.lockedUntil <= t && f.windowEnds <= t)) {
      f = { count: 0, windowEnds: t + this.options.windowMs, lockedUntil: 0 };
      this.map.set(key, f);
    }
    f.count += 1;
    if (f.count >= this.options.maxFailures) f.lockedUntil = t + this.options.lockMs;
  }

  reset(key: string): void {
    this.map.delete(key);
  }
}
