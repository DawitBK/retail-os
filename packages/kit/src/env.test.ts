import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { baseEnvSchema, EnvValidationError, parseEnv } from './env.js';

describe('parseEnv', () => {
  it('applies defaults and coerces numbers', () => {
    const env = parseEnv(baseEnvSchema, { PORT: '8080' });
    expect(env).toEqual({ NODE_ENV: 'development', PORT: 8080, LOG_LEVEL: 'info' });
  });

  it('lists every problem in one error', () => {
    const schema = baseEnvSchema.extend({ DATABASE_URL: z.url() });
    const attempt = () => parseEnv(schema, { PORT: '0', LOG_LEVEL: 'loud' });
    expect(attempt).toThrow(EnvValidationError);
    expect(attempt).toThrow(/PORT/);
    expect(attempt).toThrow(/LOG_LEVEL/);
    expect(attempt).toThrow(/DATABASE_URL/);
  });
});
