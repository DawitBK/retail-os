import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ZodValidationPipe } from '@retail/kit';
import type { Response } from 'express';
import { CurrentUser, Roles, STAFF, type Principal } from '../common/auth.js';
import {
  createReceiptSchema,
  createSaleSchema,
  idempotencyHeaderSchema,
  idParamsSchema,
  listSalesQuerySchema,
  voidSaleSchema,
  type CreateReceipt,
  type CreateSale,
  type ListSalesQuery,
  type VoidSale,
} from './sales.contract.js';
import { SalesService } from './sales.service.js';

const idParams = new ZodValidationPipe(idParamsSchema);
const TILL = ['owner', 'manager', 'cashier'] as const;
const MANAGERS = ['owner', 'manager'] as const;

@Controller('api/v1/sales')
export class SalesController {
  constructor(@Inject(SalesService) private readonly sales: SalesService) {}

  @Roles(...TILL)
  @Post()
  async create(
    @CurrentUser() actor: Principal,
    @Req() req: { headers: unknown },
    @Body(new ZodValidationPipe(createSaleSchema)) body: CreateSale,
    @Res({ passthrough: true }) res: Response,
  ) {
    const headers = idempotencyHeaderSchema.parse(req.headers);
    const result = await this.sales.create(actor, body, headers['idempotency-key']);
    res.status(result.status);
    if (result.replayed) res.setHeader('Idempotent-Replay', 'true');
    return result.body;
  }

  /** Cashiers see their own sales; everyone else sees all of them. The accountant reads, never sells. */
  @Roles(...STAFF)
  @Get()
  list(
    @CurrentUser() actor: Principal,
    @Query(new ZodValidationPipe(listSalesQuerySchema)) query: ListSalesQuery,
  ) {
    return this.sales.list(actor, query);
  }

  @Roles(...STAFF)
  @Get(':id')
  get(@CurrentUser() actor: Principal, @Param(idParams) p: { id: string }) {
    return this.sales.get(actor, p.id);
  }

  @Roles(...MANAGERS)
  @Post(':id/void')
  @HttpCode(200)
  void(
    @CurrentUser() actor: Principal,
    @Param(idParams) p: { id: string },
    @Body(new ZodValidationPipe(voidSaleSchema)) body: VoidSale,
  ) {
    return this.sales.void(actor, p.id, body);
  }

  @Roles(...TILL)
  @Post(':id/payments')
  receivePayment(
    @CurrentUser() actor: Principal,
    @Param(idParams) p: { id: string },
    @Body(new ZodValidationPipe(createReceiptSchema)) body: CreateReceipt,
  ) {
    return this.sales.receivePayment(actor, p.id, body);
  }
}
