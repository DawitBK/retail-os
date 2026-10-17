import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeStaff, PASSWORD, startContext, type TestContext } from './helpers.js';

// Rate limiting is off under tests unless asked for; this file asks, and runs in its own process.
process.env['RATE_LIMIT'] = 'on';

describe('sign-in lockout', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startContext();
  });
  afterAll(async () => {
    await ctx.close();
  });

  const login = (email: string, password: string) =>
    ctx.http().post('/api/v1/auth/login').send({ email, password });

  it('locks an account after five failures, even for the right password, and says for how long', async () => {
    const user = await makeStaff(ctx, 'cashier');
    for (let i = 0; i < 5; i += 1) {
      expect((await login(user.email, 'not the right password')).status).toBe(401);
    }
    const locked = await login(user.email, PASSWORD);
    expect(locked.status).toBe(429);
    expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);
    expect(locked.body).toMatchObject({ code: 'rate-limited', status: 429 });
    // Another account, even an unknown one, is not affected by that lock.
    expect((await login('someone-else@example.test', 'whatever it is')).status).toBe(401);
  });
});

describe('per-address limit', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startContext();
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('slows sign-in attempts from one address and leaves everything else alone', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const r = await ctx
        .http()
        .post('/api/v1/auth/login')
        .send({ email: `nobody-${i}@example.test`, password: 'whatever it is' });
      statuses.push(r.status);
      if (r.status === 429) {
        expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
        expect(r.headers['ratelimit-limit']).toBe('10');
        expect(r.body.code).toBe('rate-limited');
      }
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
    expect((await ctx.http().get('/health/live')).status).toBe(200);
    expect((await ctx.http().get('/health/ready')).status).toBe(200);
  });
});
