import { Module } from '@nestjs/common';
import { SalesController } from './sales.controller.js';
import { SalesService } from './sales.service.js';

@Module({ controllers: [SalesController], providers: [SalesService] })
export class SalesModule {}
