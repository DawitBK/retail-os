/**
 * End-to-end smoke test of the whole stack as a person would use it: a real PostgreSQL database,
 * the built API, the built web app, and HTTP between them. It follows one shop day: set up the
 * catalogue, buy stock, sell it at the till (twice with one idempotency key), then read the sale
 * and the books back through the web pages, and check a cashier cannot do a manager's work.
 *
 *   DATABASE_URL=postgres://user:pass@host:5432/retail_smoke node scripts/smoke.mjs
 *
 * Needs `pnpm build` first. The database name must end in `_smoke`; it is dropped and recreated.
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pg = createRequire(path.join(root, 'apps/api/package.json'))('pg');
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const dbName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
if (!dbName.endsWith('_smoke'))
  throw new Error(`Refusing to recreate "${dbName}": it must end in _smoke`);

const API_PORT = 3100;
const WEB_PORT = 3101;
const API = `http://127.0.0.1:${API_PORT}`;
const WEB = `http://127.0.0.1:${WEB_PORT}`;
const OWNER = { email: 'owner@smoke.test', password: 'a long smoke passphrase' };
const CASHIER = { email: 'cashier@smoke.test', password: 'another long smoke passphrase' };

const children = [];
let failures = 0;
const results = [];

function check(name, ok, detail = '') {
  results.push({ name, ok });
  if (!ok) failures += 1;
  process.stdout.write(
    `${ok ? '  ok  ' : ' FAIL '} ${name}${ok || !detail ? '' : `  -> ${detail}`}\n`,
  );
}

function run(file, args, env) {
  const r = spawnSync(process.execPath, [file, ...args], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`${file} failed:\n${r.stdout}\n${r.stderr}`);
}

function start(name, file, args, env, cwd = root) {
  const child = spawn(process.execPath, [file, ...args], {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  child.on('exit', (code) => {
    if (code && code !== 0 && code !== null)
      process.stdout.write(`${name} exited ${code}\n${log.slice(-2000)}\n`);
  });
  children.push(child);
  return () => log;
}

async function waitFor(url, label, ms = 60_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const res = await fetch(url, { redirect: 'manual' });
      if (res.status < 500) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${label} did not come up at ${url}`);
}

async function recreateDatabase() {
  const admin = new URL(databaseUrl);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    await client.query(
      'select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()',
      [dbName],
    );
    await client.query(`drop database if exists "${dbName}"`);
    await client.query(`create database "${dbName}"`);
  } finally {
    await client.end();
  }
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const { rows } = await db.query("select current_setting('server_version_num')::int as v");
    if (rows[0].v < 180000) {
      // PostgreSQL 18 has uuidv7(); an older local server gets an equivalent for the smoke run.
      await db.query(`create or replace function uuidv7() returns uuid language sql volatile as $$
        select encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid()) placing
          substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3) from 1 for 6), 52, 1), 53, 1), 'hex')::uuid $$`);
    }
  } finally {
    await db.end();
  }
}

async function api(method, p, { token, body, headers } = {}) {
  const res = await fetch(`${API}/api/v1${p}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : undefined };
}

/** A person's browser: a cookie jar that follows what the web server sets. */
function browser(initial) {
  const jar = new Map(Object.entries(initial));
  const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const absorb = (res) => {
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const i = pair.indexOf('=');
      jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
  };
  return {
    jar,
    async get(p) {
      const res = await fetch(`${WEB}${p}`, {
        redirect: 'manual',
        headers: { cookie: cookieHeader() },
      });
      absorb(res);
      return {
        status: res.status,
        location: res.headers.get('location'),
        text: await res.text(),
        res,
      };
    },
    async bff(method, p, body, headers = {}) {
      const res = await fetch(`${WEB}/bff${p}`, {
        method,
        headers: {
          cookie: cookieHeader(),
          ...(body ? { 'content-type': 'application/json' } : {}),
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      absorb(res);
      const text = await res.text();
      return { status: res.status, json: text ? JSON.parse(text) : undefined };
    },
  };
}

const sessionFor = async (creds) => {
  const r = await api('POST', '/auth/login', { body: creds });
  if (r.status !== 200) throw new Error(`login failed: ${r.status} ${JSON.stringify(r.json)}`);
  return r.json;
};

async function main() {
  process.stdout.write(`Smoke test against ${dbName}\n`);
  await recreateDatabase();
  const apiEnv = {
    DATABASE_URL: databaseUrl,
    JWT_SECRET: randomBytes(32).toString('hex'),
    PORT: String(API_PORT),
    NODE_ENV: 'production',
    LOG_LEVEL: 'warn',
  };
  run('apps/api/dist/db/migrate.js', [], apiEnv);
  run('apps/api/dist/bootstrap-admin.js', [], {
    ...apiEnv,
    OWNER_EMAIL: OWNER.email,
    OWNER_PASSWORD: OWNER.password,
  });
  start('api', 'apps/api/dist/main.js', [], apiEnv);
  await waitFor(`${API}/health/ready`, 'API');
  const nextBin = path.join(root, 'apps/web/node_modules/next/dist/bin/next');
  start(
    'web',
    nextBin,
    ['start', '--port', String(WEB_PORT), '--hostname', '127.0.0.1'],
    {
      API_URL: API,
      NODE_ENV: 'production',
    },
    path.join(root, 'apps/web'),
  );
  await waitFor(`${WEB}/login`, 'web app');

  // --- the front door
  const anon = browser({});
  const login = await anon.get('/login');
  check('the sign-in page is public', login.status === 200 && login.text.includes('Sign in'));
  const guarded = await anon.get('/till');
  check(
    'a page without a session redirects to sign-in',
    guarded.status === 307 && guarded.location?.endsWith('/login'),
    `${guarded.status} ${guarded.location}`,
  );
  const bffAnon = await anon.bff('GET', '/products');
  check('the API door refuses without a session', bffAnon.status === 401);

  // --- the owner's session: only the refresh cookie survives, the proxy renews the rest
  const owner = await sessionFor(OWNER);
  const o = browser({ ros_refresh: owner.refreshToken });
  const home = await o.get('/');
  check(
    'an expired access token is renewed by the proxy',
    home.status === 200 && o.jar.has('ros_access'),
    `${home.status}`,
  );
  check('the dashboard renders', home.text.includes('Sales today'));
  const staffPage = await o.get('/staff');
  check('the owner sees staff', staffPage.status === 200 && staffPage.text.includes('Add staff'));

  // --- one shop day through the same door the browser uses
  const category = await o.bff('POST', '/categories', { name: 'Phones', type: 'ELECTRONICS' });
  check('create a category', category.status === 201, JSON.stringify(category.json));
  const product = await o.bff('POST', '/products', {
    sku: 'PH-001',
    barcode: '6001234567890',
    name: 'Smoke Phone',
    categoryId: category.json?.id,
    sellingPriceMinor: 1_500_00,
    reorderPoint: 2,
    reorderQty: 5,
  });
  check('create a product', product.status === 201, JSON.stringify(product.json));
  const supplier = await o.bff('POST', '/suppliers', {
    name: 'Smoke Supplier',
    paymentTermsDays: 0,
  });
  check('create a supplier', supplier.status === 201);
  const order = await o.bff('POST', '/purchases', {
    supplierId: supplier.json?.id,
    items: [{ productId: product.json?.id, orderedQty: 10, unitCostMinor: 1_000_00 }],
  });
  check('place a purchase order', order.status === 201, JSON.stringify(order.json));
  const received = await o.bff('POST', `/purchases/${order.json?.id}/receive`, {
    items: [{ itemId: order.json?.items?.[0]?.id, quantity: 10 }],
  });
  check(
    'receive the goods',
    received.status === 201 || received.status === 200,
    JSON.stringify(received.json),
  );

  const key = 'smoke-sale-1';
  const sale = {
    paymentMethod: 'CASH',
    amountPaidMinor: 3_000_00,
    items: [{ productId: product.json?.id, quantity: 2 }],
  };
  const first = await o.bff('POST', '/sales', sale, { 'idempotency-key': key });
  const second = await o.bff('POST', '/sales', sale, { 'idempotency-key': key });
  check(
    'a sale at the till',
    first.status === 201 && first.json?.totalMinor === 3_000_00,
    JSON.stringify(first.json),
  );
  check('the same idempotency key replays the same sale', second.json?.id === first.json?.id);
  const scan = await o.bff('GET', '/products?q=6001234567890&status=ACTIVE');
  check(
    'a barcode scan finds the product and stock fell to 8',
    scan.json?.items?.[0]?.currentStock === 8,
    JSON.stringify(scan.json?.items?.[0]),
  );

  const salePage = await o.get(`/sales/${first.json?.id}`);
  check(
    'the sale page shows the receipt',
    salePage.status === 200 && salePage.text.includes(first.json?.number),
  );
  const tb = await o.get('/accounting?view=trial-balance');
  check('the trial balance balances', tb.text.includes('Debits equal credits'));
  const val = await o.get('/accounting?view=valuation');
  check('stock agrees with the inventory account', val.text.includes('agree exactly'));
  const bs = await o.get('/accounting?view=balance-sheet');
  check('the balance sheet balances', bs.text.includes('Balanced'));
  const pl = await o.get('/accounting');
  check(
    'profit and loss shows the gross profit',
    pl.status === 200 && pl.text.includes('Gross profit'),
  );
  for (const p of [
    '/till',
    '/products',
    '/sales',
    '/customers',
    '/suppliers',
    '/purchases',
    '/alerts',
    '/damage',
    '/stock-audits',
    '/accounting/journal',
    '/accounting/expenses',
    '/products/setup',
  ]) {
    const r = await o.get(p);
    check(`page ${p} renders for the owner`, r.status === 200, `${r.status}`);
  }

  // --- a cashier is not a manager
  const staff = await o.bff('POST', '/staff', {
    ...CASHIER,
    firstName: 'Cash',
    lastName: 'Ier',
    role: 'cashier',
  });
  check('the owner creates a cashier', staff.status === 201, JSON.stringify(staff.json));
  const cashierSession = await sessionFor(CASHIER);
  const c = browser({ ros_refresh: cashierSession.refreshToken });
  const cHome = await c.get('/');
  check(
    'a cashier landing on the dashboard is sent to the till',
    cHome.status === 307 && cHome.location?.endsWith('/till'),
    `${cHome.status} ${cHome.location}`,
  );
  const cStaff = await c.get('/staff');
  check('a cashier cannot open staff', cStaff.status === 307, `${cStaff.status}`);
  const cProduct = await c.bff('POST', '/products', {
    sku: 'X',
    name: 'X',
    categoryId: category.json?.id,
    sellingPriceMinor: 1,
  });
  check(
    'the API refuses a cashier creating a product',
    cProduct.status === 403,
    `${cProduct.status}`,
  );
  const cSale = await c.bff(
    'POST',
    '/sales',
    { paymentMethod: 'CASH', items: [{ productId: product.json?.id, quantity: 1 }] },
    { 'idempotency-key': 'smoke-sale-2' },
  );
  check('a cashier can sell', cSale.status === 201, JSON.stringify(cSale.json));
  const cDiscount = await c.bff(
    'POST',
    '/sales',
    {
      paymentMethod: 'CASH',
      items: [{ productId: product.json?.id, quantity: 1, unitPriceMinor: 1 }],
    },
    { 'idempotency-key': 'smoke-sale-3' },
  );
  check('a cashier cannot change the price', cDiscount.status === 403, `${cDiscount.status}`);
}

try {
  await main();
} catch (e) {
  failures += 1;
  process.stdout.write(`\nSmoke test crashed: ${e.stack ?? e}\n`);
} finally {
  for (const c of children) c.kill();
  process.stdout.write(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed\n`);
  process.exit(failures ? 1 : 0);
}
