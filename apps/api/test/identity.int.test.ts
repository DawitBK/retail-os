import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthService } from '../src/auth/auth.service.js';
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

describe('the platform administrator', () => {
  it('is in no staff list, cannot be edited by anyone else, and still sees and edits itself', async () => {
    const owner = await makeStaff(ctx, 'owner');
    const hidden = await makeStaff(ctx, 'owner');
    await ctx.pool.query('update users set platform_admin = true where id = $1', [hidden.id]);

    const others = await ctx.http().get('/api/v1/staff?limit=100').set(owner.auth);
    expect(others.status).toBe(200);
    expect(others.body.items.some((u: { id: string }) => u.id === hidden.id)).toBe(false);
    expect(others.body.page.total).toBe(others.body.items.length); // the count does not give the hidden account away either

    const edit = await ctx
      .http()
      .patch(`/api/v1/staff/${hidden.id}`)
      .set(owner.auth)
      .send({ version: 1, active: false });
    expect(edit.status).toBe(404);
    const nobody = await ctx
      .http()
      .patch(`/api/v1/staff/${randomUUID()}`)
      .set(owner.auth)
      .send({ version: 1, active: false });
    expect(nobody.status).toBe(404);
    expect(edit.body.title).toBe(nobody.body.title); // the same answer as an id that never existed
    const row = await ctx.pool.query('select active from users where id = $1', [hidden.id]);
    expect(row.rows[0].active).toBe(true);

    const own = await ctx.http().get('/api/v1/staff?limit=100').set(hidden.auth);
    expect(own.body.items.some((u: { id: string }) => u.id === hidden.id)).toBe(true);
    const self = await ctx
      .http()
      .patch(`/api/v1/staff/${hidden.id}`)
      .set(hidden.auth)
      .send({ version: 1, firstName: 'Platform' });
    expect(self.status).toBe(200);
  });
});

describe('single sign-on identity and sign-out', () => {
  it('binds the provider id at the first sign-in, then refuses the same email with another id', async () => {
    const auth = ctx.app.get(AuthService);
    const person = await makeStaff(ctx, 'manager');
    const sub = `sub-${randomUUID()}`;
    expect((await auth.loginWithVerifiedEmail(person.email, sub)).user.email).toBe(person.email);
    expect(
      (await ctx.pool.query('select sso_subject from users where id = $1', [person.id])).rows[0]
        .sso_subject,
    ).toBe(sub);
    expect((await auth.loginWithVerifiedEmail(person.email, sub)).user.id).toBe(person.id);
    await expect(
      auth.loginWithVerifiedEmail(person.email, `sub-${randomUUID()}`),
    ).rejects.toMatchObject({ status: 401 });

    const other = await makeStaff(ctx, 'manager');
    await expect(auth.loginWithVerifiedEmail(other.email, sub)).rejects.toMatchObject({
      status: 401,
    }); // an id belongs to one account
  });

  it("the provider's sign-out ends every session of that person and nobody else's", async () => {
    const auth = ctx.app.get(AuthService);
    const a = await makeStaff(ctx, 'cashier');
    const b = await makeStaff(ctx, 'cashier');
    const subA = `sub-${randomUUID()}`;
    const subB = `sub-${randomUUID()}`;
    const tokensA = await auth.loginWithVerifiedEmail(a.email, subA);
    await auth.loginWithVerifiedEmail(b.email, subB);
    expect(await auth.revokeSessionsBySsoSubject(`sub-${randomUUID()}`)).toBe(0); // an id this app never saw: nothing, and no error
    expect(await auth.revokeSessionsBySsoSubject(subA)).toBeGreaterThanOrEqual(2); // the password sign-in of makeStaff and the SSO one
    const refresh = await ctx
      .http()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: tokensA.refreshToken });
    expect(refresh.status).toBe(401);
    const refreshB = await ctx
      .http()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: b.refreshToken });
    expect(refreshB.status).toBe(200);
  });

  it('the back-channel route is public and refuses a missing or malformed token', async () => {
    expect(
      (await ctx.http().post('/api/v1/auth/backchannel-logout').type('form').send({})).status,
    ).toBe(400);
    expect(
      (
        await ctx
          .http()
          .post('/api/v1/auth/backchannel-logout')
          .type('form')
          .send({ logout_token: 'x'.repeat(30) })
      ).status,
    ).toBeGreaterThanOrEqual(400);
  });
});

describe('roles the identity provider manages for this application', () => {
  const emailOf = () => `${randomUUID()}@example.test`;
  const roleOf = async (email: string) =>
    (
      await ctx.pool.query(
        'select role, active, first_name, last_name, sso_subject from users where email = $1',
        [email],
      )
    ).rows[0];

  it('creates the account at the first sign-in with the role the provider gave, for single sign-on only', async () => {
    const auth = ctx.app.get(AuthService);
    const email = emailOf();
    const tokens = await auth.loginWithVerifiedEmail(email, `sub-${randomUUID()}`, {
      roles: ['cashier'],
      firstName: 'Abebe',
      lastName: 'Kebede',
    });
    expect(tokens.user).toMatchObject({
      email,
      role: 'cashier',
      firstName: 'Abebe',
      lastName: 'Kebede',
    });
    const row = await roleOf(email);
    expect(row).toMatchObject({ role: 'cashier', active: true });
    // Nobody knows its password: the usual sign-in cannot be used with a guessed one.
    expect(
      (await ctx.http().post('/api/v1/auth/login').send({ email, password: PASSWORD })).status,
    ).toBe(401);
    const audit = await ctx.pool.query(
      `select actor from audit_log where action = 'staff.created-by-sso' and after->>'email' = $1`,
      [email],
    );
    expect(audit.rows).toEqual([{ actor: 'identity-provider' }]);
  });

  it("sets the role to the provider's at every sign-in, taking the strongest when several are given", async () => {
    const auth = ctx.app.get(AuthService);
    const email = emailOf();
    const sub = `sub-${randomUUID()}`;
    await auth.loginWithVerifiedEmail(email, sub, { roles: ['cashier'] });
    expect(
      (await auth.loginWithVerifiedEmail(email, sub, { roles: ['cashier', 'manager'] })).user.role,
    ).toBe('manager');
    expect((await roleOf(email)).role).toBe('manager');
    expect(
      (await auth.loginWithVerifiedEmail(email, sub, { roles: ['accountant'] })).user.role,
    ).toBe('accountant'); // a demotion applies too
    const changes = await ctx.pool.query(
      `select before->>'role' as before, after->>'role' as after from audit_log where action = 'staff.role-set-by-sso' and entity_id = (select id::text from users where email = $1) order by id`,
      [email],
    );
    expect(changes.rows).toEqual([
      { before: 'cashier', after: 'manager' },
      { before: 'manager', after: 'accountant' },
    ]);
    // The same role again changes nothing and writes nothing.
    await auth.loginWithVerifiedEmail(email, sub, { roles: ['accountant'] });
    expect(
      (
        await ctx.pool.query(
          `select count(*)::int as n from audit_log where action = 'staff.role-set-by-sso' and entity_id = (select id::text from users where email = $1)`,
          [email],
        )
      ).rows[0].n,
    ).toBe(2);
  });

  it('refuses with 403 when the provider gave no role we recognise, and creates nothing', async () => {
    const auth = ctx.app.get(AuthService);
    for (const roles of [[], ['wizard']]) {
      const email = emailOf();
      await expect(
        auth.loginWithVerifiedEmail(email, `sub-${randomUUID()}`, { roles }),
      ).rejects.toMatchObject({ status: 403 });
      expect(await roleOf(email)).toBeUndefined();
    }
  });

  it('a person who held an account and then lost every role is refused, and their account is kept', async () => {
    const auth = ctx.app.get(AuthService);
    const person = await makeStaff(ctx, 'manager');
    await expect(
      auth.loginWithVerifiedEmail(person.email, `sub-${randomUUID()}`, { roles: [] }),
    ).rejects.toMatchObject({ status: 403 });
    expect(await roleOf(person.email)).toMatchObject({ role: 'manager', active: true });
  });

  it('does not override an account switched off here, and still binds the id to one person', async () => {
    const auth = ctx.app.get(AuthService);
    const email = emailOf();
    const sub = `sub-${randomUUID()}`;
    await auth.loginWithVerifiedEmail(email, sub, { roles: ['cashier'] });
    await ctx.pool.query('update users set active = false where email = $1', [email]);
    await expect(
      auth.loginWithVerifiedEmail(email, sub, { roles: ['owner'] }),
    ).rejects.toMatchObject({ status: 401 });
    expect(await roleOf(email)).toMatchObject({ role: 'cashier', active: false });
    const other = emailOf();
    await expect(
      auth.loginWithVerifiedEmail(other, sub, { roles: ['cashier'] }),
    ).rejects.toMatchObject({ status: 401 }); // an id belongs to one account
  });

  it('two first sign-ins at once create one account', async () => {
    const auth = ctx.app.get(AuthService);
    const email = emailOf();
    const sub = `sub-${randomUUID()}`;
    const results = await Promise.allSettled([
      auth.loginWithVerifiedEmail(email, sub, { roles: ['cashier'] }),
      auth.loginWithVerifiedEmail(email, sub, { roles: ['cashier'] }),
    ]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(
      (await ctx.pool.query('select count(*)::int as n from users where email = $1', [email]))
        .rows[0].n,
    ).toBe(1);
  });

  it('without roles from the provider it still needs an existing account, as before', async () => {
    const auth = ctx.app.get(AuthService);
    await expect(
      auth.loginWithVerifiedEmail(emailOf(), `sub-${randomUUID()}`),
    ).rejects.toMatchObject({ status: 401 });
  });
});
