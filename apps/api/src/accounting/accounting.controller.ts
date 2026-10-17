import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { ZodValidationPipe } from '@retail/kit';
import { CurrentUser, Roles, type Principal } from '../common/auth.js';
import {
  asOfQuerySchema,
  codeParamsSchema,
  createExpenseSchema,
  idParamsSchema,
  ledgerQuerySchema,
  listExpensesQuerySchema,
  listJournalQuerySchema,
  openingBalanceSchema,
  rangeQuerySchema,
  voidExpenseSchema,
  type AsOfQuery,
  type CreateExpense,
  type LedgerQuery,
  type ListExpensesQuery,
  type ListJournalQuery,
  type OpeningBalance,
  type RangeQuery,
  type VoidExpense,
} from './accounting.contract.js';
import { AccountingService } from './accounting.service.js';

const idParams = new ZodValidationPipe(idParamsSchema);
/** The books are for the people who run the business: not for the till. */
const BOOKKEEPERS = ['owner', 'manager', 'accountant'] as const;
const MANAGERS = ['owner', 'manager'] as const;

@Controller('api/v1')
export class AccountingController {
  constructor(@Inject(AccountingService) private readonly accounting: AccountingService) {}

  @Roles(...BOOKKEEPERS)
  @Get('accounting/accounts')
  chart() {
    return this.accounting.chart();
  }

  @Roles(...BOOKKEEPERS)
  @Get('accounting/journal')
  journal(@Query(new ZodValidationPipe(listJournalQuerySchema)) q: ListJournalQuery) {
    return this.accounting.journal(q);
  }

  @Roles(...BOOKKEEPERS)
  @Get('accounting/ledger/:code')
  ledger(
    @Param(new ZodValidationPipe(codeParamsSchema)) p: { code: string },
    @Query(new ZodValidationPipe(ledgerQuerySchema)) q: LedgerQuery,
  ) {
    return this.accounting.ledger(p.code, q);
  }

  @Roles(...BOOKKEEPERS)
  @Get('accounting/trial-balance')
  trialBalance(@Query(new ZodValidationPipe(rangeQuerySchema)) q: RangeQuery) {
    return this.accounting.trialBalance(q);
  }

  @Roles(...BOOKKEEPERS)
  @Get('accounting/profit-loss')
  profitLoss(@Query(new ZodValidationPipe(rangeQuerySchema)) q: RangeQuery) {
    return this.accounting.profitLoss(q);
  }

  @Roles(...BOOKKEEPERS)
  @Get('accounting/balance-sheet')
  balanceSheet(@Query(new ZodValidationPipe(asOfQuerySchema)) q: AsOfQuery) {
    return this.accounting.balanceSheet(q);
  }

  @Roles(...BOOKKEEPERS)
  @Get('inventory/valuation')
  inventoryValuation() {
    return this.accounting.inventoryValuation();
  }

  @Roles('owner')
  @Post('opening-balances')
  openBooks(
    @CurrentUser() actor: Principal,
    @Body(new ZodValidationPipe(openingBalanceSchema)) body: OpeningBalance,
  ) {
    return this.accounting.openBooks(actor, body);
  }

  // ---- expenses ----

  @Roles(...BOOKKEEPERS)
  @Post('expenses')
  createExpense(
    @CurrentUser() actor: Principal,
    @Body(new ZodValidationPipe(createExpenseSchema)) body: CreateExpense,
  ) {
    return this.accounting.createExpense(actor, body);
  }

  @Roles(...BOOKKEEPERS)
  @Get('expenses')
  listExpenses(@Query(new ZodValidationPipe(listExpensesQuerySchema)) q: ListExpensesQuery) {
    return this.accounting.listExpenses(q);
  }

  @Roles(...BOOKKEEPERS)
  @Get('expenses/:id')
  getExpense(@Param(idParams) p: { id: string }) {
    return this.accounting.getExpense(p.id);
  }

  /** Whoever records an expense cannot void it: separation of duties. */
  @Roles(...MANAGERS)
  @Post('expenses/:id/void')
  @HttpCode(200)
  voidExpense(
    @CurrentUser() actor: Principal,
    @Param(idParams) p: { id: string },
    @Body(new ZodValidationPipe(voidExpenseSchema)) body: VoidExpense,
  ) {
    return this.accounting.voidExpense(actor, p.id, body);
  }
}
