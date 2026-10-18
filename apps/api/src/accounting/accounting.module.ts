import { Module } from '@nestjs/common';
import { AccountingController } from './accounting.controller.js';
import { AccountingService } from './accounting.service.js';
import { PeriodsController } from './periods.controller.js';
import { PeriodsService } from './periods.service.js';

@Module({
  controllers: [AccountingController, PeriodsController],
  providers: [AccountingService, PeriodsService],
})
export class AccountingModule {}
