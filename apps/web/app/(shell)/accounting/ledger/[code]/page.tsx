import { notFound } from 'next/navigation';
import { PageHeader, Pager, Stat, Table, num } from '@/components/ui';
import { formatDate, formatMoney } from '@/lib/format';
import { apiOrNull, qs } from '@/lib/server-api';
import type { Account } from '@/lib/types';

export const metadata = { title: 'Ledger' };

interface Ledger {
  account: Account;
  openingBalanceMinor: number;
  items: {
    entryNumber: string;
    entryDate: string;
    description: string;
    debitMinor: number;
    creditMinor: number;
    runningBalanceMinor: number;
  }[];
  page: { limit: number; offset: number; total: number };
}

export default async function LedgerPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ from?: string; to?: string; offset?: string }>;
}) {
  const { code } = await params;
  const sp = await searchParams;
  const l = await apiOrNull<Ledger>(
    `/accounting/ledger/${code}${qs({ from: sp.from, to: sp.to, offset: num(sp.offset), limit: 50 })}`,
  );
  if (!l) notFound();
  return (
    <>
      <PageHeader
        title={`${l.account.code} ${l.account.name}`}
        subtitle={`${l.account.type.toLowerCase()} · normal balance ${l.account.normalBalance.toLowerCase()}`}
      />
      <div className="mb-4 grid grid-cols-2 gap-3">
        <Stat label="Opening balance" value={formatMoney(l.openingBalanceMinor)} />
        <Stat label="Balance now" value={formatMoney(l.account.balanceMinor)} />
      </div>
      <Table head={['Date', 'Entry', 'Description', '>Debit', '>Credit', '>Balance']}>
        {l.items.map((i, n) => (
          <tr key={`${i.entryNumber}-${n}`}>
            <td className="td">{formatDate(i.entryDate)}</td>
            <td className="td text-muted">{i.entryNumber}</td>
            <td className="td">{i.description}</td>
            <td className="td text-right tabular-nums">
              {i.debitMinor > 0 ? formatMoney(i.debitMinor) : ''}
            </td>
            <td className="td text-right tabular-nums">
              {i.creditMinor > 0 ? formatMoney(i.creditMinor) : ''}
            </td>
            <td className="td text-right tabular-nums">{formatMoney(i.runningBalanceMinor)}</td>
          </tr>
        ))}
      </Table>
      <Pager
        page={l.page}
        path={`/accounting/ledger/${code}`}
        params={{ from: sp.from, to: sp.to }}
      />
    </>
  );
}
