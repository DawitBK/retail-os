import { Module } from '@nestjs/common';
import { PurchaseReturnsController } from './purchase-returns.controller.js';
import { PurchaseReturnsService } from './purchase-returns.service.js';
import { PurchasesController } from './purchases.controller.js';
import { PurchasesService } from './purchases.service.js';

@Module({
  controllers: [PurchasesController, PurchaseReturnsController],
  providers: [PurchasesService, PurchaseReturnsService],
})
export class PurchasesModule {}
