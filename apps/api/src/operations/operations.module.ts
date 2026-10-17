import { Module } from '@nestjs/common';
import { AuditsService } from './audits.service.js';
import { DamageService } from './damage.service.js';
import { InsightsService } from './insights.service.js';
import { OperationsController } from './operations.controller.js';
import { ReturnsService } from './returns.service.js';

@Module({
  controllers: [OperationsController],
  providers: [ReturnsService, DamageService, AuditsService, InsightsService],
})
export class OperationsModule {}
