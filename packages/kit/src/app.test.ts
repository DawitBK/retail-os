import { Body, Controller, type INestApplication, Module, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { HealthModule } from './health.js';
import { ZodValidationPipe } from './zod-pipe.js';
import { applyKit } from './setup.js';

const body = z.object({ name: z.string().min(1) });

@Controller('echo')
class EchoController {
  @Post()
  echo(@Body(new ZodValidationPipe(body)) input: z.output<typeof body>) {
    return input;
  }
}

let ok = true;

@Module({
  imports: [
    HealthModule.register({
      db: async () => {
        if (!ok) throw new Error('connection refused');
      },
    }),
  ],
  controllers: [EchoController],
})
class TestModule {}

describe('kit wired into an application', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [TestModule] }).compile();
    app = moduleRef.createNestApplication();
    applyKit(app);
    await app.init();
  });

  afterAll(() => app.close());

  it('sets and echoes a request id, and reuses a safe inbound one', async () => {
    const fresh = await request(app.getHttpServer()).get('/health/live');
    expect(fresh.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const reused = await request(app.getHttpServer())
      .get('/health/live')
      .set('x-request-id', 'trace-123');
    expect(reused.headers['x-request-id']).toBe('trace-123');
    const unsafe = await request(app.getHttpServer())
      .get('/health/live')
      .set('x-request-id', 'bad id with spaces');
    expect(unsafe.headers['x-request-id']).not.toBe('bad id with spaces');
  });

  it('does not advertise the framework', async () => {
    const res = await request(app.getHttpServer()).get('/health/live');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('validates bodies and answers with problem+json', async () => {
    const good = await request(app.getHttpServer()).post('/echo').send({ name: 'a' });
    expect(good.status).toBe(201);
    const bad = await request(app.getHttpServer()).post('/echo').send({ name: '' });
    expect(bad.status).toBe(400);
    expect(bad.headers['content-type']).toContain('application/problem+json');
    expect(bad.body).toMatchObject({ code: 'validation', instance: '/echo' });
    expect(bad.body.requestId).toBe(bad.headers['x-request-id']);
  });

  it('answers malformed JSON with a 400 problem', async () => {
    const res = await request(app.getHttpServer())
      .post('/echo')
      .set('content-type', 'application/json')
      .send('{not json');
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toContain('application/problem+json');
  });

  it('reports readiness and flips to 503 when a check fails', async () => {
    const up = await request(app.getHttpServer()).get('/health/ready');
    expect(up.status).toBe(200);
    expect(up.body.checks.db.status).toBe('up');
    ok = false;
    const down = await request(app.getHttpServer()).get('/health/ready');
    expect(down.status).toBe(503);
    expect(down.body.checks.db).toMatchObject({ status: 'down', error: 'connection refused' });
    ok = true;
  });
});
