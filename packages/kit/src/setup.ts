import type { INestApplication } from '@nestjs/common';
import type { Express } from 'express';
import type { Logger } from 'pino';
import { ProblemExceptionFilter } from './problem.js';
import { DEFAULT_RATE_LIMITS, rateLimitMiddleware, type RateLimitOptions } from './rate-limit.js';
import { requestContextMiddleware } from './request-context.js';

export interface KitOptions {
  /** Override the rate limits, or pass `false` to apply none. */
  rateLimit?: RateLimitOptions | false;
}

/**
 * Apply the kit's cross-cutting behaviour to an application (used by main.ts and by tests).
 *
 * `TRUST_PROXY_HOPS` says how many reverse proxies sit in front of the API (0 by default). Only
 * then is `X-Forwarded-For` believed, so a client cannot choose the address it is limited by.
 */
export function applyKit(app: INestApplication, logger?: Logger, options: KitOptions = {}): void {
  const express = app.getHttpAdapter().getInstance() as Express;
  express.disable('x-powered-by');
  const hops = Number(process.env['TRUST_PROXY_HOPS'] ?? 0);
  if (Number.isInteger(hops) && hops > 0) express.set('trust proxy', hops);
  app.use(requestContextMiddleware(logger));
  if (options.rateLimit !== false)
    app.use(rateLimitMiddleware(options.rateLimit ?? DEFAULT_RATE_LIMITS));
  app.useGlobalFilters(new ProblemExceptionFilter(logger));
}
