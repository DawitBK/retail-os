import { NextResponse, type NextRequest } from 'next/server';
import { pickDate } from '@/lib/analytics';
import { today, monthStart } from '@/lib/format';
import { ApiError, api, qs } from '@/lib/server-api';
import {
  balanceSheetCsv,
  cashFlowCsv,
  isExportView,
  profitLossCsv,
  trialBalanceCsv,
} from '@/lib/statements-csv';
import type { BalanceSheet, CashFlowStatement, ProfitLoss, TrialBalance } from '@/lib/types';

/**
 * Downloads a statement as CSV. It calls the API as the signed-in person (the session cookie),
 * so the API's own role checks decide who may export what.
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const view = sp.get('view');
  if (!isExportView(view)) {
    return NextResponse.json(
      {
        title: 'Unknown statement',
        detail: 'Choose profit-loss, balance-sheet, trial-balance or cash-flow.',
      },
      { status: 400 },
    );
  }
  const from = pickDate(sp.get('from') ?? undefined) ?? monthStart();
  const to = pickDate(sp.get('to') ?? undefined) ?? today();
  const asOf = pickDate(sp.get('asOf') ?? undefined) ?? today();

  try {
    let csv: string;
    let name: string;
    switch (view) {
      case 'profit-loss':
        csv = profitLossCsv(await api<ProfitLoss>(`/accounting/profit-loss${qs({ from, to })}`));
        name = `profit-loss_${from}_${to}`;
        break;
      case 'balance-sheet':
        csv = balanceSheetCsv(await api<BalanceSheet>(`/accounting/balance-sheet${qs({ asOf })}`));
        name = `balance-sheet_${asOf}`;
        break;
      case 'trial-balance':
        csv = trialBalanceCsv(
          await api<TrialBalance>(`/accounting/trial-balance${qs({ from, to })}`),
        );
        name = `trial-balance_${from}_${to}`;
        break;
      case 'cash-flow':
        csv = cashFlowCsv(await api<CashFlowStatement>(`/accounting/cash-flow${qs({ from, to })}`));
        name = `cash-flow_${from}_${to}`;
        break;
    }
    return new NextResponse(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${name}.csv"`,
        'cache-control': 'no-store',
      },
    });
  } catch (e) {
    if (e instanceof ApiError) {
      return NextResponse.json(
        { title: e.problem.title, detail: e.message, status: e.status },
        { status: e.status },
      );
    }
    throw e;
  }
}
