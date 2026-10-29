import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { ZodValidationPipe } from '@retail/kit';
import { rangeQuerySchema, type RangeQuery } from '../accounting/accounting.contract.js';
import { Roles } from '../common/auth.js';
import {
  cashflowQuerySchema,
  forecastQuerySchema,
  productHealthQuerySchema,
  productIdParamsSchema,
  profitabilityQuerySchema,
  trajectoryQuerySchema,
  windowQuerySchema,
  type CashflowQuery,
  type ForecastQuery,
  type ProductHealthQuery,
  type ProfitabilityQuery,
  type TrajectoryQuery,
  type WindowQuery,
} from './analytics.contract.js';
import { AnalyticsService } from './analytics.service.js';

/** Margins, stock efficiency and forecasts are for the people who run the shop, not for the till. */
const WATCHERS = ['owner', 'manager', 'accountant'] as const;
/** Anything that tells someone what to buy is for the people who buy. */
const BUYERS = ['owner', 'manager'] as const;

@Controller('api/v1')
export class AnalyticsController {
  constructor(@Inject(AnalyticsService) private readonly analytics: AnalyticsService) {}

  @Roles(...WATCHERS)
  @Get('analytics/products')
  productHealth(@Query(new ZodValidationPipe(productHealthQuerySchema)) q: ProductHealthQuery) {
    return this.analytics.productHealth(q);
  }

  @Roles(...WATCHERS)
  @Get('analytics/products/:id')
  productAnalytics(@Param(new ZodValidationPipe(productIdParamsSchema)) p: { id: string }) {
    return this.analytics.productAnalytics(p.id);
  }

  @Roles(...WATCHERS)
  @Get('analytics/inventory')
  inventory(@Query(new ZodValidationPipe(windowQuerySchema)) q: WindowQuery) {
    return this.analytics.inventory(q);
  }

  @Roles(...WATCHERS)
  @Get('analytics/profitability')
  profitability(@Query(new ZodValidationPipe(profitabilityQuerySchema)) q: ProfitabilityQuery) {
    return this.analytics.profitability(q);
  }

  @Roles(...WATCHERS)
  @Get('analytics/cashflow')
  cashflow(@Query(new ZodValidationPipe(cashflowQuerySchema)) q: CashflowQuery) {
    return this.analytics.cashflow(q);
  }

  @Roles(...WATCHERS)
  @Get('analytics/trajectory')
  trajectory(@Query(new ZodValidationPipe(trajectoryQuerySchema)) q: TrajectoryQuery) {
    return this.analytics.trajectory(q);
  }

  @Roles(...WATCHERS)
  @Get('accounting/cash-flow')
  cashFlowStatement(@Query(new ZodValidationPipe(rangeQuerySchema)) q: RangeQuery) {
    return this.analytics.cashFlowStatement(q);
  }

  @Roles(...BUYERS)
  @Get('forecasting/reorder')
  reorder(@Query(new ZodValidationPipe(forecastQuerySchema)) q: ForecastQuery) {
    return this.analytics.reorder(q);
  }

  @Roles(...BUYERS)
  @Get('forecasting/dead-stock')
  deadStock(@Query(new ZodValidationPipe(forecastQuerySchema)) q: ForecastQuery) {
    return this.analytics.deadStock(q);
  }

  @Roles(...BUYERS)
  @Get('forecasting/sales')
  salesForecast(@Query(new ZodValidationPipe(forecastQuerySchema)) q: ForecastQuery) {
    return this.analytics.salesForecast(q);
  }

  @Roles(...BUYERS)
  @Get('forecasting/suggestions')
  suggestions(@Query(new ZodValidationPipe(forecastQuerySchema)) q: ForecastQuery) {
    return this.analytics.suggestions(q);
  }
}
