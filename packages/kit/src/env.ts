import { z } from 'zod';

export class EnvValidationError extends Error {
  override name = 'EnvValidationError';
}

/** Validate an environment source against a Zod schema; fail fast with a readable message. */
export function parseEnv<S extends z.ZodType>(
  schema: S,
  source: Record<string, string | undefined> = process.env,
): z.output<S> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map(
      (i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`,
    );
    throw new EnvValidationError(`Invalid environment:\n${lines.join('\n')}`);
  }
  return result.data;
}

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

/** Settings every service shares. Extend with `baseEnvSchema.extend({...})`. */
export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
});

export type BaseEnv = z.output<typeof baseEnvSchema>;
