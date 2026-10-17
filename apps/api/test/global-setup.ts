import pg from 'pg';
import { runMigrations } from '../src/db/migrate.js';

/**
 * PostgreSQL 18 (what CI and production run) has `uuidv7()` built in. On an older local server the
 * same function is defined here so the suite can run, with the same behaviour for the tests' purposes.
 */
const UUIDV7_SHIM = `
create or replace function uuidv7() returns uuid language sql volatile as $$
  select encode(
    set_bit(
      set_bit(
        overlay(uuid_send(gen_random_uuid()) placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3) from 1 for 6),
        52, 1),
      53, 1),
    'hex')::uuid
$$`;

/**
 * The books cannot be truncated (that is the point), and "open the books" works once per database,
 * so the test database is dropped and recreated for every run. It must be named `*_test`.
 */
async function recreate(url: string): Promise<void> {
  const target = new URL(url);
  const name = decodeURIComponent(target.pathname.slice(1));
  if (!/_test$/.test(name)) {
    throw new Error(
      `Refusing to recreate "${name}": the integration test database must end in _test`,
    );
  }
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    await client.query(
      `select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`,
      [name],
    );
    await client.query(`drop database if exists "${name}"`);
    await client.query(`create database "${name}"`);
  } finally {
    await client.end();
  }
}

export default async function setup(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url) {
    throw new Error(
      'DATABASE_URL is required for integration tests. Start PostgreSQL with `pnpm db:up` and set ' +
        'DATABASE_URL=postgres://retail:retail@localhost:5432/retail_test',
    );
  }
  await recreate(url);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query<{ v: number }>(
      `select current_setting('server_version_num')::int as v`,
    );
    if ((rows[0]?.v ?? 0) < 180000) await client.query(UUIDV7_SHIM);
  } finally {
    await client.end();
  }
  await runMigrations(url);
}
