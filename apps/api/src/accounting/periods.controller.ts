import { Body, Controller, Get, Inject, Post } from '@nestjs/common';
import { ZodValidationPipe } from '@retail/kit';
import { CurrentUser, Roles, type Principal } from '../common/auth.js';
import { closeYearSchema, type CloseYear } from './periods.contract.js';
import { PeriodsService } from './periods.service.js';

@Controller('api/v1/accounting')
export class PeriodsController {
  constructor(@Inject(PeriodsService) private readonly periods: PeriodsService) {}

  @Roles('owner', 'manager', 'accountant')
  @Get('periods')
  list() {
    return this.periods.list();
  }

  /** Closing a year is permanent and moves profit into equity: the owner decides. */
  @Roles('owner')
  @Post('close-year')
  close(
    @CurrentUser() actor: Principal,
    @Body(new ZodValidationPipe(closeYearSchema)) body: CloseYear,
  ) {
    return this.periods.closeYear(actor, body);
  }
}
