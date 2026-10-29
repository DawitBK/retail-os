import { Inject, Injectable } from '@nestjs/common';
import { notFound, toPage } from '@retail/kit';
import { sql } from 'drizzle-orm';
import { ACCOUNT } from '../accounting/ledger.js';
import { addDays, businessDate, getBusinessTimezone, now } from '../common/time.js';
import { DB, type Database } from '../db/db.module.js';
import {
  FORECAST_NOTE,
  type CashflowQuery,
  type ForecastQuery,
  type ProductHealthQuery,
  type ProfitabilityQuery,
  type TrajectoryQuery,
  type WindowQuery,
} from './analytics.contract.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** A product that has not sold for this many days, and still has stock, is dead stock. */
const DEAD_STOCK_DAYS = 90;
const SALES_WINDOW_DAYS = 30;

const round2 = (n: number) => Math.round(n * 100) / 100;
const pct = (part: number, whole: number): number | null =>
  whole === 0 ? null : round2((part / whole) * 100);
const num = (v: unknown): number => Number(v ?? 0);

type Row = Record<string, unknown>;

interface Health {
  id: string;
  sku: string;
  name: string;
  categoryId: string;
  brandId: string | null;
  category: string;
  brand: string | null;
  currentStock: number;
  reorderPoint: number;
  reorderQty: number;
  stockValueMinor: number;
  sellingPriceMinor: number;
  unitsSold30: number;
  lastSoldAt: Date | null;
  referenceDate: Date;
  daysSinceLastSale: number;
  velocityPerDay: number;
  daysOfStock: number | null;
  averageCostMinor: number;
  marginPct: number | null;
  movement: 'FAST' | 'NORMAL' | 'SLOW' | 'DEAD';
  outOfStock: boolean;
  lowStock: boolean;
  negativeMargin: boolean;
}

@Injectable()
export class AnalyticsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  private async rows(query: ReturnType<typeof sql>): Promise<Row[]> {
    const result = await this.db.execute(query);
    return result.rows as Row[];
  }

  /** Every active product with what it sold over the last 30 days, classified. The one place the rules live. */
  private async loadHealth(): Promise<Health[]> {
    const today = businessDate();
    const from = addDays(today, -(SALES_WINDOW_DAYS - 1));
    const tz = getBusinessTimezone();
    const rows = await this.rows(sql`
      select p.id, p.sku, p.name, p.category_id, p.brand_id, c.name as category, b.name as brand,
             p.current_stock, p.reorder_point, p.reorder_qty, p.stock_value_minor,
             p.selling_price_minor, p.last_sold_at, p.created_at, coalesce(v.units, 0) as units30
        from products p
        join categories c on c.id = p.category_id
        left join brands b on b.id = p.brand_id
        left join (
          select si.product_id, sum(si.quantity - si.returned_qty) as units
            from sale_items si
            join sales s on s.id = si.sale_id
           where s.status = 'COMPLETED'
             and (s.sale_date at time zone ${tz})::date >= ${from}::date
           group by si.product_id
        ) v on v.product_id = p.id
       where p.deleted_at is null and p.status = 'ACTIVE'
       order by p.name, p.id`);
    const nowMs = now().getTime();
    return rows.map((r) => {
      const stock = num(r['current_stock']);
      const value = num(r['stock_value_minor']);
      const price = num(r['selling_price_minor']);
      const units30 = num(r['units30']);
      const lastSoldAt = r['last_sold_at'] ? new Date(r['last_sold_at'] as string | Date) : null;
      const referenceDate = lastSoldAt ?? new Date(r['created_at'] as string | Date);
      const daysSinceLastSale = Math.max(0, Math.floor((nowMs - referenceDate.getTime()) / DAY_MS));
      const velocity = units30 / SALES_WINDOW_DAYS;
      const movement: Health['movement'] =
        velocity > 1
          ? 'FAST'
          : velocity >= 0.1
            ? 'NORMAL'
            : units30 > 0
              ? 'SLOW'
              : daysSinceLastSale >= DEAD_STOCK_DAYS
                ? 'DEAD'
                : 'SLOW';
      const average = stock > 0 ? Math.round(value / stock) : 0;
      return {
        id: r['id'] as string,
        sku: r['sku'] as string,
        name: r['name'] as string,
        categoryId: r['category_id'] as string,
        brandId: (r['brand_id'] as string | null) ?? null,
        category: r['category'] as string,
        brand: (r['brand'] as string | null) ?? null,
        currentStock: stock,
        reorderPoint: num(r['reorder_point']),
        reorderQty: num(r['reorder_qty']),
        stockValueMinor: value,
        sellingPriceMinor: price,
        unitsSold30: units30,
        lastSoldAt,
        referenceDate,
        daysSinceLastSale,
        velocityPerDay: round2(velocity),
        daysOfStock: velocity > 0 ? round2(stock / velocity) : null,
        averageCostMinor: average,
        marginPct: stock > 0 ? pct(price - average, price) : null,
        movement,
        outOfStock: stock === 0,
        lowStock: stock > 0 && stock <= num(r['reorder_point']),
        negativeMargin: stock > 0 && price * stock < value,
      };
    });
  }

  async productHealth(q: ProductHealthQuery) {
    const needle = q.search?.toLowerCase();
    const all = (await this.loadHealth()).filter(
      (h) =>
        (!needle ||
          h.name.toLowerCase().includes(needle) ||
          h.sku.toLowerCase().includes(needle)) &&
        (!q.movement || h.movement === q.movement) &&
        (!q.categoryId || h.categoryId === q.categoryId) &&
        (!q.brandId || h.brandId === q.brandId) &&
        (!q.flag ||
          (q.flag === 'OUT_OF_STOCK'
            ? h.outOfStock
            : q.flag === 'LOW_STOCK'
              ? h.lowStock
              : h.negativeMargin)),
    );
    const items = all.slice(q.offset, q.offset + q.limit).map((h) => ({
      id: h.id,
      sku: h.sku,
      name: h.name,
      category: h.category,
      brand: h.brand,
      currentStock: h.currentStock,
      reorderPoint: h.reorderPoint,
      averageCostMinor: h.averageCostMinor,
      sellingPriceMinor: h.sellingPriceMinor,
      marginPct: h.marginPct,
      stockValueMinor: h.stockValueMinor,
      unitsSold30: h.unitsSold30,
      velocityPerDay: h.velocityPerDay,
      daysOfStock: h.daysOfStock,
      movement: h.movement,
      outOfStock: h.outOfStock,
      lowStock: h.lowStock,
      negativeMargin: h.negativeMargin,
      lastSoldAt: h.lastSoldAt?.toISOString() ?? null,
    }));
    return toPage(items, all.length, q);
  }

  async productAnalytics(id: string) {
    const health = (await this.loadHealth()).find((h) => h.id === id);
    if (!health) throw notFound('Product not found, or not active');
    const today = businessDate();
    const from = addDays(today, -(SALES_WINDOW_DAYS - 1));
    const tz = getBusinessTimezone();
    const days = await this.rows(sql`
      select (s.sale_date at time zone ${tz})::date::text as day,
             sum(si.quantity - si.returned_qty) as units,
             sum(si.line_cogs_minor) as cogs,
             sum(si.line_total_minor) as revenue
        from sale_items si join sales s on s.id = si.sale_id
       where si.product_id = ${id}::uuid and s.status = 'COMPLETED'
         and (s.sale_date at time zone ${tz})::date >= ${from}::date
       group by 1`);
    const byDay = new Map(days.map((d) => [d['day'] as string, num(d['units'])]));
    const revenue30 = days.reduce((s, d) => s + num(d['revenue']), 0);
    const cogs30 = days.reduce((s, d) => s + num(d['cogs']), 0);
    const annualProfit = ((revenue30 - cogs30) * 365) / SALES_WINDOW_DAYS;
    const annualCogs = (cogs30 * 365) / SALES_WINDOW_DAYS;
    return {
      productId: id,
      name: health.name,
      velocityPerDay: health.velocityPerDay,
      unitsSold30: health.unitsSold30,
      daysOfStock: health.daysOfStock,
      marginPct: health.marginPct,
      daysInventoryOutstanding:
        annualCogs > 0 && health.stockValueMinor > 0
          ? round2((health.stockValueMinor / annualCogs) * 365)
          : null,
      gmroi: health.stockValueMinor > 0 ? round2(annualProfit / health.stockValueMinor) : null,
      stockCoverageDays: health.daysOfStock,
      capitalLockedMinor: health.stockValueMinor,
      last30Days: Array.from({ length: SALES_WINDOW_DAYS }, (_, i) => {
        const date = addDays(today, -(SALES_WINDOW_DAYS - 1 - i));
        return { date, units: byDay.get(date) ?? 0 };
      }),
    };
  }

  /** Stock efficiency over a window, all read from the ledger and the movement history. */
  async inventory(q: WindowQuery) {
    const today = businessDate();
    const from = addDays(today, -(q.days - 1));
    const tz = getBusinessTimezone();

    const [ledger] = await this.rows(sql`
      select coalesce(sum(case when a.type = 'REVENUE' then l.credit_minor - l.debit_minor else 0 end), 0) as revenue,
             coalesce(sum(case when a.type = 'COGS' then l.debit_minor - l.credit_minor else 0 end), 0) as cogs
        from journal_lines l
        join journal_entries e on e.id = l.entry_id
        join accounts a on a.id = l.account_id
       where e.entry_date between ${from}::date and ${today}::date
         and e.reference_type is distinct from 'YEAR_CLOSE'`);
    const revenue = num(ledger?.['revenue']);
    const cogs = num(ledger?.['cogs']);

    const [closingRow] = await this.rows(sql`
      select coalesce(sum(p.stock_value_minor), 0) as value, coalesce(sum(p.current_stock), 0) as units
        from products p`);
    const closing = num(closingRow?.['value']);
    const closingUnits = num(closingRow?.['units']);

    const [mv] = await this.rows(sql`
      select coalesce(sum(m.value_delta_minor), 0) as net_value,
             coalesce(sum(case when m.movement_type in ('OPENING_BALANCE','PURCHASE_RECEIPT','SALE_VOID','SALE_RETURN','STOCK_ADJUSTMENT_INCREASE') then m.quantity else -m.quantity end), 0) as net_units,
             coalesce(sum(case when m.movement_type in ('OPENING_BALANCE','PURCHASE_RECEIPT') then m.quantity else 0 end), 0) as received,
             coalesce(sum(case when m.movement_type = 'SALE' then m.quantity when m.movement_type in ('SALE_VOID','SALE_RETURN') then -m.quantity else 0 end), 0) as sold,
             coalesce(sum(case when m.movement_type = 'STOCK_ADJUSTMENT_DECREASE' then -m.value_delta_minor when m.movement_type = 'STOCK_ADJUSTMENT_INCREASE' then -m.value_delta_minor else 0 end), 0) as shrink
        from inventory_movements m
       where (m.created_at at time zone ${tz})::date >= ${from}::date`);
    const opening = closing - num(mv?.['net_value']);
    const average = Math.round((opening + closing) / 2);
    const openingUnits = closingUnits - num(mv?.['net_units']);
    const received = num(mv?.['received']);
    const sold = num(mv?.['sold']);

    const turnover = average > 0 ? round2(((cogs / average) * 365) / q.days) : null;
    const gmroi = average > 0 ? round2((((revenue - cogs) / average) * 365) / q.days) : null;

    const health = await this.loadHealth();
    const stocked = health.filter((h) => h.currentStock > 0);
    const buckets = [
      { bucket: '0-30' as const, max: 30 },
      { bucket: '31-60' as const, max: 60 },
      { bucket: '61-90' as const, max: 90 },
      { bucket: '90+' as const, max: Infinity },
    ];
    const aging = buckets.map((b, i) => {
      const min = i === 0 ? -1 : buckets[i - 1]!.max;
      const inBucket = stocked.filter(
        (h) => h.daysSinceLastSale > min && h.daysSinceLastSale <= b.max,
      );
      return {
        bucket: b.bucket,
        products: inBucket.length,
        valueMinor: inBucket.reduce((s, h) => s + h.stockValueMinor, 0),
      };
    });
    const dead = stocked
      .filter((h) => h.daysSinceLastSale >= DEAD_STOCK_DAYS)
      .sort((a, b) => b.stockValueMinor - a.stockValueMinor);

    return {
      asOf: today,
      windowDays: q.days,
      cogsMinor: cogs,
      grossProfitMinor: revenue - cogs,
      openingValueMinor: opening,
      closingValueMinor: closing,
      averageValueMinor: average,
      turnover,
      daysInventoryOutstanding: turnover && turnover > 0 ? round2(365 / turnover) : null,
      gmroi,
      sellThroughPct: pct(sold, openingUnits + received),
      unitsSold: sold,
      unitsReceived: received,
      deadStockValueMinor: dead.reduce((s, h) => s + h.stockValueMinor, 0),
      shrinkagePct: average > 0 ? pct(Math.max(0, num(mv?.['shrink'])), average) : null,
      aging,
      deadStock: dead.slice(0, 20).map((h) => ({
        productId: h.id,
        name: h.name,
        stock: h.currentStock,
        daysSinceLastSale: h.daysSinceLastSale,
        capitalLockedMinor: h.stockValueMinor,
      })),
    };
  }

  /**
   * Profit by category, sub-category, brand or product, from the lines of completed sales. Returned
   * units are taken out of the units, revenue and cost in proportion; the books (profit-loss) remain
   * the authority on the totals.
   */
  async profitability(q: ProfitabilityQuery) {
    const to = q.to ?? businessDate();
    const from = q.from ?? addDays(to, -89);
    const tz = getBusinessTimezone();
    const groups = {
      category: { key: sql`c.id::text`, name: sql`c.name` },
      'sub-category': {
        key: sql`coalesce(sc.id::text, 'none')`,
        name: sql`coalesce(sc.name, 'No sub-category')`,
      },
      brand: { key: sql`coalesce(b.id::text, 'none')`, name: sql`coalesce(b.name, 'No brand')` },
      product: { key: sql`p.id::text`, name: sql`p.name` },
    } as const;
    const g = groups[q.by];
    const rows = await this.rows(sql`
      select ${g.key} as key, ${g.name} as name,
             sum(si.quantity - si.returned_qty) as units,
             sum(round(si.line_total_minor::numeric * (si.quantity - si.returned_qty) / si.quantity)) as revenue,
             sum(round(si.line_cogs_minor::numeric * (si.quantity - si.returned_qty) / si.quantity)) as cogs
        from sale_items si
        join sales s on s.id = si.sale_id
        join products p on p.id = si.product_id
        join categories c on c.id = p.category_id
        left join sub_categories sc on sc.id = p.sub_category_id
        left join brands b on b.id = p.brand_id
       where s.status = 'COMPLETED'
         and (s.sale_date at time zone ${tz})::date between ${from}::date and ${to}::date
       group by 1, 2
      having sum(si.quantity - si.returned_qty) > 0`);
    const mapped = rows.map((r) => {
      const revenue = num(r['revenue']);
      const cogs = num(r['cogs']);
      return {
        key: r['key'] as string,
        name: r['name'] as string,
        unitsSold: num(r['units']),
        revenueMinor: revenue,
        cogsMinor: cogs,
        grossProfitMinor: revenue - cogs,
        marginPct: pct(revenue - cogs, revenue),
      };
    });
    const worst = q.order === 'worst';
    mapped.sort((a, b) => {
      const am = a.marginPct ?? 0;
      const bm = b.marginPct ?? 0;
      return worst ? am - bm : b.grossProfitMinor - a.grossProfitMinor;
    });
    return { by: q.by, from, to, rows: mapped.slice(0, q.limit) };
  }

  /** Cash in and out by week, and what is owed to suppliers and by customers, by age. */
  async cashflow(q: CashflowQuery) {
    const today = businessDate();
    const monday = (d: string) => {
      const day = new Date(`${d}T00:00:00Z`).getUTCDay();
      return addDays(d, -((day + 6) % 7));
    };
    const firstWeek = addDays(monday(today), -7 * (q.weeks - 1));
    const rows = await this.rows(sql`
      select date_trunc('week', e.entry_date)::date::text as week,
             coalesce(sum(case when e.reference_type is distinct from 'OPENING_BALANCE' then l.debit_minor else 0 end), 0) as inflow,
             coalesce(sum(case when e.reference_type is distinct from 'OPENING_BALANCE' then l.credit_minor else 0 end), 0) as outflow
        from journal_lines l
        join journal_entries e on e.id = l.entry_id
        join accounts a on a.id = l.account_id
       where a.code in (${ACCOUNT.CASH}, ${ACCOUNT.BANK}) and e.entry_date >= ${firstWeek}::date
       group by 1`);
    const [before] = await this.rows(sql`
      select coalesce(sum(l.debit_minor - l.credit_minor), 0) as cash
        from journal_lines l
        join journal_entries e on e.id = l.entry_id
        join accounts a on a.id = l.account_id
       where a.code in (${ACCOUNT.CASH}, ${ACCOUNT.BANK}) and e.entry_date < ${firstWeek}::date`);
    const opening = await this.rows(sql`
      select e.entry_date::text as day, sum(l.debit_minor - l.credit_minor) as cash
        from journal_lines l
        join journal_entries e on e.id = l.entry_id
        join accounts a on a.id = l.account_id
       where a.code in (${ACCOUNT.CASH}, ${ACCOUNT.BANK}) and e.reference_type = 'OPENING_BALANCE'
         and e.entry_date >= ${firstWeek}::date
       group by 1`);
    const byWeek = new Map(rows.map((r) => [r['week'] as string, r]));
    let running = num(before?.['cash']);
    const weeks = Array.from({ length: q.weeks }, (_, i) => {
      const weekStart = addDays(firstWeek, i * 7);
      const r = byWeek.get(weekStart);
      const inflow = num(r?.['inflow']);
      const outflow = num(r?.['outflow']);
      const openingInWeek = opening
        .filter(
          (o) => (o['day'] as string) >= weekStart && (o['day'] as string) < addDays(weekStart, 7),
        )
        .reduce((s, o) => s + num(o['cash']), 0);
      running += inflow - outflow + openingInWeek;
      return {
        weekStart,
        inflowMinor: inflow,
        outflowMinor: outflow,
        netMinor: inflow - outflow,
        endingCashMinor: running,
      };
    });

    const bucketOf = (age: number) =>
      age <= 30
        ? '0-30 days'
        : age <= 60
          ? '31-60 days'
          : age <= 90
            ? '61-90 days'
            : 'Over 90 days';
    const labels = ['0-30 days', '31-60 days', '61-90 days', 'Over 90 days'];
    const aging = (items: { age: number; amount: number }[]) =>
      labels.map((bucket) => {
        const inBucket = items.filter((i) => bucketOf(i.age) === bucket);
        return {
          bucket,
          amountMinor: inBucket.reduce((s, i) => s + i.amount, 0),
          count: inBucket.length,
        };
      });
    const payables = await this.rows(sql`
      select (${today}::date - coalesce(received_date, order_date)) as age, received_value_minor - paid_minor as owed
        from purchases
       where status <> 'CANCELLED' and received_value_minor - paid_minor > 0`);
    const tz = getBusinessTimezone();
    const receivables = await this.rows(sql`
      select (${today}::date - (sale_date at time zone ${tz})::date) as age, total_minor - amount_paid_minor as owed
        from sales
       where status = 'COMPLETED' and payment_method = 'CREDIT' and total_minor - amount_paid_minor > 0`);
    return {
      weeks,
      payablesAging: aging(payables.map((p) => ({ age: num(p['age']), amount: num(p['owed']) }))),
      receivablesAging: aging(
        receivables.map((p) => ({ age: num(p['age']), amount: num(p['owed']) })),
      ),
    };
  }

  /** Six months (or more) of trading and position, month by month, all from the ledger. */
  async trajectory(q: TrajectoryQuery) {
    const today = businessDate();
    const thisMonth = `${today.slice(0, 7)}-01`;
    const months: string[] = [];
    for (let i = q.months - 1; i >= 0; i -= 1) {
      const d = new Date(`${thisMonth}T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() - i);
      months.push(d.toISOString().slice(0, 7));
    }
    const rows = await this.rows(sql`
      select to_char(e.entry_date, 'YYYY-MM') as month, a.type, a.code,
             sum(l.debit_minor) as debit, sum(l.credit_minor) as credit
        from journal_lines l
        join journal_entries e on e.id = l.entry_id
        join accounts a on a.id = l.account_id
       where e.reference_type is distinct from 'YEAR_CLOSE'
       group by 1, 2, 3`);
    const sumBy = (month: string, pick: (r: Row) => number, test: (r: Row) => boolean) =>
      rows.filter((r) => r['month'] === month && test(r)).reduce((s, r) => s + pick(r), 0);
    const upTo = (month: string, codes: string[]) =>
      rows
        .filter((r) => (r['month'] as string) <= month && codes.includes(r['code'] as string))
        .reduce((s, r) => s + num(r['debit']) - num(r['credit']), 0);
    return {
      months: months.map((month) => {
        const revenue = sumBy(
          month,
          (r) => num(r['credit']) - num(r['debit']),
          (r) => r['type'] === 'REVENUE',
        );
        const cogs = sumBy(
          month,
          (r) => num(r['debit']) - num(r['credit']),
          (r) => r['type'] === 'COGS',
        );
        const expenses = sumBy(
          month,
          (r) => num(r['debit']) - num(r['credit']),
          (r) => r['type'] === 'EXPENSE',
        );
        return {
          month,
          revenueMinor: revenue,
          cogsMinor: cogs,
          grossProfitMinor: revenue - cogs,
          grossMarginPct: pct(revenue - cogs, revenue),
          expensesMinor: expenses,
          expenseRatioPct: pct(expenses, revenue),
          netProfitMinor: revenue - cogs - expenses,
          endingCashMinor: upTo(month, [ACCOUNT.CASH, ACCOUNT.BANK]),
          inventoryValueMinor: upTo(month, [ACCOUNT.INVENTORY]),
        };
      }),
    };
  }

  /** The direct-method cash flow statement: what came in and went out of the cash and bank accounts. */
  async cashFlowStatement(range: { from: string; to: string }) {
    const [open] = await this.rows(sql`
      select coalesce(sum(l.debit_minor - l.credit_minor), 0) as cash
        from journal_lines l
        join journal_entries e on e.id = l.entry_id
        join accounts a on a.id = l.account_id
       where a.code in (${ACCOUNT.CASH}, ${ACCOUNT.BANK}) and e.entry_date < ${range.from}::date`);
    const rows = await this.rows(sql`
      select coalesce(e.reference_type, 'OTHER') as kind,
             sum(l.debit_minor) as debit, sum(l.credit_minor) as credit
        from journal_lines l
        join journal_entries e on e.id = l.entry_id
        join accounts a on a.id = l.account_id
       where a.code in (${ACCOUNT.CASH}, ${ACCOUNT.BANK})
         and e.entry_date between ${range.from}::date and ${range.to}::date
       group by 1`);
    const [ledgerEnd] = await this.rows(sql`
      select coalesce(sum(l.debit_minor - l.credit_minor), 0) as cash
        from journal_lines l
        join journal_entries e on e.id = l.entry_id
        join accounts a on a.id = l.account_id
       where a.code in (${ACCOUNT.CASH}, ${ACCOUNT.BANK}) and e.entry_date <= ${range.to}::date`);
    const receiptLabel: Record<string, string> = {
      SALE: 'Sales received',
      CUSTOMER_RECEIPT: 'Credit customers paid',
      PURCHASE_RETURN: 'Refunds from suppliers',
      OPENING_BALANCE: 'Opening balance and capital',
      REVERSAL: 'Voids and reversals',
    };
    const paymentLabel: Record<string, string> = {
      SUPPLIER_PAYMENT: 'Suppliers paid',
      EXPENSE: 'Expenses paid',
      SALE_RETURN: 'Refunds to customers',
      REVERSAL: 'Voids and reversals',
    };
    const collect = (
      side: 'debit' | 'credit',
      labels: Record<string, string>,
      fallback: string,
    ) => {
      const out = new Map<string, number>();
      for (const r of rows) {
        const amount = num(r[side]);
        if (amount === 0) continue;
        const label = labels[r['kind'] as string] ?? fallback;
        out.set(label, (out.get(label) ?? 0) + amount);
      }
      return [...out.entries()].map(([label, amountMinor]) => ({ label, amountMinor }));
    };
    const receipts = collect('debit', receiptLabel, 'Other receipts');
    const payments = collect('credit', paymentLabel, 'Other payments');
    const totalReceipts = receipts.reduce((s, l) => s + l.amountMinor, 0);
    const totalPayments = payments.reduce((s, l) => s + l.amountMinor, 0);
    const openingCash = num(open?.['cash']);
    const closingCash = openingCash + totalReceipts - totalPayments;
    return {
      from: range.from,
      to: range.to,
      openingCashMinor: openingCash,
      receipts,
      payments,
      totalReceiptsMinor: totalReceipts,
      totalPaymentsMinor: totalPayments,
      netChangeMinor: totalReceipts - totalPayments,
      closingCashMinor: closingCash,
      reconciled: closingCash === num(ledgerEnd?.['cash']),
    };
  }

  // ---------------------------------------------------------------- forecasting

  /** Products that will run out soon, soonest first. */
  async reorder(q: ForecastQuery) {
    const today = businessDate();
    const rows = (await this.loadHealth())
      .filter((h) => h.outOfStock || h.lowStock || (h.daysOfStock !== null && h.daysOfStock <= 30))
      .map((h) => {
        const days = h.outOfStock ? 0 : h.daysOfStock === null ? null : Math.floor(h.daysOfStock);
        const stockout = days === null ? null : addDays(today, days);
        const orderBy =
          stockout === null
            ? null
            : stockout < addDays(today, q.leadTimeDays)
              ? today
              : addDays(stockout, -q.leadTimeDays);
        return {
          productId: h.id,
          sku: h.sku,
          name: h.name,
          currentStock: h.currentStock,
          reorderPoint: h.reorderPoint,
          velocityPerDay: h.velocityPerDay,
          daysUntilStockout: days,
          stockoutDate: stockout,
          reorderByDate: orderBy,
          urgencyScore:
            h.reorderPoint > 0
              ? round2(Math.max(0, h.reorderPoint - h.currentStock) / h.reorderPoint)
              : 0,
        };
      })
      .sort(
        (a, b) =>
          (a.daysUntilStockout ?? 9999) - (b.daysUntilStockout ?? 9999) ||
          b.urgencyScore - a.urgencyScore,
      )
      .slice(0, q.limit);
    return {
      asOf: today,
      leadTimeDays: q.leadTimeDays,
      note: `${FORECAST_NOTE} Reorder by = stockout date minus the supplier lead time.`,
      rows,
    };
  }

  /** Stock that is not selling, worst first: the money that is frozen, weighted by how long. */
  async deadStock(q: ForecastQuery) {
    const rows = (await this.loadHealth())
      .filter((h) => h.currentStock > 0 && h.daysSinceLastSale >= DEAD_STOCK_DAYS)
      .map((h) => ({
        productId: h.id,
        sku: h.sku,
        name: h.name,
        currentStock: h.currentStock,
        daysSinceLastSale: h.daysSinceLastSale,
        capitalLockedMinor: h.stockValueMinor,
        riskScore: round2((h.daysSinceLastSale * (h.stockValueMinor / 100)) / 1000),
      }))
      .sort((a, b) => b.riskScore - a.riskScore)
      .slice(0, q.limit);
    return { asOf: businessDate(), note: FORECAST_NOTE, rows };
  }

  /** What the best sellers are likely to sell over the next 30 days at their current pace. */
  async salesForecast(q: ForecastQuery) {
    const tz = getBusinessTimezone();
    const from = addDays(businessDate(), -(SALES_WINDOW_DAYS - 1));
    const top = await this.rows(sql`
      select si.product_id as id, sum(si.line_total_minor) as revenue
        from sale_items si join sales s on s.id = si.sale_id
       where s.status = 'COMPLETED' and (s.sale_date at time zone ${tz})::date >= ${from}::date
       group by 1 order by 2 desc limit ${q.limit}`);
    const byId = new Map((await this.loadHealth()).map((h) => [h.id, h]));
    const rows = top.flatMap((t) => {
      const h = byId.get(t['id'] as string);
      if (!h) return [];
      const predicted = Math.round(h.velocityPerDay * 30);
      return [
        {
          productId: h.id,
          sku: h.sku,
          name: h.name,
          currentStock: h.currentStock,
          unitsSold30: h.unitsSold30,
          predictedUnits30: predicted,
          predictedRevenueMinor: predicted * h.sellingPriceMinor,
          predictedEndStock: Math.max(0, h.currentStock - predicted),
        },
      ];
    });
    return { asOf: businessDate(), note: FORECAST_NOTE, rows };
  }

  /** Purchase orders worth raising, grouped by the supplier each product was last bought from. */
  async suggestions(q: ForecastQuery) {
    const need = (await this.loadHealth()).filter(
      (h) =>
        h.outOfStock || h.lowStock || (h.daysOfStock !== null && h.daysOfStock <= q.leadTimeDays),
    );
    const last = await this.rows(sql`
      select distinct on (pi.product_id) pi.product_id as id, s.id as supplier_id, s.name as supplier, pi.unit_cost_minor as cost
        from purchase_items pi
        join purchases pu on pu.id = pi.purchase_id
        join suppliers s on s.id = pu.supplier_id
       where pu.status <> 'CANCELLED'
       order by pi.product_id, pu.created_at desc`);
    const lastBy = new Map(last.map((r) => [r['id'] as string, r]));
    const groups = new Map<
      string,
      {
        supplierId: string | null;
        supplierName: string;
        lines: {
          productId: string;
          name: string;
          currentStock: number;
          suggestedQty: number;
          unitCostMinor: number;
          lineTotalMinor: number;
        }[];
      }
    >();
    for (const h of need.slice(0, q.limit)) {
      const l = lastBy.get(h.id);
      const key = (l?.['supplier_id'] as string | undefined) ?? 'none';
      const group = groups.get(key) ?? {
        supplierId: (l?.['supplier_id'] as string | undefined) ?? null,
        supplierName: (l?.['supplier'] as string | undefined) ?? 'No supplier yet',
        lines: [],
      };
      const qty = Math.max(h.reorderQty, h.reorderPoint - h.currentStock + h.reorderQty);
      const cost = l ? num(l['cost']) : h.averageCostMinor;
      group.lines.push({
        productId: h.id,
        name: h.name,
        currentStock: h.currentStock,
        suggestedQty: qty,
        unitCostMinor: cost,
        lineTotalMinor: qty * cost,
      });
      groups.set(key, group);
    }
    return {
      asOf: businessDate(),
      note: `${FORECAST_NOTE} Quantity = the larger of the reorder quantity and what lifts stock to the reorder point plus one reorder quantity.`,
      suppliers: [...groups.values()]
        .map((g) => ({ ...g, totalMinor: g.lines.reduce((s, l) => s + l.lineTotalMinor, 0) }))
        .sort((a, b) => b.totalMinor - a.totalMinor),
    };
  }
}
