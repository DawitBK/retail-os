import { Global, Inject, Module, type DynamicModule, type OnModuleDestroy } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export const POOL = 'PG_POOL';
export const DB = 'DRIZZLE_DB';

export type Database = NodePgDatabase<typeof schema>;
/** What a repository function receives: the database or an open transaction. */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

class PoolLifecycle implements OnModuleDestroy {
  constructor(@Inject(POOL) private readonly pool: pg.Pool) {}

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}

@Global()
@Module({})
export class DbModule {
  static forRoot(databaseUrl: string): DynamicModule {
    return {
      module: DbModule,
      providers: [
        {
          provide: POOL,
          useFactory: () => new pg.Pool({ connectionString: databaseUrl, max: 10 }),
        },
        { provide: DB, useFactory: (pool: pg.Pool) => drizzle(pool, { schema }), inject: [POOL] },
        PoolLifecycle,
      ],
      exports: [POOL, DB],
    };
  }
}
