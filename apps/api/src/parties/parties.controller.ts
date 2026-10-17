import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ZodValidationPipe } from '@retail/kit';
import { CurrentUser, Roles, STAFF, type Principal } from '../common/auth.js';
import {
  createCustomerSchema,
  createSupplierSchema,
  idParamsSchema,
  listCustomersQuerySchema,
  listSuppliersQuerySchema,
  updateCustomerSchema,
  updateSupplierSchema,
  type CreateCustomer,
  type CreateSupplier,
  type ListCustomersQuery,
  type ListSuppliersQuery,
  type UpdateCustomer,
  type UpdateSupplier,
} from './parties.contract.js';
import { PartiesService } from './parties.service.js';

const idParams = new ZodValidationPipe(idParamsSchema);
const MANAGERS = ['owner', 'manager'] as const;
/** Buying side: the accountant reads suppliers (they pay the bills) but does not change them. */
const BUYING = ['owner', 'manager', 'accountant'] as const;

@Controller('api/v1')
export class PartiesController {
  constructor(@Inject(PartiesService) private readonly parties: PartiesService) {}

  // ---- customers: the till creates them on the spot ----

  @Roles(...STAFF)
  @Post('customers')
  createCustomer(
    @CurrentUser() actor: Principal,
    @Body(new ZodValidationPipe(createCustomerSchema)) body: CreateCustomer,
  ) {
    return this.parties.createCustomer(actor, body);
  }

  @Roles(...STAFF)
  @Get('customers')
  listCustomers(@Query(new ZodValidationPipe(listCustomersQuerySchema)) q: ListCustomersQuery) {
    return this.parties.listCustomers(q);
  }

  @Roles(...STAFF)
  @Get('customers/:id')
  getCustomer(@Param(idParams) p: { id: string }) {
    return this.parties.getCustomer(p.id);
  }

  @Roles(...MANAGERS)
  @Patch('customers/:id')
  updateCustomer(
    @CurrentUser() actor: Principal,
    @Param(idParams) p: { id: string },
    @Body(new ZodValidationPipe(updateCustomerSchema)) body: UpdateCustomer,
  ) {
    return this.parties.updateCustomer(actor, p.id, body);
  }

  @Roles(...MANAGERS)
  @Delete('customers/:id')
  @HttpCode(204)
  async deleteCustomer(@CurrentUser() actor: Principal, @Param(idParams) p: { id: string }) {
    await this.parties.deleteCustomer(actor, p.id);
  }

  // ---- suppliers ----

  @Roles(...MANAGERS)
  @Post('suppliers')
  createSupplier(
    @CurrentUser() actor: Principal,
    @Body(new ZodValidationPipe(createSupplierSchema)) body: CreateSupplier,
  ) {
    return this.parties.createSupplier(actor, body);
  }

  @Roles(...BUYING)
  @Get('suppliers')
  listSuppliers(@Query(new ZodValidationPipe(listSuppliersQuerySchema)) q: ListSuppliersQuery) {
    return this.parties.listSuppliers(q);
  }

  @Roles(...BUYING)
  @Get('suppliers/:id')
  getSupplier(@Param(idParams) p: { id: string }) {
    return this.parties.getSupplier(p.id);
  }

  @Roles(...MANAGERS)
  @Patch('suppliers/:id')
  updateSupplier(
    @CurrentUser() actor: Principal,
    @Param(idParams) p: { id: string },
    @Body(new ZodValidationPipe(updateSupplierSchema)) body: UpdateSupplier,
  ) {
    return this.parties.updateSupplier(actor, p.id, body);
  }

  @Roles(...MANAGERS)
  @Delete('suppliers/:id')
  @HttpCode(204)
  async deleteSupplier(@CurrentUser() actor: Principal, @Param(idParams) p: { id: string }) {
    await this.parties.deleteSupplier(actor, p.id);
  }
}
