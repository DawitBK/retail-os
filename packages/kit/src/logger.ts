import { pino, type DestinationStream, type Logger } from 'pino';
import { getRequestId } from './request-context.js';

export const LOGGER = 'RETAIL_LOGGER';

export interface CreateLoggerOptions {
  name?: string;
  level?: string;
  destination?: DestinationStream;
}

/** pino logger that stamps every line with the current request id and redacts credentials. */
export function createLogger(options: CreateLoggerOptions = {}): Logger {
  return pino(
    {
      name: options.name,
      level: options.level ?? 'info',
      mixin: () => {
        const requestId = getRequestId();
        return requestId ? { requestId } : {};
      },
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.token'],
        censor: '[redacted]',
      },
    },
    options.destination,
  );
}
