import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { applyKit } from '@retail/kit';
import type { Logger } from 'pino';
import { AppModule } from './app.module.js';
import { configureTimezone } from './common/time.js';
import type { Env } from './config.js';

export interface AppOptions {
  logger?: Logger;
}

/** Build the application. Shared by `main.ts` and the integration tests. */
export async function createApp(env: Env, options: AppOptions = {}): Promise<INestApplication> {
  configureTimezone(env.BUSINESS_TIMEZONE);
  const app = await NestFactory.create(
    AppModule.register(env.DATABASE_URL, {
      jwtSecret: env.JWT_SECRET,
      accessTtlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
      refreshTtlSeconds: env.REFRESH_TOKEN_TTL_SECONDS,
      oidc:
        env.OIDC_ISSUER && env.OIDC_CLIENT_ID && env.OIDC_CLIENT_SECRET
          ? {
              issuer: env.OIDC_ISSUER,
              clientId: env.OIDC_CLIENT_ID,
              clientSecret: env.OIDC_CLIENT_SECRET,
              internalUrl: env.OIDC_INTERNAL_URL,
            }
          : undefined,
    }),
    { logger: env.NODE_ENV === 'test' ? false : ['error', 'warn'] },
  );
  applyKit(app, options.logger);
  await app.init();
  return app;
}
