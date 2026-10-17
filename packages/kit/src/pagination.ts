import { z } from 'zod';

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type Pagination = z.output<typeof paginationQuerySchema>;

export interface SortSpec<F extends string = string> {
  field: F;
  direction: 'asc' | 'desc';
}

/**
 * Parse `?sort=-createdAt,name` into an ordered list. A leading `-` means descending.
 * Unknown fields are rejected, so callers never interpolate untrusted column names.
 */
export function parseSort<F extends string>(
  raw: string | undefined,
  allowed: readonly F[],
  fallback: SortSpec<F>[],
): SortSpec<F>[] {
  if (!raw) return fallback;
  const specs: SortSpec<F>[] = [];
  for (const part of raw.split(',')) {
    const direction = part.startsWith('-') ? 'desc' : 'asc';
    const field = part.replace(/^[-+]/, '');
    if (!(allowed as readonly string[]).includes(field)) {
      throw new RangeError(`Cannot sort by "${field}". Allowed: ${allowed.join(', ')}`);
    }
    specs.push({ field: field as F, direction });
  }
  return specs;
}

/** Zod schema for a `sort` query parameter restricted to `allowed` fields. */
export function sortQuerySchema<F extends string>(allowed: readonly F[], fallback: SortSpec<F>[]) {
  return z
    .string()
    .optional()
    .describe(
      `Comma-separated fields; prefix with - for descending. Allowed: ${allowed.join(', ')}`,
    )
    .transform((raw, ctx) => {
      try {
        return parseSort(raw, allowed, fallback);
      } catch (e) {
        ctx.addIssue({ code: 'custom', message: (e as Error).message });
        return z.NEVER;
      }
    });
}

export interface Page<T> {
  items: T[];
  page: { limit: number; offset: number; total: number };
}

export function toPage<T>(items: T[], total: number, p: Pagination): Page<T> {
  return { items, page: { limit: p.limit, offset: p.offset, total } };
}

/** Response schema for a page of `item`. */
export function pageSchema<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    page: z.object({
      limit: z.number().int(),
      offset: z.number().int(),
      total: z.number().int(),
    }),
  });
}
