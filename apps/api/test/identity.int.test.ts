import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeStaff, PASSWORD, signIn, startContext, type TestContext } from './helpers.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await startContext();
});
afterAll(async () => {
  await ctx.close();
});

describe('sign-in', () => {
  it('has no public sign-up and guards every private route by default', async () => {
    const signup = await ctx
      .http()
      .post('/api/v1/auth/register')
      .send({ email: 'x@example.test', password: PASSWORD, firstName: 'X', lastName: 'Y' });
    expect(signup.status).toBe(404);

    expect((await ctx.http().post('/api/v1/staff').send({})).status).toBe(401);
    for (const path of [
      '/api/v1/me',
      '/api/v1/products',
      '/api/v1/sales',
      '/api/v1/staff',
      '/api/v1/accounting/accounts',
    ]) {
      const res = await ctx.http().get(path);
      expect(res.status, path).toBe(401);
      expect(res.type).toBe('application/problem+json');
    }
    const bad = await ctx.http().get('/api/v1/me').set('Authorization', 'Bearer not-a-token');
    expect(bad.status).toBe(401);
  });

  it('answers an unknown email, a wrong password and a disabled account identically', async () => {
    const admin = await makeStaff(ctx, 'owner');
    const victim = await makeStaff(ctx, 'cashier');
    const version = (
      await ctx.http().get('/api/v1/staff?limit=100').set(admin.auth)
    ).body.items.find((u: { id: string }) => u.id === victim.id).version;
    const disabled = await ctx
      .http()
      .patch(`/api/v1/staff/${victim.id}`)
      .set(admin.auth)
      .send({ version, active: false });
    expect(disabled.status).toBe(200);

    const attempts = await Promise.all([
      ctx
        .http()
        .post('/api/v1/auth/login')
        .send({ email: admin.email, password: 'wrong wrong wrong' }),
      ctx
        .http()
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@example.test', password: PASSWORD }),
      ctx.http().post('/api/v1/auth/login').send({ email: victim.email, password: PASSWORD }),
    ]);
    for (const a of attempts) expect(a.status).toBe(401);
    expect(new Set(attempts.map((a) => a.body.detail)).size).toBe(1);
  });

  it('serves the signed-in user without any secret', async () => {
    const staff = await makeStaff(ctx, 'cashier');
    const me = await ctx.http().get('/api/v1/me').set(staff.auth);
    expect(me.status).toBe(200);
    expect(me.body.role).toBe('cashier');
    expect(JSON.stringify(me.body)).not.toMatch(/password|hash/i);
  });
});

describe('sessions', () => {
  it('rotates refresh tokens and revokes the session when a spent one is replayed', async () => {
    const staff = await makeStaff(ctx, 'cashier');
    const rotated = await ctx
      .http()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: staff.refreshToken });
    expect(rotated.status).toBe(200);
    expect(rotated.body.refreshToken).not.toBe(staff.refreshToken);

    expect(
      (await ctx.http().post('/api/v1/auth/refresh').send({ refreshToken: staff.refreshToken }))
        .status,
    ).toBe(401);
    expect(
      (
        await ctx
          .http()
          .post('/api/v1/auth/refresh')
          .send({ refreshToken: rotated.body.refreshToken })
      ).status,
    ).toBe(401);
  });

  it('logout revokes the session', async () => {
    const staff = await makeStaff(ctx, 'cashier');
    expect(
      (await ctx.http().post('/api/v1/auth/logout').send({ refreshToken: staff.refreshToken }))
        .status,
    ).toBe(204);
    expect(
      (await ctx.http().post('/api/v1/auth/refresh').send({ refreshToken: staff.refreshToken }))
        .status,
    ).toBe(401);
  });

  it('a password change signs every session out', async () => {
    const staff = await makeStaff(ctx, 'cashier');
    const wrong = await ctx
      .http()
      .post('/api/v1/me/password')
      .set(staff.auth)
      .send({ currentPassword: 'not it at all!!', newPassword: 'a brand new passphrase' });
    expect(wrong.status).toBe(401);
    const ok = await ctx
      .http()
      .post('/api/v1/me/password')
      .set(staff.auth)
      .send({ currentPassword: PASSWORD, newPassword: 'a brand new passphrase' });
    expect(ok.status).toBe(204);
    expect(
      (await ctx.http().post('/api/v1/auth/refresh').send({ refreshToken: staff.refreshToken }))
        .status,
    ).toBe(401);
    const old = await ctx
      .http()
      .post('/api/v1/auth/login')
      .send({ email: staff.email, password: PASSWORD });
    expect(old.status).toBe(401);
    const fresh = await ctx
      .http()
      .post('/api/v1/auth/login')
      .send({ email: staff.email, password: 'a brand new passphrase' });
    expect(fresh.status).toBe(200);
  });
});

describe('staff administration', () => {
  it('lets only the owner create and manage staff', async () => {
    const admin = await makeStaff(ctx, 'owner');
    const librarian = await makeStaff(ctx, 'cashier');
    const email = `${randomUUID()}@example.test`;
    const body = {
      email,
      password: PASSWORD,
      firstName: 'New',
      lastName: 'Hire',
      role: 'cashier',
    };
    expect((await ctx.http().post('/api/v1/staff').set(librarian.auth).send(body)).status).toBe(
      403,
    );
    expect((await ctx.http().get('/api/v1/staff').set(librarian.auth)).status).toBe(403);

    const created = await ctx.http().post('/api/v1/staff').set(admin.auth).send(body);
    expect(created.status).toBe(201);
    expect(created.body.role).toBe('cashier');
    expect(JSON.stringify(created.body)).not.toMatch(/password|hash/i);
    expect((await signIn(ctx, email)).id).toBe(created.body.id);

    const dupe = await ctx
      .http()
      .post('/api/v1/staff')
      .set(admin.auth)
      .send({ ...body, email: email.toUpperCase() });
    expect(dupe.status).toBe(409);
    expect(dupe.body.code).toBe('email-taken');

    const weak = await ctx
      .http()
      .post('/api/v1/staff')
      .set(admin.auth)
      .send({ ...body, email: `${randomUUID()}@example.test`, password: 'short' });
    expect(weak.status).toBe(400);
    const badRole = await ctx
      .http()
      .post('/api/v1/staff')
      .set(admin.auth)
      .send({ ...body, email: `${randomUUID()}@example.test`, role: 'superuser' });
    expect(badRole.status).toBe(400);
  });

  it('ends a disabled account’s sessions at once and refuses self-lockout', async () => {
    const admin = await makeStaff(ctx, 'owner');
    const staff = await makeStaff(ctx, 'cashier');
    const list = await ctx.http().get('/api/v1/staff?limit=100').set(admin.auth);
    const row = list.body.items.find((u: { id: string }) => u.id === staff.id);

    const off = await ctx
      .http()
      .patch(`/api/v1/staff/${staff.id}`)
      .set(admin.auth)
      .send({ version: row.version, active: false });
    expect(off.status).toBe(200);
    expect(
      (await ctx.http().post('/api/v1/auth/refresh').send({ refreshToken: staff.refreshToken }))
        .status,
    ).toBe(401);
    expect(
      (await ctx.http().post('/api/v1/auth/login').send({ email: staff.email, password: PASSWORD }))
        .status,
    ).toBe(401);

    const self = list.body.items.find((u: { id: string }) => u.id === admin.id);
    const lockout = await ctx
      .http()
      .patch(`/api/v1/staff/${admin.id}`)
      .set(admin.auth)
      .send({ version: self.version, active: false });
    expect(lockout.status).toBe(422);
    expect(lockout.body.code).toBe('self-lockout');
    const demote = await ctx
      .http()
      .patch(`/api/v1/staff/${admin.id}`)
      .set(admin.auth)
      .send({ version: self.version, role: 'cashier' });
    expect(demote.status).toBe(422);

    const stale = await ctx
      .http()
      .patch(`/api/v1/staff/${staff.id}`)
      .set(admin.auth)
      .send({ version: row.version, firstName: 'Late' });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('version-conflict');
  });
});

describe('platform', () => {
  it('reports health and publishes the OpenAPI document without credentials', async () => {
    expect((await ctx.http().get('/health/live')).status).toBe(200);
    const ready = await ctx.http().get('/health/ready');
    expect(ready.status).toBe(200);
    expect(ready.body.checks.database.status).toBe('up');
    const doc = await ctx.http().get('/openapi.json');
    expect(doc.status).toBe(200);
    expect(doc.body.paths['/api/v1/sales'].post.security).toEqual([{ bearerAuth: [] }]);
    expect(doc.body.paths['/api/v1/auth/login'].post.security).toBeUndefined();
  });

  it('keeps the audit log append-only, even for SQL access', async () => {
    const admin = await makeStaff(ctx, 'owner');
    await ctx
      .http()
      .post('/api/v1/categories')
      .set(admin.auth)
      .send({ name: `Audit ${randomUUID().slice(0, 6)}`, type: 'STATIONERY' });
    const { rows } = await ctx.pool.query('select id from audit_log limit 1');
    expect(rows.length).toBe(1);
    await expect(ctx.pool.query('update audit_log set actor = $1', ['x'])).rejects.toThrow(
      /append-only/,
    );
    await expect(ctx.pool.query('delete from audit_log')).rejects.toThrow(/append-only/);
    await expect(ctx.pool.query('truncate audit_log')).rejects.toThrow(/append-only/);
  });
});
