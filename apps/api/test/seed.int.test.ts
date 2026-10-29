import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AccountingService } from '../src/accounting/accounting.service.js';
import { hashPassword } from '../src/auth/auth.service.js';
import { addDays, businessDate, configureTimezone } from '../src/common/time.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedDemo, type SeedReport } from '../src/seed/demo.js';

/**
 * The demo seed replays months of trading through the real services. It runs in a database of its
 * own so the numbers can be compared with independent SQL without the other suites' data in the way.
 */
const DAYS = 70;
let admin: pg.Pool;
let pool: pg.Pool;
let app: INestApplicationContext;
let first: SeedReport;

const base = new URL(process.env['DATABASE_URL']!);
const NAME = 'retail_seed_test';
const urlFor = (db: string) => {
  const u = new URL(base);
  u.pathname = `/${db}`;
  return u.toString();
};
const scalar = async (text: string, values: unknown[] = []) =>
  (await pool.query(text, values)).rows[0];

beforeAll(async () => {
  admin = new pg.Pool({ connectionString: urlFor('postgres'), max: 1 });
  await admin.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname = $1`, [
    NAME,
  ]);
  await admin.query(`drop database if exists "${NAME}"`);
  await admin.query(`create database "${NAME}"`);
  const version = (await admin.query(`select current_setting('server_version_num')::int as v`))
    .rows[0].v;
  pool = new pg.Pool({ connectionString: urlFor(NAME), max: 3 });
  if (version < 180000) {
    await pool.query(`create or replace function uuidv7() returns uuid language sql volatile as $$
      select encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid()) placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3) from 1 for 6), 52, 1), 53, 1), 'hex')::uuid $$`);
  }
  await runMigrations(urlFor(NAME));
  await pool.query(
    `insert into users (email, password_hash, first_name, last_name, role) values ('owner@seed.test', $1, 'Seed', 'Owner', 'owner')`,
    [await hashPassword('correct horse battery staple')],
  );
  configureTimezone('Africa/Addis_Ababa');
  app = await NestFactory.createApplicationContext(
    AppModule.register(urlFor(NAME), {
      jwtSecret: 'test-secret-test-secret-test-secret-123456',
      accessTtlSeconds: 900,
      refreshTtlSeconds: 86400,
    }),
    { logger: false },
  );
  first = await seedDemo(app, {
    days: DAYS,
    log: () => undefined,
    staffPassword: 'a long staff passphrase',
    staffEmailDomain: 'seed.test',
  });
}, 280_000);

afterAll(async () => {
  await app?.close();
  await pool?.end();
  await admin?.end();
});

describe('the demo seed', () => {
  it('replays the trading days and every consistency check passes', () => {
    expect(first.alreadySeeded).toBe(false);
    for (const c of first.checks) expect(c, c.name).toMatchObject({ ok: true });
    expect(first.counts['sales']).toBeGreaterThan(300);
    expect(first.counts['purchaseOrders']).toBeGreaterThan(5);
    expect(first.counts['skipped']).toBe(0);
  });

  it('covers the lifecycle states, not just completed sales', async () => {
    const states = await scalar(`select
      (select count(*)::int from sales where status = 'VOIDED') as voided,
      (select count(*)::int from sale_returns) as sale_returns,
      (select count(*)::int from purchase_returns) as purchase_returns,
      (select count(*)::int from damage_records where status = 'PENDING') as pending_damage,
      (select count(*)::int from damage_records where status = 'APPROVED') as approved_damage,
      (select count(*)::int from stock_audits where status = 'IN_PROGRESS') as audit_open,
      (select count(*)::int from stock_audits where status = 'APPROVED') as audit_done,
      (select count(*)::int from sales where payment_method = 'CREDIT' and total_minor > amount_paid_minor and status = 'COMPLETED') as owed_by_customers,
      (select count(*)::int from purchases where received_value_minor > paid_minor) as owed_to_suppliers,
      (select count(*)::int from purchases where status = 'ORDERED') as on_order,
      (select count(*)::int from products where current_stock > 0 and current_stock <= reorder_point) as low,
      (select count(*)::int from products where selling_price_minor * current_stock < stock_value_minor and current_stock > 0) as below_cost,
      (select count(distinct payment_method)::int from sales) as payment_methods,
      (select count(*)::int from expenses) as expenses`);
    expect(states.voided).toBeGreaterThan(0);
    expect(states.sale_returns).toBeGreaterThan(0);
    expect(states.pending_damage).toBeGreaterThan(0);
    expect(states.approved_damage).toBeGreaterThan(0);
    expect(states.audit_open).toBe(1);
    expect(states.audit_done).toBe(1);
    expect(states.owed_by_customers).toBeGreaterThan(0);
    expect(states.owed_to_suppliers).toBeGreaterThan(0);
    expect(states.on_order).toBeGreaterThan(0);
    expect(states.low).toBeGreaterThan(0);
    expect(states.below_cost).toBeGreaterThan(0);
    expect(states.payment_methods).toBe(4);
    expect(states.expenses).toBeGreaterThan(10);
  });

  it('dates the history across the whole period, in order, never in the future', async () => {
    const today = businessDate();
    const range = await scalar(
      `select min((sale_date at time zone 'Africa/Addis_Ababa')::date)::text as first, max((sale_date at time zone 'Africa/Addis_Ababa')::date)::text as last from sales`,
    );
    expect(range.first).toBe(addDays(today, -(DAYS - 1)));
    expect(range.last <= today).toBe(true);
    const future = await scalar(`select count(*)::int as n from sales where sale_date > now()`);
    expect(future.n).toBe(0);
    const order = await scalar(
      `select count(*)::int as n from (select sale_date, lag(sale_date) over (order by number) as prev from sales) t where prev > sale_date`,
    );
    expect(order.n).toBe(0);
    const entries = await scalar(
      `select count(*)::int as n from journal_entries e join sales s on s.journal_entry_id = e.id where e.entry_date <> (s.sale_date at time zone 'Africa/Addis_Ababa')::date`,
    );
    expect(entries.n).toBe(0);
  });

  it('agrees with independent calculations: revenue, stock and the ledger', async () => {
    const accounting = app.get(AccountingService);
    const from = addDays(businessDate(), -DAYS);
    const to = businessDate();
    const pnl = await accounting.profitLoss({ from, to });
    const completed = await scalar(
      `select coalesce(sum(total_minor), 0)::bigint as n from sales where status = 'COMPLETED'`,
    );
    const refunds = await scalar(
      `select coalesce(sum(refund_minor), 0)::bigint as n from sale_returns`,
    );
    expect(pnl.netRevenueMinor).toBe(Number(completed.n) - Number(refunds.n));
    // every product's stock equals the sum of its movements
    const drift =
      await scalar(`select count(*)::int as n from products p where p.current_stock <> coalesce((
      select sum(case when m.movement_type in ('OPENING_BALANCE','PURCHASE_RECEIPT','SALE_VOID','SALE_RETURN','STOCK_ADJUSTMENT_INCREASE') then m.quantity else -m.quantity end)
        from inventory_movements m where m.product_id = p.id), 0)`);
    expect(drift.n).toBe(0);
    const valueDrift = await scalar(
      `select count(*)::int as n from products p where p.stock_value_minor <> coalesce((select sum(m.value_delta_minor) from inventory_movements m where m.product_id = p.id), 0)`,
    );
    expect(valueDrift.n).toBe(0);
    // what customers owe and suppliers are owed, from the records themselves
    const receivables = await accounting.balanceSheet({ asOf: to });
    const ar = receivables.assets.find((l) => l.code === '1100')?.amountMinor ?? 0;
    const owedByCustomers = await scalar(
      `select coalesce(sum(total_minor - amount_paid_minor), 0)::bigint as n from sales where status = 'COMPLETED' and payment_method = 'CREDIT'`,
    );
    expect(ar).toBe(Number(owedByCustomers.n));
    const ap = receivables.liabilities.find((l) => l.code === '2000')?.amountMinor ?? 0;
    const owedToSuppliers = await scalar(
      `select coalesce(sum(received_value_minor - paid_minor), 0)::bigint as n from purchases where status <> 'CANCELLED'`,
    );
    expect(ap).toBe(Number(owedToSuppliers.n));
  });

  it('marks every record it made as demo data', async () => {
    for (const table of ['customers', 'suppliers']) {
      const n = await scalar(
        `select count(*)::int as n from ${table} where notes is distinct from 'Demo data'`,
      );
      expect(n.n, table).toBe(0);
    }
    const sales = await scalar(
      `select count(*)::int as n from sales where notes is distinct from 'Demo data'`,
    );
    expect(sales.n).toBe(0);
  });

  it('is safe to run again: nothing is added', async () => {
    const count = async () =>
      await scalar(
        `select (select count(*) from sales)::int as s, (select count(*) from purchases)::int as p, (select count(*) from journal_entries)::int as j, (select count(*) from products)::int as pr, (select count(*) from expenses)::int as e`,
      );
    const before = await count();
    const again = await seedDemo(app, {
      days: DAYS,
      log: () => undefined,
      staffEmailDomain: 'seed.test',
    });
    expect(again.alreadySeeded).toBe(true);
    expect(await count()).toEqual(before);
  });
});
