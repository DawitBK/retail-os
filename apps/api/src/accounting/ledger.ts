import { ProblemException, unprocessable } from '@retail/kit';
import { eq, inArray, sql } from 'drizzle-orm';
import type { Tx } from '../db/db.module.js';
import { accounts, journalEntries, journalLines } from '../db/schema.js';

/** The chart-of-accounts codes the application posts to. The rest of the chart is data. */
export const ACCOUNT = {
  CASH: '1000',
  BANK: '1010',
  RECEIVABLE: '1100',
  INVENTORY: '1200',
  PAYABLE: '2000',
  CAPITAL: '3000',
  RETAINED_EARNINGS: '3100',
  DRAWINGS: '3200',
  REVENUE_ELECTRONICS: '4000',
  REVENUE_STATIONERY: '4010',
  COGS_ELECTRONICS: '5000',
  COGS_STATIONERY: '5010',
} as const;

/** Expense accounts a person may book an expense to (losses are posted by the system, not typed in). */
export const EXPENSE_ACCOUNTS = ['6000', '6010', '6020', '6030', '6040', '6050', '6900'] as const;

type CategoryType = 'ELECTRONICS' | 'STATIONERY';

export const revenueAccount = (type: CategoryType) =>
  type === 'ELECTRONICS' ? ACCOUNT.REVENUE_ELECTRONICS : ACCOUNT.REVENUE_STATIONERY;
export const cogsAccount = (type: CategoryType) =>
  type === 'ELECTRONICS' ? ACCOUNT.COGS_ELECTRONICS : ACCOUNT.COGS_STATIONERY;

/** Where money paid by a given method physically sits. Mobile money is reconciled with the bank. */
export const settlementAccount = (method: 'CASH' | 'BANK_TRANSFER' | 'MOBILE_MONEY'): string =>
  method === 'CASH' ? ACCOUNT.CASH : ACCOUNT.BANK;

export interface JournalLineInput {
  accountCode: string;
  debitMinor?: number;
  creditMinor?: number;
  description?: string;
}

export interface PostedEntry {
  id: string;
  entryNumber: string;
}

const isMinor = (n: number | undefined) => n === undefined || (Number.isSafeInteger(n) && n >= 0);

/**
 * The only function that writes journal entries. It refuses an entry that does not balance, and
 * the database refuses it again at commit, so a bug here still cannot corrupt the books.
 * Lines on the same account and side are merged; zero lines are dropped.
 */
export async function postJournalEntry(
  tx: Tx,
  params: {
    date: string;
    description: string;
    referenceType?: string;
    referenceId?: string;
    lines: JournalLineInput[];
    createdBy: string;
    reversesEntryId?: string;
  },
): Promise<PostedEntry> {
  const merged = new Map<string, { code: string; debit: number; credit: number }>();
  for (const line of params.lines) {
    if (!isMinor(line.debitMinor) || !isMinor(line.creditMinor)) {
      throw new Error(`Journal line for ${line.accountCode} is not a whole non-negative amount`);
    }
    const debit = line.debitMinor ?? 0;
    const credit = line.creditMinor ?? 0;
    if (debit === 0 && credit === 0) continue;
    if (debit > 0 && credit > 0) {
      throw new Error(`Journal line for ${line.accountCode} has both a debit and a credit`);
    }
    const key = `${line.accountCode}:${debit > 0 ? 'D' : 'C'}`;
    const existing = merged.get(key);
    if (existing) {
      existing.debit += debit;
      existing.credit += credit;
    } else {
      merged.set(key, { code: line.accountCode, debit, credit });
    }
  }
  const entries = [...merged.values()];
  if (entries.length < 2) throw new Error('A journal entry needs at least two lines');

  const totalDebit = entries.reduce((s, l) => s + BigInt(l.debit), 0n);
  const totalCredit = entries.reduce((s, l) => s + BigInt(l.credit), 0n);
  if (totalDebit !== totalCredit) {
    throw new Error(
      `Unbalanced journal entry: debits ${totalDebit} differ from credits ${totalCredit}`,
    );
  }

  const codes = [...new Set(entries.map((l) => l.code))];
  const rows = await tx
    .select({ id: accounts.id, code: accounts.code, isActive: accounts.isActive })
    .from(accounts)
    .where(inArray(accounts.code, codes));
  const byCode = new Map(rows.map((r) => [r.code, r]));
  for (const code of codes) {
    const account = byCode.get(code);
    if (!account) throw new Error(`Account ${code} does not exist`);
    if (!account.isActive) {
      throw unprocessable(
        'account-inactive',
        'Account is inactive',
        `Account ${code} cannot be posted to`,
      );
    }
  }

  const seq = await tx.execute<{ n: string }>(sql`select nextval('journal_number_seq') as n`);
  const entryNumber = `JE-${String(seq.rows[0]!.n).padStart(6, '0')}`;
  const [entry] = await tx
    .insert(journalEntries)
    .values({
      entryNumber,
      entryDate: params.date,
      description: params.description,
      referenceType: params.referenceType ?? null,
      referenceId: params.referenceId ?? null,
      totalMinor: Number(totalDebit),
      createdBy: params.createdBy,
      reversesEntryId: params.reversesEntryId ?? null,
    })
    .returning({ id: journalEntries.id });
  await tx.insert(journalLines).values(
    entries.map((l) => ({
      entryId: entry!.id,
      accountId: byCode.get(l.code)!.id,
      debitMinor: l.debit,
      creditMinor: l.credit,
    })),
  );
  return { id: entry!.id, entryNumber };
}

/**
 * Void an entry the only way books allow: post an exact mirror image and mark the original
 * VOIDED. Both entries stay, so reports always add up and the history is whole.
 */
export async function voidJournalEntry(
  tx: Tx,
  entryId: string,
  by: { userId: string; date: string; reason: string },
): Promise<PostedEntry> {
  const [entry] = await tx
    .select()
    .from(journalEntries)
    .where(eq(journalEntries.id, entryId))
    .for('update');
  if (!entry) throw new Error(`Journal entry ${entryId} does not exist`);
  if (entry.status === 'VOIDED') {
    throw new ProblemException(409, 'entry-already-voided', 'Entry is already voided');
  }
  const lines = await tx
    .select({
      code: accounts.code,
      debit: journalLines.debitMinor,
      credit: journalLines.creditMinor,
    })
    .from(journalLines)
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(eq(journalLines.entryId, entryId));
  const reversal = await postJournalEntry(tx, {
    date: by.date,
    description: `Reversal of ${entry.entryNumber}: ${by.reason}`,
    referenceType: 'REVERSAL',
    referenceId: entry.id,
    createdBy: by.userId,
    reversesEntryId: entry.id,
    lines: lines.map((l) => ({
      accountCode: l.code,
      debitMinor: l.credit,
      creditMinor: l.debit,
    })),
  });
  await tx
    .update(journalEntries)
    .set({ status: 'VOIDED', voidedAt: sql`now()`, voidedBy: by.userId })
    .where(eq(journalEntries.id, entryId));
  return reversal;
}
