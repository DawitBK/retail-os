import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { parseEnv } from '@retail/kit';
import pg from 'pg';
import request from 'supertest';
import { hashPassword } from '../src/auth/auth.service.js';
import { envSchema } from '../src/config.js';
import { createApp } from '../src/create-app.js';

export const PASSWORD = 'correct horse battery staple';

export interface TestContext {
  app: INestApplication;
  pool: pg.Pool;
  http: () => ReturnType<typeof request>;
  close: () => Promise<void>;
}

export interface Session {
  id: string;
  email: string;
  token: string;
  refreshToken: string;
  auth: { Authorization: string };
}

export type StaffRole = 'owner' | 'manager' | 'accountant' | 'cashier';

export async function startContext(): Promise<TestContext> {
  const env = parseEnv(envSchema, {
    ...process.env,
    NODE_ENV: 'test',
    JWT_SECRET: 'test-secret-test-secret-test-secret-123456',
  });
  const app = await createApp(env);
  const pool = new pg.Pool({ connectionString: process.env['DATABASE_URL'], max: 3 });
  return {
    app,
    pool,
    http: () => request(app.getHttpServer()),
    close: async () => {
      await app.close();
      await pool.end();
    },
  };
}

/** Staff accounts have no public sign-up, so tests insert them directly, then sign in through the API. */
export async function makeStaff(ctx: TestContext, role: StaffRole): Promise<Session> {
  const email = `${randomUUID()}@example.test`;
  await ctx.pool.query(
    `insert into users (email, password_hash, first_name, last_name, role) values ($1, $2, 'Test', $3, $3)`,
    [email, await hashPassword(PASSWORD), role],
  );
  return signIn(ctx, email);
}

export async function signIn(ctx: TestContext, email: string): Promise<Session> {
  const res = await ctx.http().post('/api/v1/auth/login').send({ email, password: PASSWORD });
  if (res.status !== 200)
    throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return {
    id: res.body.user.id,
    email,
    token: res.body.accessToken,
    refreshToken: res.body.refreshToken,
    auth: { Authorization: `Bearer ${res.body.accessToken}` },
  };
}

export interface Staff {
  owner: Session;
  manager: Session;
  accountant: Session;
  cashier: Session;
}

export async function makeTeam(ctx: TestContext): Promise<Staff> {
  const [owner, manager, accountant, cashier] = await Promise.all([
    makeStaff(ctx, 'owner'),
    makeStaff(ctx, 'manager'),
    makeStaff(ctx, 'accountant'),
    makeStaff(ctx, 'cashier'),
  ]);
  return { owner, manager, accountant, cashier };
}

export async function makeCategory(
  ctx: TestContext,
  manager: Session,
  type: 'ELECTRONICS' | 'STATIONERY' = 'ELECTRONICS',
): Promise<string> {
  const res = await ctx
    .http()
    .post('/api/v1/categories')
    .set(manager.auth)
    .send({ name: `${type} ${randomUUID().slice(0, 8)}`, type });
  if (res.status !== 201) throw new Error(`category failed: ${res.status}`);
  return res.body.id;
}

export interface ProductInfo {
  id: string;
  sku: string;
  name: string;
  version: number;
}

export async function makeProduct(
  ctx: TestContext,
  manager: Session,
  categoryId: string,
  overrides: Record<string, unknown> = {},
): Promise<ProductInfo> {
  const tag = randomUUID().slice(0, 8);
  const res = await ctx
    .http()
    .post('/api/v1/products')
    .set(manager.auth)
    .send({
      sku: `SKU-${tag}`,
      name: `Product ${tag}`,
      categoryId,
      sellingPriceMinor: 120_000,
      ...overrides,
    });
  if (res.status !== 201)
    throw new Error(`product failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

export async function makeSupplier(ctx: TestContext, manager: Session): Promise<string> {
  const res = await ctx
    .http()
    .post('/api/v1/suppliers')
    .set(manager.auth)
    .send({ name: `Supplier ${randomUUID().slice(0, 8)}` });
  if (res.status !== 201) throw new Error(`supplier failed: ${res.status}`);
  return res.body.id;
}

export async function makeCustomer(
  ctx: TestContext,
  manager: Session,
  creditLimitMinor = 0,
): Promise<string> {
  const created = await ctx
    .http()
    .post('/api/v1/customers')
    .set(manager.auth)
    .send({ name: `Customer ${randomUUID().slice(0, 8)}` });
  if (created.status !== 201) throw new Error(`customer failed: ${created.status}`);
  if (creditLimitMinor > 0) {
    const updated = await ctx
      .http()
      .patch(`/api/v1/customers/${created.body.id}`)
      .set(manager.auth)
      .send({ version: created.body.version, creditLimitMinor });
    if (updated.status !== 200) throw new Error(`credit limit failed: ${updated.status}`);
  }
  return created.body.id;
}

/** Buy and receive stock: the only way stock gets onto the shelf besides opening balances. */
export async function stockUp(
  ctx: TestContext,
  manager: Session,
  supplierId: string,
  lines: { productId: string; quantity: number; unitCostMinor: number }[],
): Promise<{ id: string; items: { id: string; productId: string }[] }> {
  const created = await ctx
    .http()
    .post('/api/v1/purchases')
    .set(manager.auth)
    .send({
      supplierId,
      items: lines.map((l) => ({
        productId: l.productId,
        orderedQty: l.quantity,
        unitCostMinor: l.unitCostMinor,
      })),
    });
  if (created.status !== 201)
    throw new Error(`purchase failed: ${created.status} ${JSON.stringify(created.body)}`);
  const received = await ctx
    .http()
    .post(`/api/v1/purchases/${created.body.id}/receive`)
    .set(manager.auth)
    .send({
      items: created.body.items.map((i: { id: string; orderedQty: number }) => ({
        itemId: i.id,
        quantity: i.orderedQty,
      })),
    });
  if (received.status !== 200)
    throw new Error(`receive failed: ${received.status} ${JSON.stringify(received.body)}`);
  return received.body;
}

export async function getProduct(ctx: TestContext, staff: Session, id: string) {
  const res = await ctx.http().get(`/api/v1/products/${id}`).set(staff.auth);
  return res.body as {
    id: string;
    currentStock: number;
    stockValueMinor: number;
    wacMinor: number | null;
    version: number;
    negativeMargin: boolean;
  };
}

export const TODAY_RANGE = (): string => {
  const d = new Date();
  const from = new Date(d.getTime() - 3 * 86_400_000).toISOString().slice(0, 10);
  const to = new Date(d.getTime() + 3 * 86_400_000).toISOString().slice(0, 10);
  return `from=${from}&to=${to}`;
};
