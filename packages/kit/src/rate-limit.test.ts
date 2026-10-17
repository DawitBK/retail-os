import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RATE_LIMITS,
  FailureLimiter,
  LockedOutError,
  WindowCounter,
  rateLimitEnabled,
  rateLimitMiddleware,
} from './rate-limit.js';

describe('WindowCounter', () => {
  it('allows up to the limit, then refuses until the window resets', () => {
    const c = new WindowCounter();
    const w = { limit: 3, windowMs: 1000 };
    expect([1, 2, 3].map((i) => c.hit('k', w, i).allowed)).toEqual([true, true, true]);
    expect(c.hit('k', w, 10).allowed).toBe(false);
    expect(c.hit('other', w, 10).allowed).toBe(true);
    expect(c.hit('k', w, 1001).allowed).toBe(true);
  });

  it('reports what is left and when it resets', () => {
    const c = new WindowCounter();
    const r = c.hit('k', { limit: 2, windowMs: 1000 }, 100);
    expect(r).toEqual({ allowed: true, remaining: 1, resetAt: 1100 });
  });
});

describe('FailureLimiter', () => {
  const make = (extra: Partial<ConstructorParameters<typeof FailureLimiter>[0]> = {}) => {
    let t = 0;
    const limiter = new FailureLimiter({
      maxFailures: 3,
      windowMs: 1000,
      lockMs: 5000,
      now: () => t,
      enabled: () => true,
      ...extra,
    });
    return { limiter, at: (ms: number) => (t = ms) };
  };

  it('locks after the maximum failures, even for the right password, then releases', () => {
    const { limiter, at } = make();
    for (let i = 0; i < 3; i += 1) {
      limiter.assertAllowed('a@x.test');
      limiter.recordFailure('a@x.test');
    }
    expect(() => limiter.assertAllowed('a@x.test')).toThrow(LockedOutError);
    at(4999);
    expect(() => limiter.assertAllowed('a@x.test')).toThrow(LockedOutError);
    at(5001);
    expect(() => limiter.assertAllowed('a@x.test')).not.toThrow();
  });

  it('forgets failures after the window and after a success', () => {
    const { limiter, at } = make();
    limiter.recordFailure('k');
    limiter.recordFailure('k');
    at(1500);
    limiter.recordFailure('k');
    expect(() => limiter.assertAllowed('k')).not.toThrow();
    limiter.recordFailure('k');
    limiter.reset('k');
    limiter.recordFailure('k');
    expect(() => limiter.assertAllowed('k')).not.toThrow();
  });

  it('keeps keys apart', () => {
    const { limiter } = make();
    for (let i = 0; i < 3; i += 1) limiter.recordFailure('a');
    expect(() => limiter.assertAllowed('b')).not.toThrow();
  });

  it('does nothing when disabled', () => {
    const { limiter } = make({ enabled: () => false });
    for (let i = 0; i < 10; i += 1) limiter.recordFailure('a');
    expect(() => limiter.assertAllowed('a')).not.toThrow();
  });
});

describe('rateLimitMiddleware', () => {
  function run(handler: ReturnType<typeof rateLimitMiddleware>, path: string, method = 'POST') {
    const out = {
      status: 0,
      headers: {} as Record<string, string>,
      body: undefined as unknown,
      nexted: false,
    };
    const res = {
      status(code: number) {
        out.status = code;
        return res;
      },
      set(k: string, v?: string) {
        if (v !== undefined) out.headers[k] = v;
        return res;
      },
      type() {
        return res;
      },
      send(b: unknown) {
        out.body = b;
        return res;
      },
    };
    handler({ path, method, ip: '10.0.0.1' } as never, res as never, () => {
      out.nexted = true;
    });
    return out;
  }

  it('limits sign-in attempts per address far below the general limit, with problem+json', () => {
    const handler = rateLimitMiddleware({
      ...DEFAULT_RATE_LIMITS,
      now: () => 0,
      enabled: () => true,
    });
    const results = Array.from({ length: 12 }, () => run(handler, '/api/v1/auth/login'));
    expect(results.slice(0, 10).every((r) => r.nexted)).toBe(true);
    expect(results[10]?.status).toBe(429);
    expect(results[10]?.headers['Retry-After']).toBe('60');
    expect(results[10]?.body).toMatchObject({ code: 'rate-limited', status: 429 });
    // The general limit is separate: other routes are unaffected.
    expect(run(handler, '/api/v1/products', 'GET').nexted).toBe(true);
  });

  it('never limits health probes and can be switched off', () => {
    const tight = {
      rules: [],
      fallback: { limit: 1, windowMs: 1000 },
      skip: DEFAULT_RATE_LIMITS.skip,
    };
    const handler = rateLimitMiddleware({ ...tight, now: () => 0, enabled: () => true });
    for (let i = 0; i < 5; i += 1) expect(run(handler, '/health/ready', 'GET').nexted).toBe(true);
    const off = rateLimitMiddleware({ ...tight, enabled: () => false });
    for (let i = 0; i < 5; i += 1) expect(run(off, '/x', 'GET').nexted).toBe(true);
  });

  it('is on in production and off under test unless told otherwise', () => {
    expect(rateLimitEnabled({ NODE_ENV: 'production' })).toBe(true);
    expect(rateLimitEnabled({ NODE_ENV: 'test' })).toBe(false);
    expect(rateLimitEnabled({ NODE_ENV: 'test', RATE_LIMIT: 'on' })).toBe(true);
    expect(rateLimitEnabled({ NODE_ENV: 'production', RATE_LIMIT: 'off' })).toBe(false);
  });
});
