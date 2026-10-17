import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Logger } from 'pino';
import { ZodError } from 'zod';
import { getRequestId } from './request-context.js';

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';
const TYPE_PREFIX = 'urn:retail:problem:';

/** RFC 9457 problem details, plus `code`, `requestId` and optional `errors` extensions. */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  code?: string;
  requestId?: string;
  errors?: { path: string; message: string; code: string }[];
  [extension: string]: unknown;
}

/** Throw from domain code to produce a specific problem response. */
export class ProblemException extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly title: string,
    readonly detail?: string,
    readonly extensions: Record<string, unknown> = {},
  ) {
    super(detail ?? title);
    this.name = 'ProblemException';
  }
}

export const notFound = (detail?: string) =>
  new ProblemException(404, 'not-found', 'Resource not found', detail);
export const conflict = (code: string, title: string, detail?: string) =>
  new ProblemException(409, code, title, detail);
export const unprocessable = (code: string, title: string, detail?: string) =>
  new ProblemException(422, code, title, detail);
/** 429 with the number of seconds to wait, also sent as the Retry-After header. */
export const tooManyRequests = (retryAfterSeconds: number, detail?: string) =>
  new ProblemException(429, 'rate-limited', 'Too many requests', detail, { retryAfterSeconds });

function statusTitle(status: number): string {
  const key = HttpStatus[status];
  return key
    ? key
        .replace(/_/g, ' ')
        .toLowerCase()
        .replace(/^./, (c) => c.toUpperCase())
    : 'Error';
}

function problemFor(exception: unknown): ProblemDetails {
  if (exception instanceof ProblemException) {
    return {
      type: TYPE_PREFIX + exception.code,
      title: exception.title,
      status: exception.status,
      ...(exception.detail ? { detail: exception.detail } : {}),
      code: exception.code,
      ...exception.extensions,
    };
  }
  if (exception instanceof ZodError) {
    return {
      type: `${TYPE_PREFIX}validation`,
      title: 'Request validation failed',
      status: 400,
      code: 'validation',
      errors: exception.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
        code: i.code,
      })),
    };
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const body = exception.getResponse();
    const detail =
      typeof body === 'string'
        ? body
        : typeof (body as { message?: unknown }).message === 'string'
          ? (body as { message: string }).message
          : undefined;
    return {
      type: `${TYPE_PREFIX}http-${status}`,
      title: statusTitle(status),
      status,
      ...(detail ? { detail } : {}),
      code: `http-${status}`,
    };
  }
  // Errors raised by Express middleware (e.g. malformed JSON) carry a 4xx `status`.
  const status = (exception as { status?: unknown } | null)?.status;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    return {
      type: `${TYPE_PREFIX}http-${status}`,
      title: statusTitle(status),
      status,
      code: `http-${status}`,
    };
  }
  return {
    type: `${TYPE_PREFIX}internal`,
    title: 'Internal server error',
    status: 500,
    code: 'internal',
  };
}

/** Turns every thrown error into an `application/problem+json` response. */
@Catch()
export class ProblemExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger?: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const problem = problemFor(exception);
    problem.instance = req.originalUrl.split('?')[0];
    const requestId = getRequestId();
    if (requestId) problem.requestId = requestId;
    if (problem.status >= 500) {
      this.logger?.error({ err: exception, requestId }, 'unhandled error');
    }
    const wait = (problem as unknown as Record<string, unknown>)['retryAfterSeconds'];
    if (problem.status === 429 && typeof wait === 'number') res.set('Retry-After', String(wait));
    res.status(problem.status).type(PROBLEM_CONTENT_TYPE).send(problem);
  }
}
