import Link from 'next/link';
import { GroupedBars, HBars, LineChart } from '@/components/charts';
import { Empty, NoAccess, Notice, PageHeader, Stat, Table } from '@/components/ui';
import { formatDays, formatMonth, formatRatio, pickDate, pickInt, pickOne } from '@/lib/analytics';
import { formatDate, formatMoney, formatMoneyCompact, label, pct } from '@/lib/format';
import { WATCHERS, can } from '@/lib/roles';
import { api, apiSafe, qs } from '@/lib/server-api';
import type {
  CashflowAnalytics,
  InventoryAnalytics,
  Profitability,
  ProfitabilityBy,
  Trajectory,
  User,
} from '@/lib/types';

export const metadata = { title: 'Analytics' };

const VIEWS = [
  ['profitability', 'Profitability'],
  ['stock', 'Stock efficiency'],
  ['cash', 'Cash and credit'],
  ['trajectory', 'Trajectory'],
] as const;
const BYS = [
  'category',
  'sub-category',
  'brand',
  'product',
] as const satisfies readonly ProfitabilityBy[];
const ORDERS = ['best', 'worst'] as const;

type Search = {
  view?: string;
  by?: string;
  order?: string;
  from?: string;
  to?: string;
  days?: string;
  weeks?: string;
  months?: string;
};

const byLabel = (by: ProfitabilityBy) => (by === 'sub-category' ? 'Sub-category' : label(by));

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const me = await api<User>('/me');
  if (!can(me.role, WATCHERS)) {
    return (
      <>
        <PageHeader title="Analytics" />
        <NoAccess what="analytics" />
      </>
    );
  }
  const view = VIEWS.find(([v]) => v === sp.view)?.[0] ?? 'profitability';

  return (
    <>
      <PageHeader
        title="Analytics"
        subtitle="What earns, what sits on the shelf, where the cash goes and where the shop is heading."
      />
      <nav aria-label="Analytics view" className="no-print mb-4 flex flex-wrap gap-1">
        {VIEWS.map(([v, text]) => (
          <Link
            key={v}
            href={`/analytics?view=${v}`}
            aria-current={view === v ? 'page' : undefined}
            className={`btn ${view === v ? 'btn-primary' : ''}`}
          >
            {text}
          </Link>
        ))}
      </nav>

      {view === 'profitability' ? <ProfitabilityView sp={sp} /> : null}
      {view === 'stock' ? <StockView sp={sp} /> : null}
      {view === 'cash' ? <CashView sp={sp} /> : null}
      {view === 'trajectory' ? <TrajectoryView sp={sp} /> : null}
    </>
  );
}

async function ProfitabilityView({ sp }: { sp: Search }) {
  const by = pickOne(sp.by, BYS) ?? 'category';
  const order = pickOne(sp.order, ORDERS) ?? 'best';
  const from = pickDate(sp.from);
  const to = pickDate(sp.to);
  const r = await apiSafe<Profitability>(
    `/analytics/profitability${qs({ by, order, from, to, limit: 50 })}`,
  );
  return (
    <div className="space-y-3">
      <form className="no-print flex flex-wrap items-end gap-2" method="get">
        <input type="hidden" name="view" value="profitability" />
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted">Group by</span>
          <select className="input" name="by" defaultValue={by}>
            {BYS.map((b) => (
              <option key={b} value={b}>
                {byLabel(b)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted">Show</span>
          <select className="input" name="order" defaultValue={order}>
            <option value="best">Best first</option>
            <option value="worst">Worst first</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted">From</span>
          <input className="input" type="date" name="from" defaultValue={from} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted">To</span>
          <input className="input" type="date" name="to" defaultValue={to} />
        </label>
        <button className="btn btn-primary">Show</button>
      </form>
      {!r.ok ? (
        <Notice tone="bad">{r.message}</Notice>
      ) : (
        <>
          <p className="text-sm text-muted">
            {formatDate(r.data.from)} to {formatDate(r.data.to)}, by{' '}
            {byLabel(r.data.by).toLowerCase()}, {order === 'best' ? 'best' : 'worst'} margin first.
          </p>
          {r.data.rows.length === 0 ? (
            <Empty>No sales in this period.</Empty>
          ) : (
            <Table
              head={[
                byLabel(by),
                '>Units',
                '>Revenue',
                '>Cost of goods',
                '>Gross profit',
                '>Margin',
              ]}
              caption={`Profitability by ${by}`}
            >
              {r.data.rows.map((row) => (
                <tr key={row.key}>
                  <td className="td font-medium">{row.name}</td>
                  <td className="td text-right tabular-nums">{row.unitsSold}</td>
                  <td className="td text-right tabular-nums">{formatMoney(row.revenueMinor)}</td>
                  <td className="td text-right tabular-nums">{formatMoney(row.cogsMinor)}</td>
                  <td
                    className={`td text-right tabular-nums ${row.grossProfitMinor < 0 ? 'text-bad' : ''}`}
                  >
                    {formatMoney(row.grossProfitMinor)}
                  </td>
                  <td
                    className={`td text-right tabular-nums ${row.marginPct !== null && row.marginPct < 0 ? 'text-bad' : ''}`}
                  >
                    {pct(row.marginPct)}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </>
      )}
    </div>
  );
}

async function StockView({ sp }: { sp: Search }) {
  const days = pickInt(sp.days, 7, 365, 90);
  const r = await apiSafe<InventoryAnalytics>(`/analytics/inventory${qs({ days })}`);
  return (
    <div className="space-y-4">
      <form className="no-print flex flex-wrap items-end gap-2" method="get">
        <input type="hidden" name="view" value="stock" />
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted">Window, days (7 to 365)</span>
          <input
            className="input w-28"
            type="number"
            min={7}
            max={365}
            name="days"
            defaultValue={days}
          />
        </label>
        <button className="btn btn-primary">Show</button>
      </form>
      {!r.ok ? <Notice tone="bad">{r.message}</Notice> : <StockBody a={r.data} />}
    </div>
  );
}

function StockBody({ a }: { a: InventoryAnalytics }) {
  return (
    <>
      <p className="text-sm text-muted">
        The last {a.windowDays} days, as of {formatDate(a.asOf)}. Turnover and GMROI are yearly
        rates.
      </p>
      <section aria-label="Stock efficiency" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat
          label="Stock turnover"
          value={formatRatio(a.turnover)}
          hint="Cost of goods over average stock"
        />
        <Stat label="Days of inventory" value={formatDays(a.daysInventoryOutstanding)} />
        <Stat label="GMROI" value={formatRatio(a.gmroi)} hint="Gross profit per birr of stock" />
        <Stat
          label="Sell-through"
          value={pct(a.sellThroughPct)}
          hint={`${a.unitsSold} sold, ${a.unitsReceived} received`}
        />
        <Stat
          label="Shrinkage"
          value={pct(a.shrinkagePct)}
          tone={a.shrinkagePct !== null && a.shrinkagePct > 0 ? 'bad' : undefined}
          hint="Lost to counts and write-offs"
        />
        <Stat
          label="Dead stock"
          value={formatMoney(a.deadStockValueMinor)}
          tone={a.deadStockValueMinor > 0 ? 'bad' : undefined}
          hint="Stock at cost that has not sold"
        />
      </section>
      <section aria-label="Stock value" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Opening stock value" value={formatMoney(a.openingValueMinor)} />
        <Stat label="Closing stock value" value={formatMoney(a.closingValueMinor)} />
        <Stat label="Cost of goods sold" value={formatMoney(a.cogsMinor)} />
        <Stat label="Gross profit" value={formatMoney(a.grossProfitMinor)} />
      </section>

      <section aria-label="Stock ageing" className="card p-4">
        <h2 className="mb-3 text-sm font-semibold">Stock by age since last sale or receipt</h2>
        <HBars
          ariaLabel="Value of stock by age in days"
          rows={a.aging.map((b) => ({
            label: `${b.bucket} days`,
            value: b.valueMinor,
            note: `${b.products} product${b.products === 1 ? '' : 's'}`,
          }))}
          format={formatMoney}
        />
      </section>

      <section aria-label="Dead stock">
        <h2 className="mb-2 text-sm font-semibold">Dead stock</h2>
        {a.deadStock.length === 0 ? (
          <Empty>No dead stock.</Empty>
        ) : (
          <Table
            head={['Product', '>Stock', '>Days since last sale', '>Capital locked']}
            caption="Products that have not sold"
          >
            {a.deadStock.map((d) => (
              <tr key={d.productId}>
                <td className="td font-medium">
                  <Link className="hover:underline" href={`/inventory/${d.productId}`}>
                    {d.name}
                  </Link>
                </td>
                <td className="td text-right tabular-nums">{d.stock}</td>
                <td className="td text-right tabular-nums">{d.daysSinceLastSale}</td>
                <td className="td text-right tabular-nums">{formatMoney(d.capitalLockedMinor)}</td>
              </tr>
            ))}
          </Table>
        )}
      </section>
    </>
  );
}

async function CashView({ sp }: { sp: Search }) {
  const weeks = pickInt(sp.weeks, 1, 52, 12);
  const r = await apiSafe<CashflowAnalytics>(`/analytics/cashflow${qs({ weeks })}`);
  return (
    <div className="space-y-4">
      <form className="no-print flex flex-wrap items-end gap-2" method="get">
        <input type="hidden" name="view" value="cash" />
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted">Weeks (1 to 52)</span>
          <input
            className="input w-28"
            type="number"
            min={1}
            max={52}
            name="weeks"
            defaultValue={weeks}
          />
        </label>
        <button className="btn btn-primary">Show</button>
      </form>
      {!r.ok ? <Notice tone="bad">{r.message}</Notice> : <CashBody c={r.data} />}
    </div>
  );
}

function CashBody({ c }: { c: CashflowAnalytics }) {
  const labels = c.weeks.map((w) => w.weekStart);
  return (
    <>
      {c.weeks.length === 0 ? (
        <Empty>No cash movements in this period.</Empty>
      ) : (
        <>
          <section aria-label="Weekly cash" className="card p-4">
            <h2 className="mb-1 text-sm font-semibold">Money in and out, by week</h2>
            <GroupedBars
              data={c.weeks.map((w) => ({
                label: w.weekStart,
                a: w.inflowMinor,
                b: w.outflowMinor,
              }))}
              aName="money in"
              bName="money out"
              format={formatMoneyCompact}
              ariaLabel={`Money in and money out for each of the last ${c.weeks.length} weeks`}
            />
            <p className="mt-1 flex gap-4 text-xs text-muted">
              <span>
                <span aria-hidden className="mr-1 inline-block size-2 rounded-sm bg-good" />
                Money in
              </span>
              <span>
                <span aria-hidden className="mr-1 inline-block size-2 rounded-sm bg-bad" />
                Money out
              </span>
            </p>
          </section>
          <section aria-label="Ending cash" className="card p-4">
            <h2 className="mb-1 text-sm font-semibold">Cash at the end of each week</h2>
            <LineChart
              labels={labels}
              values={c.weeks.map((w) => w.endingCashMinor)}
              format={formatMoneyCompact}
              ariaLabel={`Cash at the end of each of the last ${c.weeks.length} weeks`}
            />
          </section>
          <Table
            head={['Week starting', '>Money in', '>Money out', '>Net', '>Ending cash']}
            caption="Cash by week"
          >
            {c.weeks.map((w) => (
              <tr key={w.weekStart}>
                <td className="td">{formatDate(w.weekStart)}</td>
                <td className="td text-right tabular-nums">{formatMoney(w.inflowMinor)}</td>
                <td className="td text-right tabular-nums">{formatMoney(w.outflowMinor)}</td>
                <td className={`td text-right tabular-nums ${w.netMinor < 0 ? 'text-bad' : ''}`}>
                  {formatMoney(w.netMinor)}
                </td>
                <td className="td text-right tabular-nums">{formatMoney(w.endingCashMinor)}</td>
              </tr>
            ))}
          </Table>
        </>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Ageing title="We owe suppliers" rows={c.payablesAging} />
        <Ageing title="Customers owe us" rows={c.receivablesAging} />
      </div>
    </>
  );
}

function Ageing({
  title,
  rows,
}: {
  title: string;
  rows: { bucket: string; amountMinor: number; count: number }[];
}) {
  const total = rows.reduce((s, r) => s + r.amountMinor, 0);
  return (
    <section aria-label={title}>
      <h2 className="mb-2 text-sm font-semibold">{title}, by age</h2>
      <Table head={['Age', '>Items', '>Amount']} caption={`${title}, by age`}>
        {rows.map((r) => (
          <tr key={r.bucket}>
            <td className="td">{r.bucket}</td>
            <td className="td text-right tabular-nums">{r.count}</td>
            <td className="td text-right tabular-nums">{formatMoney(r.amountMinor)}</td>
          </tr>
        ))}
        <tr className="font-semibold">
          <td className="td" colSpan={2}>
            Total
          </td>
          <td className="td text-right tabular-nums">{formatMoney(total)}</td>
        </tr>
      </Table>
    </section>
  );
}

async function TrajectoryView({ sp }: { sp: Search }) {
  const months = pickInt(sp.months, 2, 24, 6);
  const r = await apiSafe<Trajectory>(`/analytics/trajectory${qs({ months })}`);
  return (
    <div className="space-y-4">
      <form className="no-print flex flex-wrap items-end gap-2" method="get">
        <input type="hidden" name="view" value="trajectory" />
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted">Months (2 to 24)</span>
          <input
            className="input w-28"
            type="number"
            min={2}
            max={24}
            name="months"
            defaultValue={months}
          />
        </label>
        <button className="btn btn-primary">Show</button>
      </form>
      {!r.ok ? <Notice tone="bad">{r.message}</Notice> : <TrajectoryBody t={r.data} />}
    </div>
  );
}

function TrajectoryBody({ t }: { t: Trajectory }) {
  const labels = t.months.map((m) => formatMonth(m.month));
  const percent = (v: number) => `${v.toFixed(0)}%`;
  return (
    <>
      <div className="grid gap-4 lg:grid-cols-3">
        <section aria-label="Revenue" className="card p-4">
          <h2 className="mb-1 text-sm font-semibold">Revenue</h2>
          <LineChart
            labels={labels}
            values={t.months.map((m) => m.revenueMinor)}
            format={formatMoneyCompact}
            ariaLabel={`Revenue for each of the last ${t.months.length} months`}
          />
        </section>
        <section aria-label="Gross margin" className="card p-4">
          <h2 className="mb-1 text-sm font-semibold">Gross margin</h2>
          <LineChart
            labels={labels}
            values={t.months.map((m) => m.grossMarginPct)}
            format={percent}
            stroke="stroke-good"
            fill="fill-good"
            ariaLabel={`Gross margin percentage for each of the last ${t.months.length} months`}
          />
        </section>
        <section aria-label="Ending cash" className="card p-4">
          <h2 className="mb-1 text-sm font-semibold">Cash at month end</h2>
          <LineChart
            labels={labels}
            values={t.months.map((m) => m.endingCashMinor)}
            format={formatMoneyCompact}
            ariaLabel={`Cash at the end of each of the last ${t.months.length} months`}
          />
        </section>
      </div>
      {t.months.length === 0 ? (
        <Empty>No months to show yet.</Empty>
      ) : (
        <Table
          head={[
            'Month',
            '>Revenue',
            '>Cost of goods',
            '>Gross profit',
            '>Margin',
            '>Expenses',
            '>Expense ratio',
            '>Net profit',
            '>Ending cash',
            '>Stock value',
          ]}
          caption="Month by month"
        >
          {t.months.map((m) => (
            <tr key={m.month}>
              <td className="td font-medium">{formatMonth(m.month)}</td>
              <td className="td text-right tabular-nums">{formatMoney(m.revenueMinor)}</td>
              <td className="td text-right tabular-nums">{formatMoney(m.cogsMinor)}</td>
              <td className="td text-right tabular-nums">{formatMoney(m.grossProfitMinor)}</td>
              <td className="td text-right tabular-nums">{pct(m.grossMarginPct)}</td>
              <td className="td text-right tabular-nums">{formatMoney(m.expensesMinor)}</td>
              <td className="td text-right tabular-nums">{pct(m.expenseRatioPct)}</td>
              <td
                className={`td text-right tabular-nums ${m.netProfitMinor < 0 ? 'text-bad' : ''}`}
              >
                {formatMoney(m.netProfitMinor)}
              </td>
              <td className="td text-right tabular-nums">{formatMoney(m.endingCashMinor)}</td>
              <td className="td text-right tabular-nums">{formatMoney(m.inventoryValueMinor)}</td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
