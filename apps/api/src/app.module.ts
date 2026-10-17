import { Module, type DynamicModule } from '@nestjs/common';
import { HealthModule } from '@retail/kit';
import type pg from 'pg';
import { AccountingModule } from './accounting/accounting.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import type { AuthConfig } from './common/auth.js';
import { DbModule, POOL } from './db/db.module.js';
import { OpenApiController } from './openapi.js';
import { PartiesModule } from './parties/parties.module.js';
import { PurchasesModule } from './purchases/purchases.module.js';
import { SalesModule } from './sales/sales.module.js';

@Module({})
export class AppModule {
  static register(databaseUrl: string, auth: AuthConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        DbModule.forRoot(databaseUrl),
        AuthModule.forRoot(auth),
        HealthModule.registerAsync({
          inject: [POOL],
          useFactory: ((pool: pg.Pool) => ({
            database: async () => {
              await pool.query('select 1');
            },
          })) as never,
        }),
        CatalogModule,
        PartiesModule,
        SalesModule,
        PurchasesModule,
        AccountingModule,
      ],
      controllers: [OpenApiController],
    };
  }
}
