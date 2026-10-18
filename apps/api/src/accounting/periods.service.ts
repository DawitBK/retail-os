import { Inject, Injectable } from '@nestjs/common';
import { conflict, unprocessable } from '@retail/kit';
import { desc, eq, lte, sql } from 'drizzle-orm';
import { recordAudit } from '../common/audit.js';
import type { Principal } from '../common/auth.js';
import { businessDate } from '../common/time.js';
import { DB, type Database } from '../db/db.module.js';
import {
  accounts,
  journalEntries,
  journalLines,
  outboxEvents,
  periodCloses,
} from '../db/schema.js';
import { ACCOUNT, postJournalEntry, type JournalLineInput } from './ledger.js';
import type { CloseYear, PeriodCloseDto } from './periods.contract.js';

@Injectable()
export class PeriodsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async list(): Promise<{ closedThrough: string | null; closes: PeriodCloseDto[] }> {
    const rows = await this.db
      .select({
        fiscalYear: periodCloses.fiscalYear,
        closedThrough: periodCloses.closedThrough,
        netProfitMinor: periodCloses.netProfitMinor,
        entryNumber: journalEntries.entryNumber,
        closedAt: periodCloses.closedAt,
      })
      .from(periodCloses)
      .leftJoin(journalEntries, eq(journalEntries.id, periodCloses.journalEntryId))
      .orderBy(desc(periodCloses.fiscalYear));
    const closes = rows.map((r) => ({
      fiscalYear: r.fiscalYear,
      closedThrough: r.closedThrough,
      netProfitMinor: r.netProfitMinor,
      entryNumber: r.entryNumber,
      closedAt: r.closedAt.toISOString(),
    }));
    return { closedThrough: closes[0]?.closedThrough ?? null, closes };
  }

  /**
   * Close a financial year (the calendar year): one entry moves every revenue, cost and expense
   * balance up to 31 December into retained earnings, and the books are locked through that date.
   * Years close in order, a year must have ended, and a close can never be undone.
   */
  async closeYear(actor: Principal, input: CloseYear): Promise<PeriodCloseDto> {
    const through = `${input.year}-12-31`;
    if (through >= businessDate()) {
      throw unprocessable(
        'year-not-over',
        'That year has not ended',
        `Close ${input.year} after 31 December`,
      );
    }
    return this.db.transaction(async (tx) => {
      // One close at a time: two owners pressing the button cannot both succeed.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('period-close'))`);
      const [last] = await tx
        .select({ year: periodCloses.fiscalYear })
        .from(periodCloses)
        .orderBy(desc(periodCloses.fiscalYear))
        .limit(1);
      if (last && input.year <= last.year) {
        throw conflict(
          'year-already-closed',
          'That year is already closed',
          `The last close was ${last.year}`,
        );
      }
      if (last && input.year !== last.year + 1) {
        throw conflict(
          'years-must-close-in-order',
          'Close the years in order',
          `Close ${last.year + 1} first`,
        );
      }

      const balances = await tx
        .select({
          code: accounts.code,
          type: accounts.type,
          net: sql<number>`coalesce(sum(${journalLines.debitMinor} - ${journalLines.creditMinor}), 0)::bigint`,
        })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
        .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
        .where(
          sql`${accounts.type} in ('REVENUE', 'COGS', 'EXPENSE') and ${lte(journalEntries.entryDate, through)}`,
        )
        .groupBy(accounts.code, accounts.type)
        .having(sql`sum(${journalLines.debitMinor} - ${journalLines.creditMinor}) <> 0`);

      // Zero every balance (a debit balance is cleared with a credit and the other way round); what is
      // left over is the profit, which goes to retained earnings.
      const lines: JournalLineInput[] = [];
      let profit = 0; // credits minus debits of the P&L accounts: positive is a profit
      for (const b of balances) {
        const net = Number(b.net);
        profit -= net;
        if (net > 0) lines.push({ accountCode: b.code, creditMinor: net });
        else lines.push({ accountCode: b.code, debitMinor: -net });
      }
      if (profit > 0) lines.push({ accountCode: ACCOUNT.RETAINED_EARNINGS, creditMinor: profit });
      if (profit < 0) lines.push({ accountCode: ACCOUNT.RETAINED_EARNINGS, debitMinor: -profit });

      const entry = lines.length
        ? await postJournalEntry(tx, {
            date: through,
            description: `Close the books for ${input.year}`,
            referenceType: 'YEAR_CLOSE',
            referenceId: crypto.randomUUID(),
            lines,
            createdBy: actor.userId,
          })
        : null;
      const [row] = await tx
        .insert(periodCloses)
        .values({
          fiscalYear: input.year,
          closedThrough: through,
          netProfitMinor: profit,
          journalEntryId: entry?.id ?? null,
          closedBy: actor.userId,
        })
        .returning();
      const dto: PeriodCloseDto = {
        fiscalYear: row!.fiscalYear,
        closedThrough: row!.closedThrough,
        netProfitMinor: row!.netProfitMinor,
        entryNumber: entry?.entryNumber ?? null,
        closedAt: row!.closedAt.toISOString(),
      };
      await recordAudit(tx, {
        actor: actor.userId,
        action: 'books.year-closed',
        entityType: 'period',
        entityId: String(input.year),
        after: dto,
      });
      await tx.insert(outboxEvents).values({ topic: 'books.year-closed', payload: dto });
      return dto;
    });
  }
}
