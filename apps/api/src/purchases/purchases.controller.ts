import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { ZodValidationPipe } from '@retail/kit';
import { CurrentUser, Roles, type Principal } from '../common/auth.js';
import {
  createPurchaseSchema,
  createSupplierPaymentSchema,
  idParamsSchema,
  listPurchasesQuerySchema,
  receivePurchaseSchema,
  type CreatePurchase,
  type CreateSupplierPayment,
  type ListPurchasesQuery,
  type ReceivePurchase,
} from './purchases.contract.js';
import { PurchasesService } from './purchases.service.js';

const idParams = new ZodValidationPipe(idParamsSchema);
const MANAGERS = ['owner', 'manager'] as const;
/** Paying a supplier is the accountant's job as much as the manager's. */
const PAYERS = ['owner', 'manager', 'accountant'] as const;

@Controller('api/v1/purchases')
export class PurchasesController {
  constructor(@Inject(PurchasesService) private readonly purchases: PurchasesService) {}

  @Roles(...MANAGERS)
  @Post()
  create(
    @CurrentUser() actor: Principal,
    @Body(new ZodValidationPipe(createPurchaseSchema)) body: CreatePurchase,
  ) {
    return this.purchases.create(actor, body);
  }

  @Roles(...PAYERS)
  @Get()
  list(@Query(new ZodValidationPipe(listPurchasesQuerySchema)) q: ListPurchasesQuery) {
    return this.purchases.list(q);
  }

  @Roles(...PAYERS)
  @Get(':id')
  get(@Param(idParams) p: { id: string }) {
    return this.purchases.get(p.id);
  }

  @Roles(...MANAGERS)
  @Post(':id/receive')
  @HttpCode(200)
  receive(
    @CurrentUser() actor: Principal,
    @Param(idParams) p: { id: string },
    @Body(new ZodValidationPipe(receivePurchaseSchema)) body: ReceivePurchase,
  ) {
    return this.purchases.receive(actor, p.id, body);
  }

  @Roles(...MANAGERS)
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() actor: Principal, @Param(idParams) p: { id: string }) {
    return this.purchases.cancel(actor, p.id);
  }

  @Roles(...PAYERS)
  @Post(':id/payments')
  pay(
    @CurrentUser() actor: Principal,
    @Param(idParams) p: { id: string },
    @Body(new ZodValidationPipe(createSupplierPaymentSchema)) body: CreateSupplierPayment,
  ) {
    return this.purchases.pay(actor, p.id, body);
  }
}
