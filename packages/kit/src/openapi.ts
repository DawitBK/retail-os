import { z } from 'zod';

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

export interface ResponseDef {
  description: string;
  schema?: z.ZodType;
  contentType?: string;
}

export interface RouteDef {
  method: HttpMethod;
  /** OpenAPI path template, e.g. `/widgets/{id}`. */
  path: string;
  operationId: string;
  summary: string;
  tags?: string[];
  request?: {
    params?: z.ZodObject;
    query?: z.ZodObject;
    headers?: z.ZodObject;
    body?: z.ZodType;
  };
  responses: Record<number, ResponseDef>;
}

type Json = Record<string, unknown>;

export const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  code: z.string().optional(),
  requestId: z.string().optional(),
  errors: z.array(z.object({ path: z.string(), message: z.string(), code: z.string() })).optional(),
});

function jsonSchema(schema: z.ZodType, io: 'input' | 'output'): Json {
  const out = { ...(z.toJSONSchema(schema, { io }) as Json) };
  delete out['$schema'];
  return out;
}

function parameters(where: 'path' | 'query' | 'header', obj: z.ZodObject): Json[] {
  const shape = jsonSchema(obj, 'input') as {
    properties?: Record<string, Json>;
    required?: string[];
  };
  return Object.entries(shape.properties ?? {}).map(([name, schema]) => ({
    name,
    in: where,
    required: where === 'path' ? true : (shape.required ?? []).includes(name),
    schema,
  }));
}

/** Collects route contracts (the same Zod schemas the pipes use) into an OpenAPI 3.1 document. */
export class OpenApiRegistry {
  private readonly routes: RouteDef[] = [];

  constructor(private readonly info: { title: string; version: string; description?: string }) {}

  add(route: RouteDef): this {
    this.routes.push(route);
    return this;
  }

  document(): Json {
    const paths: Record<string, Record<string, Json>> = {};
    for (const route of this.routes) {
      const params = [
        ...(route.request?.params ? parameters('path', route.request.params) : []),
        ...(route.request?.query ? parameters('query', route.request.query) : []),
        ...(route.request?.headers ? parameters('header', route.request.headers) : []),
      ];
      const responses: Record<string, Json> = {};
      for (const [status, def] of Object.entries(route.responses)) {
        responses[status] = {
          description: def.description,
          ...(def.schema
            ? {
                content: {
                  [def.contentType ?? 'application/json']: {
                    schema: jsonSchema(def.schema, 'output'),
                  },
                },
              }
            : {}),
        };
      }
      responses['default'] = {
        description: 'Problem details (RFC 9457)',
        content: { 'application/problem+json': { schema: jsonSchema(problemSchema, 'output') } },
      };
      (paths[route.path] ??= {})[route.method] = {
        operationId: route.operationId,
        summary: route.summary,
        ...(route.tags ? { tags: route.tags } : {}),
        ...(params.length ? { parameters: params } : {}),
        ...(route.request?.body
          ? {
              requestBody: {
                required: true,
                content: {
                  'application/json': { schema: jsonSchema(route.request.body, 'input') },
                },
              },
            }
          : {}),
        responses,
      };
    }
    return { openapi: '3.1.0', info: this.info, paths };
  }
}
