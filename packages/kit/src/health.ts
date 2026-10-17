import {
  Controller,
  type DynamicModule,
  Get,
  Inject,
  type InjectionToken,
  type ModuleMetadata,
  Module,
  SetMetadata,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';

export const HEALTH_CHECKS = 'RETAIL_HEALTH_CHECKS';

/** A readiness check: resolve if healthy, reject (or time out) if not. */
export type HealthCheck = () => Promise<void>;
export type HealthChecks = Record<string, HealthCheck>;

const CHECK_TIMEOUT_MS = 2000;

async function withTimeout(check: HealthCheck): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timed out')), CHECK_TIMEOUT_MS);
  });
  try {
    await Promise.race([check(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Marks the controller open to the application's default-deny auth guard (the same key as its `@Public()`). */
@SetMetadata('retail:public', true)
@Controller('health')
export class HealthController {
  constructor(@Inject(HEALTH_CHECKS) private readonly checks: HealthChecks) {}

  /** Liveness: the process is up. Never touches dependencies. */
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  /** Readiness: every dependency check passes; 503 otherwise. */
  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response) {
    const results: Record<string, { status: 'up' | 'down'; error?: string }> = {};
    await Promise.all(
      Object.entries(this.checks).map(async ([name, check]) => {
        try {
          await withTimeout(check);
          results[name] = { status: 'up' };
        } catch (e) {
          results[name] = { status: 'down', error: (e as Error).message };
        }
      }),
    );
    const ok = Object.values(results).every((r) => r.status === 'up');
    res.status(ok ? 200 : 503);
    return { status: ok ? 'ok' : 'unavailable', checks: results };
  }
}

export interface HealthModuleAsyncOptions {
  imports?: ModuleMetadata['imports'];
  inject?: InjectionToken[];
  useFactory: (...deps: never[]) => HealthChecks;
}

@Module({})
export class HealthModule {
  static register(checks: HealthChecks = {}): DynamicModule {
    return {
      module: HealthModule,
      controllers: [HealthController],
      providers: [{ provide: HEALTH_CHECKS, useValue: checks }],
    };
  }

  /** Build the checks from other providers (for example a database pool). */
  static registerAsync(options: HealthModuleAsyncOptions): DynamicModule {
    return {
      module: HealthModule,
      imports: options.imports ?? [],
      controllers: [HealthController],
      providers: [
        { provide: HEALTH_CHECKS, useFactory: options.useFactory, inject: options.inject ?? [] },
      ],
    };
  }
}
