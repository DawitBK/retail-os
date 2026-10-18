import { Body, Controller, Get, Inject, Param, Post, Query } from '@nestjs/common';
import { ZodValidationPipe } from '@retail/kit';
import { CurrentUser, Roles, type Principal } from '../common/auth.js';
import {
  createPurchaseReturnSchema,
  idParamsSchema,
  listPurchaseReturnsQuerySchema,
  type CreatePurchaseReturn,
  type ListPurchaseReturnsQuery,
} from './purchase-returns.contract.js';
import { PurchaseReturnsService } from './purchase-returns.service.js';

const MANAGERS = ['owner', 'manager'] as const;
const PAYERS = ['owner', 'manager', 'accountant'] as const;

@Controller('api/v1')
export class PurchaseReturnsController {
  constructor(@Inject(PurchaseReturnsService) private readonly returns: PurchaseReturnsService) {}

  /** Sending goods back is a managerial decision: stock and the amount owed both change. */
  @Roles(...MANAGERS)
  @Post('purchases/:id/returns')
  create(
    @CurrentUser() actor: Principal,
    @Param(new ZodValidationPipe(idParamsSchema)) p: { id: string },
    @Body(new ZodValidationPipe(createPurchaseReturnSchema)) body: CreatePurchaseReturn,
  ) {
    return this.returns.create(actor, p.id, body);
  }

  @Roles(...PAYERS)
  @Get('purchase-returns')
  list(@Query(new ZodValidationPipe(listPurchaseReturnsQuerySchema)) q: ListPurchaseReturnsQuery) {
    return this.returns.list(q);
  }
}
