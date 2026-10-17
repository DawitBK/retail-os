import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTeam, startContext, type Staff, type TestContext } from './helpers.js';

let ctx: TestContext;
let team: Staff;

beforeAll(async () => {
  ctx = await startContext();
  team = await makeTeam(ctx);
});
afterAll(async () => {
  await ctx.close();
});

const account = async (code: string) =>
  (await ctx.pool.query('select id from accounts where code = $1', [code])).rows[0].id as string;

/** Insert an entry with the given lines in one transaction and commit; resolves to the error, if any. */
async function tryCommit(
  lines: { code: string; debit: number; credit: number }[],
  total: number,
): Promise<string | null> {
  const client = await ctx.pool.connect();
  const entryId = randomUUID();
  try {
    await client.query('begin');
    await client.query(
      `insert into journal_entries (id, entry_number, entry_date, description, total_minor, created_by)
       values ($1, $2, current_date, 'guard test', $3, $4)`,
      [entryId, `JE-T-${randomUUID().slice(0, 8)}`, total, team.owner.id],
    );
    for (const l of lines) {
      await client.query(
        `insert into journal_lines (entry_id, account_id, debit_minor, credit_minor) values ($1, $2, $3, $4)`,
        [entryId, await account(l.code), l.debit, l.credit],
      );
    }
    await client.query('commit');
    return null;
  } catch (e) {
    await client.query('rollback').catch(() => undefined);
    return (e as Error).message;
  } finally {
    client.release();
  }
}

describe('the database refuses to corrupt the books', () => {
  it('accepts a balanced entry', async () => {
    expect(
      await tryCommit(
        [
          { code: '1000', debit: 500, credit: 0 },
          { code: '3000', debit: 0, credit: 500 },
        ],
        500,
      ),
    ).toBeNull();
  });

  it('rejects an entry whose debits and credits differ, at commit', async () => {
    const error = await tryCommit(
      [
        { code: '1000', debit: 500, credit: 0 },
        { code: '3000', debit: 0, credit: 499 },
      ],
      500,
    );
    expect(error).toMatch(/does not balance/);
  });

  it('rejects an entry whose stated total is not what its lines add up to', async () => {
    const error = await tryCommit(
      [
        { code: '1000', debit: 500, credit: 0 },
        { code: '3000', debit: 0, credit: 500 },
      ],
      501,
    );
    expect(error).toMatch(/does not balance/);
  });

  it('rejects an entry with no lines', async () => {
    expect(await tryCommit([], 1)).toMatch(/does not balance/);
  });

  it('rejects a line that is both a debit and a credit, or neither', async () => {
    const both = await tryCommit([{ code: '1000', debit: 1, credit: 1 }], 1);
    expect(both).toMatch(/journal_lines_one_side/);
    const neither = await tryCommit([{ code: '1000', debit: 0, credit: 0 }], 1);
    expect(neither).toMatch(/journal_lines_one_side/);
  });

  it('never lets a posted line or entry be edited or deleted, or the tables truncated', async () => {
    await expect(
      ctx.pool.query('update journal_lines set debit_minor = debit_minor + 1'),
    ).rejects.toThrow(/append-only/);
    await expect(ctx.pool.query('delete from journal_lines')).rejects.toThrow(/append-only/);
    await expect(ctx.pool.query('truncate journal_lines')).rejects.toThrow(/append-only/);
    await expect(
      ctx.pool.query(`update journal_entries set description = 'edited'`),
    ).rejects.toThrow(/immutable once posted/);
    await expect(ctx.pool.query('delete from journal_entries')).rejects.toThrow(/append-only/);
    await expect(ctx.pool.query('truncate journal_entries cascade')).rejects.toThrow(/append-only/);
    await expect(
      ctx.pool.query(`update journal_entries set status = 'VOIDED' where status = 'POSTED'`),
    ).rejects.toThrow(/immutable once posted/); // a void must say who and when
  });
});

describe('the chart of accounts', () => {
  it('is seeded with every account the application posts to', async () => {
    const { rows } = await ctx.pool.query(
      'select code, type, normal_balance from accounts order by code',
    );
    const byCode = new Map(rows.map((r) => [r.code as string, r]));
    for (const code of [
      '1000',
      '1010',
      '1100',
      '1200',
      '2000',
      '3000',
      '4000',
      '4010',
      '5000',
      '5010',
    ]) {
      expect(byCode.has(code), code).toBe(true);
    }
    expect(byCode.get('1200')).toMatchObject({ type: 'ASSET', normal_balance: 'DEBIT' });
    expect(byCode.get('2000')).toMatchObject({ type: 'LIABILITY', normal_balance: 'CREDIT' });
    expect(byCode.get('4100')).toMatchObject({ type: 'REVENUE', normal_balance: 'DEBIT' }); // a contra account
    expect(rows.length).toBeGreaterThanOrEqual(30);
  });
});
