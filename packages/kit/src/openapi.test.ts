import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { OpenApiRegistry } from './openapi.js';
import { paginationQuerySchema } from './pagination.js';

const item = z.object({ id: z.uuid(), name: z.string() });

describe('OpenApiRegistry', () => {
  const doc = new OpenApiRegistry({ title: 'Test', version: '1.0.0' })
    .add({
      method: 'get',
      path: '/things/{id}',
      operationId: 'getThing',
      summary: 'Get a thing',
      request: { params: z.object({ id: z.uuid() }), query: paginationQuerySchema },
      responses: { 200: { description: 'The thing', schema: item } },
    })
    .add({
      method: 'post',
      path: '/things',
      operationId: 'createThing',
      summary: 'Create a thing',
      request: { body: z.object({ name: z.string().min(1) }) },
      responses: { 201: { description: 'Created', schema: item } },
    })
    .document() as {
    openapi: string;
    paths: Record<string, Record<string, Record<string, unknown>>>;
  };

  it('emits an OpenAPI 3.1 document', () => {
    expect(doc.openapi).toBe('3.1.0');
    expect(Object.keys(doc.paths)).toEqual(['/things/{id}', '/things']);
  });

  it('turns path and query schemas into parameters', () => {
    const params = doc.paths['/things/{id}']!['get']!['parameters'] as {
      name: string;
      in: string;
      required: boolean;
    }[];
    expect(params.find((p) => p.name === 'id')).toMatchObject({ in: 'path', required: true });
    expect(params.find((p) => p.name === 'limit')).toMatchObject({ in: 'query', required: false });
  });

  it('describes request bodies and always documents the problem response', () => {
    const post = doc.paths['/things']!['post']!;
    expect(JSON.stringify(post['requestBody'])).toContain('minLength');
    expect(JSON.stringify(post['responses'])).toContain('application/problem+json');
  });
});
