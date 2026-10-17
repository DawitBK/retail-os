import { BadRequestException, type ArgumentsHost } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { conflict, notFound, ProblemExceptionFilter, type ProblemDetails } from './problem.js';

function run(exception: unknown) {
  const sent: { status?: number; type?: string; body?: ProblemDetails } = {};
  const res = {
    status(s: number) {
      sent.status = s;
      return res;
    },
    type(t: string) {
      sent.type = t;
      return res;
    },
    send(b: ProblemDetails) {
      sent.body = b;
      return res;
    },
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ originalUrl: '/things/1?x=2' }),
      getResponse: () => res,
    }),
  } as unknown as ArgumentsHost;
  new ProblemExceptionFilter().catch(exception, host);
  return sent;
}

describe('ProblemExceptionFilter', () => {
  it('maps domain problems', () => {
    const sent = run(notFound('no such thing'));
    expect(sent.status).toBe(404);
    expect(sent.type).toBe('application/problem+json');
    expect(sent.body).toMatchObject({
      status: 404,
      code: 'not-found',
      detail: 'no such thing',
      instance: '/things/1',
    });
  });

  it('maps conflicts', () => {
    expect(run(conflict('version-conflict', 'Version conflict')).status).toBe(409);
  });

  it('maps Zod errors to a 400 with a field list', () => {
    const result = z.object({ name: z.string() }).safeParse({});
    const sent = run(result.error);
    expect(sent.status).toBe(400);
    expect(sent.body?.errors?.[0]).toMatchObject({ path: 'name' });
  });

  it('maps Nest HTTP exceptions', () => {
    const sent = run(new BadRequestException('nope'));
    expect(sent.status).toBe(400);
    expect(sent.body).toMatchObject({ title: 'Bad request', detail: 'nope' });
  });

  it('maps middleware errors with a 4xx status', () => {
    expect(run(Object.assign(new Error('bad json'), { status: 400 })).status).toBe(400);
  });

  it('hides the details of unexpected errors', () => {
    const sent = run(new Error('database password is hunter2'));
    expect(sent.status).toBe(500);
    expect(JSON.stringify(sent.body)).not.toContain('hunter2');
  });
});
