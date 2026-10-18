import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { ACCOUNT } from '../accounting/ledger.js';
import { businessDate, getBusinessTimezone } from '../common/time.js';
import { DB, type Database } from '../db/db.module.js';
import {
  accounts,
  damageRecords,
  journalEntries,
  journalLines,
  products,
  saleItems,
  sales,
} from '../db/schema.js';

/** A product that has not sold for this many days, and still has stock, is dead stock. */
const DEAD_STOCK_DAYS = 90;

type Severity = 'INFO' | 'WARNING' | 'CRITICAL';
export interface Alert {
  type: 'OUT_OF_STOCK' | 'LOW_STOCK' | 'NEGATIVE_MARGIN' | 'DEAD_STOCK' | 'DAMAGE_PENDING_APPROVAL';
  severity: Severity;
  productId: string | null;
  title: string;
  message: string;
  valueMinor: number | null;
}

const pct = (part: number, whole: number): number | null =>
  whole === 0 ? null : Math.round((part / whole) * 10000) / 100;

/** First day of the month containing a YYYY-MM-DD date. */
const monthStart = (date: string) => `${date.slice(0, 7)}-01`;
const daysAgo = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

@Injectable()
export class InsightsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Things that need someone's attention, worked out from the data every time they are asked for.
   * Nothing is stored, so an alert can never be stale, duplicated or left standing after the fix.
   */
  async alerts() {
    const live = await this.db
      .select()
      .from(products)
      .where(and(isNull(products.deletedAt), eq(products.status, 'ACTIVE')))
      .orderBy(asc(products.name), asc(products.id));
    const cutoff = new Date(Date.now() - DEAD_STOCK_DAYS * 24 * 60 * 60 * 1000);
    const alerts: Alert[] = [];
    for (const p of live) {
      if (p.currentStock === 0) {
        alerts.push({
          type: 'OUT_OF_STOCK',
          severity: 'CRITICAL',
          productId: p.id,
          title: `${p.name} is out of stock`,
          message: `Reorder point is ${p.reorderPoint}; suggested order ${p.reorderQty}`,
          valueMinor: null,
        });
        continue;
      }
      if (p.currentStock <= p.reorderPoint) {
        alerts.push({
          type: 'LOW_STOCK',
          severity: 'WARNING',
          productId: p.id,
          title: `${p.name} is running low`,
          message: `${p.currentStock} left, reorder point ${p.reorderPoint}`,
          valueMinor: null,
        });
      }
      if (p.sellingPriceMinor * p.currentStock < p.stockValueMinor) {
        alerts.push({
          type: 'NEGATIVE_MARGIN',
          severity: 'CRITICAL',
          productId: p.id,
          title: `${p.name} sells for less than it costs`,
          message: `Price ${p.sellingPriceMinor}, average cost ${Math.round(p.stockValueMinor / p.currentStock)}`,
          valueMinor: p.stockValueMinor - p.sellingPriceMinor * p.currentStock,
        });
      }
      const lastMoved = p.lastSoldAt ?? p.createdAt;
      if (lastMoved < cutoff) {
        alerts.push({
          type: 'DEAD_STOCK',
          severity: 'WARNING',
          productId: p.id,
          title: `${p.name} has not sold in ${DEAD_STOCK_DAYS} days`,
          message: `${p.currentStock} units are tying up capital`,
          valueMinor: p.stockValueMinor,
        });
      }
    }
    const [pending] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(damageRecords)
      .where(eq(damageRecords.status, 'PENDING'));
    if ((pending?.n ?? 0) > 0) {
      alerts.push({
        type: 'DAMAGE_PENDING_APPROVAL',
        severity: 'INFO',
        productId: null,
        title: `${pending!.n} damage report${pending!.n === 1 ? '' : 's'} waiting for approval`,
        message: 'Approve or reject them so stock and the books are right',
        valueMinor: null,
      });
    }
    const rank: Record<Severity, number> = { CRITICAL: 0, WARNING: 1, INFO: 2 };
    alerts.sort((a, b) => rank[a.severity] - rank[b.severity]);
    return {
      alerts,
      counts: {
        critical: alerts.filter((a) => a.severity === 'CRITICAL').length,
        warning: alerts.filter((a) => a.severity === 'WARNING').length,
        info: alerts.filter((a) => a.severity === 'INFO').length,
      },
    };
  }

  /** Revenue, cost and expenses for a range of days, read from the ledger so it always matches the books. */
  private async figures(from: string, to: string) {
    const [row] = await this.db
      .select({
        revenue: sql<number>`coalesce(sum(case when ${accounts.type} = 'REVENUE' then ${journalLines.creditMinor} - ${journalLines.debitMinor} else 0 end), 0)::bigint`,
        cogs: sql<number>`coalesce(sum(case when ${accounts.type} = 'COGS' then ${journalLines.debitMinor} - ${journalLines.creditMinor} else 0 end), 0)::bigint`,
        expenses: sql<number>`coalesce(sum(case when ${accounts.type} = 'EXPENSE' then ${journalLines.debitMinor} - ${journalLines.creditMinor} else 0 end), 0)::bigint`,
      })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
      .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
      .where(
        and(
          gte(journalEntries.entryDate, from),
          lte(journalEntries.entryDate, to),
          sql`${journalEntries.referenceType} is distinct from 'YEAR_CLOSE'`,
        ),
      );
    const revenueMinor = Number(row?.revenue ?? 0);
    const cogsMinor = Number(row?.cogs ?? 0);
    const expensesMinor = Number(row?.expenses ?? 0);
    const grossProfitMinor = revenueMinor - cogsMinor;
    return {
      revenueMinor,
      cogsMinor,
      grossProfitMinor,
      grossMarginPct: pct(grossProfitMinor, revenueMinor),
      expensesMinor,
      netProfitMinor: grossProfitMinor - expensesMinor,
    };
  }

  async dashboard() {
    const today = businessDate();
    const tz = getBusinessTimezone();
    const day = sql`(${sales.saleDate} at time zone ${tz})::date`;

    const todayFigures = await this.figures(today, today);
    const [txn] = await this.db
      .select({
        n: sql<number>`count(*)::int`,
        total: sql<number>`coalesce(sum(${sales.totalMinor}), 0)::bigint`,
      })
      .from(sales)
      .where(and(eq(sales.status, 'COMPLETED'), sql`${day} = ${today}::date`));
    const transactions = txn?.n ?? 0;

    const stock = await this.db
      .select()
      .from(products)
      .where(and(isNull(products.deletedAt), eq(products.status, 'ACTIVE')));
    const cutoff = new Date(Date.now() - DEAD_STOCK_DAYS * 24 * 60 * 60 * 1000);
    const dead = stock.filter((p) => p.currentStock > 0 && (p.lastSoldAt ?? p.createdAt) < cutoff);
    const inventory = {
      totalValueMinor: stock.reduce((s, p) => s + p.stockValueMinor, 0),
      skus: stock.length,
      outOfStock: stock.filter((p) => p.currentStock === 0).length,
      lowStock: stock.filter((p) => p.currentStock > 0 && p.currentStock <= p.reorderPoint).length,
      negativeMargin: stock.filter(
        (p) => p.currentStock > 0 && p.sellingPriceMinor * p.currentStock < p.stockValueMinor,
      ).length,
      deadStock: dead.length,
      deadStockValueMinor: dead.reduce((s, p) => s + p.stockValueMinor, 0),
    };

    const balances = await this.db
      .select({
        code: accounts.code,
        net: sql<number>`coalesce(sum(${journalLines.debitMinor} - ${journalLines.creditMinor}), 0)::bigint`,
      })
      .from(journalLines)
      .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
      .groupBy(accounts.code);
    const net = (code: string) => Number(balances.find((b) => b.code === code)?.net ?? 0);
    const cash = {
      cashInHandMinor: net(ACCOUNT.CASH),
      cashInBankMinor: net(ACCOUNT.BANK),
      receivablesMinor: net(ACCOUNT.RECEIVABLE),
      payablesMinor: -net(ACCOUNT.PAYABLE),
      workingCapitalMinor:
        net(ACCOUNT.CASH) +
        net(ACCOUNT.BANK) +
        net(ACCOUNT.RECEIVABLE) +
        inventory.totalValueMinor +
        net(ACCOUNT.PAYABLE),
    };

    // The last 30 days, one row per day including quiet days, from the ledger.
    const from30 = daysAgo(today, 29);
    const perDay = await this.db
      .select({
        date: sql<string>`${journalEntries.entryDate}::text`,
        revenue: sql<number>`coalesce(sum(case when ${accounts.type} = 'REVENUE' then ${journalLines.creditMinor} - ${journalLines.debitMinor} else 0 end), 0)::bigint`,
        cogs: sql<number>`coalesce(sum(case when ${accounts.type} = 'COGS' then ${journalLines.debitMinor} - ${journalLines.creditMinor} else 0 end), 0)::bigint`,
      })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
      .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
      .where(
        and(
          gte(journalEntries.entryDate, from30),
          lte(journalEntries.entryDate, today),
          sql`${journalEntries.referenceType} is distinct from 'YEAR_CLOSE'`,
        ),
      )
      .groupBy(journalEntries.entryDate);
    const byDate = new Map(perDay.map((r) => [r.date, r]));
    const revenue30Days = Array.from({ length: 30 }, (_, i) => {
      const date = daysAgo(today, 29 - i);
      const r = byDate.get(date);
      const revenueMinor = Number(r?.revenue ?? 0);
      const cogsMinor = Number(r?.cogs ?? 0);
      return { date, revenueMinor, cogsMinor, grossProfitMinor: revenueMinor - cogsMinor };
    });

    const top = await this.db
      .select({
        productId: saleItems.productId,
        name: saleItems.productName,
        units: sql<number>`sum(${saleItems.quantity} - ${saleItems.returnedQty})::int`,
        revenue: sql<number>`sum(${saleItems.lineTotalMinor})::bigint`,
        cogs: sql<number>`sum(${saleItems.lineCogsMinor})::bigint`,
      })
      .from(saleItems)
      .innerJoin(sales, eq(sales.id, saleItems.saleId))
      .where(and(eq(sales.status, 'COMPLETED'), sql`${day} >= ${from30}::date`))
      .groupBy(saleItems.productId, saleItems.productName)
      .orderBy(desc(sql`sum(${saleItems.lineTotalMinor})`))
      .limit(10);

    return {
      asOf: today,
      today: {
        ...todayFigures,
        transactions,
        averageTransactionMinor:
          transactions === 0 ? 0 : Math.round(Number(txn?.total ?? 0) / transactions),
      },
      monthToDate: await this.figures(monthStart(today), today),
      inventory,
      cash,
      revenue30Days,
      topProducts: top.map((t) => ({
        productId: t.productId,
        name: t.name,
        unitsSold: Number(t.units),
        revenueMinor: Number(t.revenue),
        grossProfitMinor: Number(t.revenue) - Number(t.cogs),
      })),
    };
  }
}
