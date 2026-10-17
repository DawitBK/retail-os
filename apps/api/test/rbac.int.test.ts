import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  makeCategory,
  makeProduct,
  makeSupplier,
  makeTeam,
  startContext,
  type Staff,
  type TestContext,
} from './helpers.js';

let ctx: TestContext;
let team: Staff;
let categoryId: string;
let productId: string;
let supplierId: string;

beforeAll(async () => {
  ctx = await startContext();
  team = await makeTeam(ctx);
  categoryId = await makeCategory(ctx, team.manager);
  productId = (await makeProduct(ctx, team.manager, categoryId)).id;
  supplierId = await makeSupplier(ctx, team.manager);
});
afterAll(async () => {
  await ctx.close();
});

type Role = keyof Staff;
type Verdict = Partial<Record<Role, 'allow' | 'deny'>>;

const ALL_ALLOW: Verdict = {
  owner: 'allow',
  manager: 'allow',
  accountant: 'allow',
  cashier: 'allow',
};

/**
 * One row per endpoint: who may call it. A request that is refused must answer 403 (the
 * permission check runs before validation); one that is allowed must not (it may still be a
 * 4xx for the dummy body, but never a permission failure).
 */
const MATRIX: {
  name: string;
  method: 'get' | 'post' | 'patch' | 'delete';
  path: () => string;
  body?: unknown;
  who: Verdict;
}[] = [
  { name: 'read the catalogue', method: 'get', path: () => '/api/v1/products', who: ALL_ALLOW },
  {
    name: 'create a product',
    method: 'post',
    path: () => '/api/v1/products',
    body: {},
    who: { owner: 'allow', manager: 'allow', accountant: 'deny', cashier: 'deny' },
  },
  {
    name: 'edit a product',
    method: 'patch',
    path: () => `/api/v1/products/${productId}`,
    body: {},
    who: { owner: 'allow', manager: 'allow', accountant: 'deny', cashier: 'deny' },
  },
  {
    name: 'read product movements',
    method: 'get',
    path: () => `/api/v1/products/${productId}/movements`,
    who: { owner: 'allow', manager: 'allow', accountant: 'allow', cashier: 'deny' },
  },
  {
    name: 'create a customer',
    method: 'post',
    path: () => '/api/v1/customers',
    body: {},
    who: ALL_ALLOW,
  },
  {
    name: 'edit a customer (credit limit)',
    method: 'patch',
    path: () => `/api/v1/customers/${randomUUID()}`,
    body: {},
    who: { owner: 'allow', manager: 'allow', accountant: 'deny', cashier: 'deny' },
  },
  {
    name: 'read suppliers',
    method: 'get',
    path: () => '/api/v1/suppliers',
    who: { owner: 'allow', manager: 'allow', accountant: 'allow', cashier: 'deny' },
  },
  {
    name: 'create a supplier',
    method: 'post',
    path: () => '/api/v1/suppliers',
    body: {},
    who: { owner: 'allow', manager: 'allow', accountant: 'deny', cashier: 'deny' },
  },
  {
    name: 'ring up a sale',
    method: 'post',
    path: () => '/api/v1/sales',
    body: {},
    who: { owner: 'allow', manager: 'allow', accountant: 'deny', cashier: 'allow' },
  },
  { name: 'list sales', method: 'get', path: () => '/api/v1/sales', who: ALL_ALLOW },
  {
    name: 'void a sale',
    method: 'post',
    path: () => `/api/v1/sales/${randomUUID()}/void`,
    body: {},
    who: { owner: 'allow', manager: 'allow', accountant: 'deny', cashier: 'deny' },
  },
  {
    name: 'order stock',
    method: 'post',
    path: () => '/api/v1/purchases',
    body: {},
    who: { owner: 'allow', manager: 'allow', accountant: 'deny', cashier: 'deny' },
  },
  {
    name: 'read purchases',
    method: 'get',
    path: () => '/api/v1/purchases',
    who: { owner: 'allow', manager: 'allow', accountant: 'allow', cashier: 'deny' },
  },
  {
    name: 'receive goods',
    method: 'post',
    path: () => `/api/v1/purchases/${randomUUID()}/receive`,
    body: {},
    who: { owner: 'allow', manager: 'allow', accountant: 'deny', cashier: 'deny' },
  },
  {
    name: 'pay a supplier',
    method: 'post',
    path: () => `/api/v1/purchases/${randomUUID()}/payments`,
    body: {},
    who: { owner: 'allow', manager: 'allow', accountant: 'allow', cashier: 'deny' },
  },
  {
    name: 'read the books',
    method: 'get',
    path: () => '/api/v1/accounting/accounts',
    who: { owner: 'allow', manager: 'allow', accountant: 'allow', cashier: 'deny' },
  },
  {
    name: 'read the journal',
    method: 'get',
    path: () => '/api/v1/accounting/journal',
    who: { owner: 'allow', manager: 'allow', accountant: 'allow', cashier: 'deny' },
  },
  {
    name: 'read inventory valuation',
    method: 'get',
    path: () => '/api/v1/inventory/valuation',
    who: { owner: 'allow', manager: 'allow', accountant: 'allow', cashier: 'deny' },
  },
  {
    name: 'record an expense',
    method: 'post',
    path: () => '/api/v1/expenses',
    body: {},
    who: { owner: 'allow', manager: 'allow', accountant: 'allow', cashier: 'deny' },
  },
  {
    name: 'void an expense',
    method: 'post',
    path: () => `/api/v1/expenses/${randomUUID()}/void`,
    body: {},
    who: { owner: 'allow', manager: 'allow', accountant: 'deny', cashier: 'deny' },
  },
  {
    name: 'open the books',
    method: 'post',
    path: () => '/api/v1/opening-balances',
    body: {},
    who: { owner: 'allow', manager: 'deny', accountant: 'deny', cashier: 'deny' },
  },
  {
    name: 'manage staff',
    method: 'get',
    path: () => '/api/v1/staff',
    who: { owner: 'allow', manager: 'deny', accountant: 'deny', cashier: 'deny' },
  },
];

describe('the permission matrix', () => {
  for (const row of MATRIX) {
    it(`${row.name}`, async () => {
      for (const role of ['owner', 'manager', 'accountant', 'cashier'] as const) {
        const req = ctx.http()[row.method](row.path()).set(team[role].auth);
        const res = row.body === undefined ? await req : await req.send(row.body as object);
        const verdict = row.who[role];
        if (verdict === 'deny') {
          expect(res.status, `${role} should be refused`).toBe(403);
        } else {
          expect(res.status, `${role} should pass the permission check`).not.toBe(403);
          expect(res.status, `${role} should be signed in`).not.toBe(401);
        }
      }
      // Nobody anonymous gets anywhere.
      const anon = ctx.http()[row.method](row.path());
      expect(
        (row.body === undefined ? await anon : await anon.send(row.body as object)).status,
      ).toBe(401);
    });
  }

  it('lets the owner create and manage staff, and nobody else', async () => {
    const created = await ctx
      .http()
      .post('/api/v1/staff')
      .set(team.owner.auth)
      .send({
        email: `${randomUUID()}@example.test`,
        password: 'correct horse battery staple',
        firstName: 'New',
        lastName: 'Hire',
        role: 'accountant',
      });
    expect(created.status).toBe(201);
    expect(created.body.role).toBe('accountant');
    const asManager = await ctx
      .http()
      .post('/api/v1/staff')
      .set(team.manager.auth)
      .send({
        email: `${randomUUID()}@example.test`,
        password: 'correct horse battery staple',
        firstName: 'New',
        lastName: 'Hire',
        role: 'owner',
      });
    expect(asManager.status).toBe(403);
    expect(supplierId).toBeTruthy();
  });
});
