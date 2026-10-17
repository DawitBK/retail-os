import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { ZodValidationPipe } from '@retail/kit';
import { CurrentUser, Roles, STAFF, type Principal } from '../common/auth.js';
import { AuditsService } from './audits.service.js';
import { DamageService } from './damage.service.js';
import { InsightsService } from './insights.service.js';
import {
  createAuditSchema,
  createDamageSchema,
  createReturnSchema,
  decideDamageSchema,
  idParamsSchema,
  listAuditsQuerySchema,
  listDamageQuerySchema,
  listReturnsQuerySchema,
  rejectDamageSchema,
  submitCountsSchema,
  type CreateAudit,
  type CreateDamage,
  type CreateReturn,
  type DecideDamage,
  type ListAuditsQuery,
  type ListDamageQuery,
  type ListReturnsQuery,
  type RejectDamage,
  type SubmitCounts,
} from './operations.contract.js';
import { ReturnsService } from './returns.service.js';

const idParams = new ZodValidationPipe(idParamsSchema);
const MANAGERS = ['owner', 'manager'] as const;
/** The shop floor: the people who handle goods. The accountant reads the books, not the shelves. */
const FLOOR = ['owner', 'manager', 'cashier'] as const;
const WATCHERS = ['owner', 'manager', 'accountant'] as const;

@Controller('api/v1')
export class OperationsController {
  constructor(
    @Inject(ReturnsService) private readonly returns: ReturnsService,
    @Inject(DamageService) private readonly damage: DamageService,
    @Inject(AuditsService) private readonly audits: AuditsService,
    @Inject(InsightsService) private readonly insights: InsightsService,
  ) {}

  // ---- returns ----

  @Roles(...MANAGERS)
  @Post('sales/:id/returns')
  createReturn(
    @CurrentUser() actor: Principal,
    @Param(idParams) p: { id: string },
    @Body(new ZodValidationPipe(createReturnSchema)) body: CreateReturn,
  ) {
    return this.returns.create(actor, p.id, body);
  }

  @Roles(...WATCHERS)
  @Get('returns')
  listReturns(@Query(new ZodValidationPipe(listReturnsQuerySchema)) q: ListReturnsQuery) {
    return this.returns.list(q);
  }

  // ---- damage and write-off ----

  @Roles(...FLOOR)
  @Post('damage')
  report(
    @CurrentUser() actor: Principal,
    @Body(new ZodValidationPipe(createDamageSchema)) body: CreateDamage,
  ) {
    return this.damage.report(actor, body);
  }

  @Roles(...WATCHERS)
  @Get('damage')
  listDamage(@Query(new ZodValidationPipe(listDamageQuerySchema)) q: ListDamageQuery) {
    return this.damage.list(q);
  }

  @Roles(...WATCHERS)
  @Get('damage/:id')
  getDamage(@Param(idParams) p: { id: string }) {
    return this.damage.get(p.id);
  }

  @Roles(...MANAGERS)
  @Post('damage/:id/approve')
  @HttpCode(200)
  approveDamage(
    @CurrentUser() actor: Principal,
    @Param(idParams) p: { id: string },
    @Body(new ZodValidationPipe(decideDamageSchema)) body: DecideDamage,
  ) {
    return this.damage.approve(actor, p.id, body);
  }

  @Roles(...MANAGERS)
  @Post('damage/:id/reject')
  @HttpCode(200)
  rejectDamage(
    @CurrentUser() actor: Principal,
    @Param(idParams) p: { id: string },
    @Body(new ZodValidationPipe(rejectDamageSchema)) body: RejectDamage,
  ) {
    return this.damage.reject(actor, p.id, body);
  }

  // ---- stock audits ----

  @Roles(...MANAGERS)
  @Post('stock-audits')
  startAudit(
    @CurrentUser() actor: Principal,
    @Body(new ZodValidationPipe(createAuditSchema)) body: CreateAudit,
  ) {
    return this.audits.start(actor, body);
  }

  @Roles(...WATCHERS)
  @Get('stock-audits')
  listAudits(@Query(new ZodValidationPipe(listAuditsQuerySchema)) q: ListAuditsQuery) {
    return this.audits.list(q);
  }

  @Roles(...WATCHERS)
  @Get('stock-audits/:id')
  getAudit(@Param(idParams) p: { id: string }) {
    return this.audits.get(p.id);
  }

  @Roles(...FLOOR)
  @Post('stock-audits/:id/counts')
  @HttpCode(200)
  countAudit(
    @CurrentUser() actor: Principal,
    @Param(idParams) p: { id: string },
    @Body(new ZodValidationPipe(submitCountsSchema)) body: SubmitCounts,
  ) {
    return this.audits.count(actor, p.id, body);
  }

  @Roles(...MANAGERS)
  @Post('stock-audits/:id/submit')
  @HttpCode(200)
  submitAudit(@CurrentUser() actor: Principal, @Param(idParams) p: { id: string }) {
    return this.audits.submit(actor, p.id);
  }

  @Roles(...MANAGERS)
  @Post('stock-audits/:id/approve')
  @HttpCode(200)
  approveAudit(@CurrentUser() actor: Principal, @Param(idParams) p: { id: string }) {
    return this.audits.approve(actor, p.id);
  }

  @Roles(...MANAGERS)
  @Post('stock-audits/:id/cancel')
  @HttpCode(200)
  cancelAudit(@CurrentUser() actor: Principal, @Param(idParams) p: { id: string }) {
    return this.audits.cancel(actor, p.id);
  }

  // ---- alerts and dashboard ----

  @Roles(...WATCHERS)
  @Get('alerts')
  alerts() {
    return this.insights.alerts();
  }

  @Roles(...WATCHERS)
  @Get('dashboard')
  dashboard() {
    return this.insights.dashboard();
  }

  @Roles(...STAFF)
  @Get('alerts/count')
  alertCount() {
    return this.insights.alerts().then((r) => r.counts);
  }
}
