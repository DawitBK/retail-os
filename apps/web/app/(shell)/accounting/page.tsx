import Link from 'next/link';
import { Badge, Notice, PageHeader, Stat, Table } from '@/components/ui';
import { PrintButton } from '@/components/print-button';
import { formatMoney, monthStart, pct, today } from '@/lib/format';
import { api, apiSafe, qs } from '@/lib/server-api';
import type {
  BalanceSheet,
  CashFlowStatement,
  InventoryValuation,
  ProfitLoss,
  StatementLine,
  TrialBalance,
} from '@/lib/types';

export const metadata = { title: 'Statements' };

const VIEWS = [
  ['profit-loss', 'Profit and loss'],
  ['balance-sheet', 'Balance sheet'],
  ['trial-balance', 'Trial balance'],
  ['cash-flow', 'Cash flow'],
  ['valuation', 'Stock valuation'],
] as const;

type Search = { view?: string; from?: string; to?: string; asOf?: string };

export default async function StatementsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const view = VIEWS.find(([v]) => v === sp.view)?.[0] ?? 'profit-loss';
  const from = sp.from ?? monthStart();
  const to = sp.to ?? today();
  const asOf = sp.asOf ?? today();

  return (
    <>
      <PageHeader
        title="Statements"
        subtitle="Every figure comes from the posted journal; stock value reconciles to the inventory account."
      />
      <nav aria-label="Statement" className="no-print mb-4 flex flex-wrap gap-1">
        {VIEWS.map(([v, text]) => (
          <Link
            key={v}
            href={`/accounting?view=${v}`}
            aria-current={view === v ? 'page' : undefined}
            className={`btn ${view === v ? 'btn-primary' : ''}`}
          >
            {text}
          </Link>
        ))}
      </nav>

      {view === 'balance-sheet' || view === 'valuation' ? (
        view === 'balance-sheet' ? (
          <form className="no-print mb-4 flex items-end gap-2" method="get">
            <input type="hidden" name="view" value={view} />
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted">As of</span>
              <input className="input" type="date" name="asOf" defaultValue={asOf} />
            </label>
            <button className="btn btn-primary">Show</button>
          </form>
        ) : null
      ) : (
        <form className="no-print mb-4 flex flex-wrap items-end gap-2" method="get">
          <input type="hidden" name="view" value={view} />
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
      )}

      <p className="mb-3 hidden text-lg font-semibold print:block">
        {VIEWS.find(([v]) => v === view)?.[1]}
        {view === 'balance-sheet'
          ? ` as of ${asOf}`
          : view === 'valuation'
            ? ''
            : `, ${from} to ${to}`}
      </p>

      {view !== 'valuation' ? (
        <div className="no-print mb-4 flex flex-wrap gap-2">
          <a className="btn" href={`/accounting/export${qs({ view, from, to, asOf })}`} download>
            Export CSV
          </a>
          <PrintButton label="Print or save as PDF" />
        </div>
      ) : null}

      {view === 'profit-loss' ? <ProfitLossView from={from} to={to} /> : null}
      {view === 'cash-flow' ? <CashFlowView from={from} to={to} /> : null}
      {view === 'balance-sheet' ? <BalanceSheetView asOf={asOf} /> : null}
      {view === 'trial-balance' ? <TrialBalanceView from={from} to={to} /> : null}
      {view === 'valuation' ? <ValuationView /> : null}
    </>
  );
}

function Lines({
  title,
  lines,
  total,
  totalLabel,
}: {
  title: string;
  lines: StatementLine[];
  total: number;
  totalLabel: string;
}) {
  return (
    <section className="card overflow-hidden">
      <h2 className="border-b border-line bg-surface px-3 py-2 text-sm font-semibold">{title}</h2>
      <table className="w-full">
        <tbody className="divide-y divide-line">
          {lines.map((l) => (
            <tr key={l.code}>
              <td className="td text-muted">{l.code}</td>
              <td className="td">{l.name}</td>
              <td className="td text-right tabular-nums">{formatMoney(l.amountMinor)}</td>
            </tr>
          ))}
          {lines.length === 0 ? (
            <tr>
              <td className="td text-muted" colSpan={3}>
                Nothing in this period.
              </td>
            </tr>
          ) : null}
          <tr className="font-semibold">
            <td className="td" colSpan={2}>
              {totalLabel}
            </td>
            <td className="td text-right tabular-nums">{formatMoney(total)}</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

async function ProfitLossView({ from, to }: { from: string; to: string }) {
  const p = await api<ProfitLoss>(`/accounting/profit-loss?from=${from}&to=${to}`);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Net revenue" value={formatMoney(p.netRevenueMinor)} />
        <Stat
          label="Gross profit"
          value={formatMoney(p.grossProfitMinor)}
          hint={`Margin ${pct(p.grossMarginPct)}`}
        />
        <Stat label="Expenses" value={formatMoney(p.totalExpensesMinor)} />
        <Stat
          label="Net profit"
          value={formatMoney(p.netProfitMinor)}
          tone={p.netProfitMinor < 0 ? 'bad' : 'good'}
          hint={`Margin ${pct(p.netMarginPct)}`}
        />
      </div>
      <Lines title="Revenue" lines={p.revenue} total={p.netRevenueMinor} totalLabel="Net revenue" />
      <Lines
        title="Cost of goods sold"
        lines={p.cogs}
        total={p.totalCogsMinor}
        totalLabel="Total cost of goods sold"
      />
      <Lines
        title="Expenses"
        lines={p.expenses}
        total={p.totalExpensesMinor}
        totalLabel="Total expenses"
      />
    </div>
  );
}

function CashLines({
  title,
  lines,
  total,
  totalLabel,
}: {
  title: string;
  lines: { label: string; amountMinor: number }[];
  total: number;
  totalLabel: string;
}) {
  return (
    <section className="card overflow-hidden">
      <h2 className="border-b border-line bg-surface px-3 py-2 text-sm font-semibold">{title}</h2>
      <table className="w-full">
        <caption className="sr-only">{title}</caption>
        <tbody className="divide-y divide-line">
          {lines.map((l) => (
            <tr key={l.label}>
              <td className="td">{l.label}</td>
              <td className="td text-right tabular-nums">{formatMoney(l.amountMinor)}</td>
            </tr>
          ))}
          {lines.length === 0 ? (
            <tr>
              <td className="td text-muted" colSpan={2}>
                Nothing in this period.
              </td>
            </tr>
          ) : null}
          <tr className="font-semibold">
            <td className="td">{totalLabel}</td>
            <td className="td text-right tabular-nums">{formatMoney(total)}</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

async function CashFlowView({ from, to }: { from: string; to: string }) {
  const r = await apiSafe<CashFlowStatement>(`/accounting/cash-flow${qs({ from, to })}`);
  if (!r.ok) return <Notice tone="bad">{r.message}</Notice>;
  const c = r.data;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Opening cash" value={formatMoney(c.openingCashMinor)} />
        <Stat label="Receipts" value={formatMoney(c.totalReceiptsMinor)} />
        <Stat label="Payments" value={formatMoney(c.totalPaymentsMinor)} />
        <Stat
          label="Closing cash"
          value={formatMoney(c.closingCashMinor)}
          tone={c.closingCashMinor < 0 ? 'bad' : undefined}
          hint={`Net change ${formatMoney(c.netChangeMinor)}`}
        />
      </div>
      <div>
        {c.reconciled ? (
          <Badge tone="good">
            Closing cash equals cash in hand plus cash at the bank in the books
          </Badge>
        ) : (
          <Badge tone="bad">Closing cash differs from the cash accounts in the books</Badge>
        )}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <CashLines
          title="Receipts"
          lines={c.receipts}
          total={c.totalReceiptsMinor}
          totalLabel="Total receipts"
        />
        <CashLines
          title="Payments"
          lines={c.payments}
          total={c.totalPaymentsMinor}
          totalLabel="Total payments"
        />
      </div>
    </div>
  );
}

async function BalanceSheetView({ asOf }: { asOf: string }) {
  const b = await api<BalanceSheet>(`/accounting/balance-sheet?asOf=${asOf}`);
  return (
    <div className="space-y-4">
      <div>
        {b.balanced ? (
          <Badge tone="good">Balanced: assets equal liabilities plus equity</Badge>
        ) : (
          <Badge tone="bad">Out of balance</Badge>
        )}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Lines
          title="Assets"
          lines={b.assets}
          total={b.totalAssetsMinor}
          totalLabel="Total assets"
        />
        <div className="space-y-4">
          <Lines
            title="Liabilities"
            lines={b.liabilities}
            total={b.totalLiabilitiesMinor}
            totalLabel="Total liabilities"
          />
          <Lines
            title="Equity"
            lines={b.equity}
            total={b.totalEquityMinor}
            totalLabel="Total equity"
          />
        </div>
      </div>
    </div>
  );
}

async function TrialBalanceView({ from, to }: { from: string; to: string }) {
  const t = await api<TrialBalance>(`/accounting/trial-balance?from=${from}&to=${to}`);
  return (
    <div className="space-y-3">
      <div>
        {t.balanced ? (
          <Badge tone="good">Debits equal credits</Badge>
        ) : (
          <Badge tone="bad">Debits and credits differ</Badge>
        )}
      </div>
      <Table head={['Code', 'Account', '>Opening', '>Debit', '>Credit', '>Closing']}>
        {t.accounts.map((a) => (
          <tr key={a.code}>
            <td className="td text-muted">
              <Link className="hover:underline" href={`/accounting/ledger/${a.code}`}>
                {a.code}
              </Link>
            </td>
            <td className="td">{a.name}</td>
            <td className="td text-right tabular-nums">{formatMoney(a.openingMinor)}</td>
            <td className="td text-right tabular-nums">{formatMoney(a.debitMinor)}</td>
            <td className="td text-right tabular-nums">{formatMoney(a.creditMinor)}</td>
            <td className="td text-right tabular-nums">{formatMoney(a.closingMinor)}</td>
          </tr>
        ))}
        <tr className="font-semibold">
          <td className="td" colSpan={3}>
            Totals
          </td>
          <td className="td text-right tabular-nums">{formatMoney(t.totalDebitMinor)}</td>
          <td className="td text-right tabular-nums">{formatMoney(t.totalCreditMinor)}</td>
          <td className="td" />
        </tr>
      </Table>
    </div>
  );
}

async function ValuationView() {
  const v = await api<InventoryValuation>('/inventory/valuation');
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Stock at cost" value={formatMoney(v.totalValueMinor)} />
        <Stat label="Inventory account" value={formatMoney(v.inventoryAccountMinor)} />
      </div>
      <div>
        {v.reconciled ? (
          <Badge tone="good">Stock records and the books agree exactly</Badge>
        ) : (
          <Badge tone="bad">Stock and the inventory account differ</Badge>
        )}
      </div>
      <Table head={['SKU', 'Product', '>Stock', '>Avg cost', '>Value']}>
        {v.products.map((p) => (
          <tr key={p.productId}>
            <td className="td text-muted">{p.sku}</td>
            <td className="td">{p.name}</td>
            <td className="td text-right tabular-nums">{p.stock}</td>
            <td className="td text-right tabular-nums">{formatMoney(p.wacMinor)}</td>
            <td className="td text-right tabular-nums">{formatMoney(p.valueMinor)}</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
