import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Logger } from 'pino';

export const REQUEST_ID_HEADER = 'x-request-id';

interface RequestContext {
  requestId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

// Accept a caller-supplied id only if it is short and made of safe characters.
const SAFE_ID = /^[\w.-]{1,128}$/;

/** Assign a request id (reuse a safe inbound one), echo it, and log one line per request. */
export function requestContextMiddleware(logger?: Logger) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const inbound = req.header(REQUEST_ID_HEADER);
    const requestId = inbound && SAFE_ID.test(inbound) ? inbound : randomUUID();
    res.setHeader(REQUEST_ID_HEADER, requestId);
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      logger?.info(
        {
          requestId,
          method: req.method,
          path: req.originalUrl.split('?')[0],
          status: res.statusCode,
          durationMs: Number(process.hrtime.bigint() - started) / 1e6,
        },
        'request completed',
      );
    });
    storage.run({ requestId }, next);
  };
}
