import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { ZodValidationPipe } from '@retail/kit';
import { CurrentUser, Roles, type Principal } from '../common/auth.js';
import { importInventorySchema, type ImportInventory } from './import.contract.js';
import { ImportService } from './import.service.js';

@Controller('api/v1')
export class ImportController {
  constructor(@Inject(ImportService) private readonly imports: ImportService) {}

  /** Bringing stock into the books is the owner's decision, like opening them. */
  @Roles('owner')
  @HttpCode(200)
  @Post('import/inventory')
  importInventory(
    @CurrentUser() actor: Principal,
    @Body(new ZodValidationPipe(importInventorySchema)) body: ImportInventory,
  ) {
    return this.imports.importInventory(actor, body);
  }
}
