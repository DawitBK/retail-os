import type { INestApplication } from '@nestjs/common';
import type { Express } from 'express';
import type { Logger } from 'pino';
import { ProblemExceptionFilter } from './problem.js';
import { requestContextMiddleware } from './request-context.js';

/** Apply the kit's cross-cutting behaviour to an application (used by main.ts and by tests). */
export function applyKit(app: INestApplication, logger?: Logger): void {
  (app.getHttpAdapter().getInstance() as Express).disable('x-powered-by');
  app.use(requestContextMiddleware(logger));
  app.useGlobalFilters(new ProblemExceptionFilter(logger));
}
