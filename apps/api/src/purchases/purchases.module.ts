import { Module } from '@nestjs/common';
import { PurchasesController } from './purchases.controller.js';
import { PurchasesService } from './purchases.service.js';

@Module({ controllers: [PurchasesController], providers: [PurchasesService] })
export class PurchasesModule {}
