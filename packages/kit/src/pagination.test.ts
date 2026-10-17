import { describe, expect, it } from 'vitest';
import {
  pageSchema,
  paginationQuerySchema,
  parseSort,
  sortQuerySchema,
  toPage,
} from './pagination.js';
import { z } from 'zod';

const allowed = ['name', 'createdAt'] as const;
const fallback = [{ field: 'createdAt' as const, direction: 'desc' as const }];

describe('pagination', () => {
  it('defaults and bounds limit/offset', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ limit: 20, offset: 0 });
    expect(paginationQuerySchema.parse({ limit: '5', offset: '10' })).toEqual({
      limit: 5,
      offset: 10,
    });
    expect(() => paginationQuerySchema.parse({ limit: '101' })).toThrow();
    expect(() => paginationQuerySchema.parse({ offset: '-1' })).toThrow();
  });

  it('parses sort lists and falls back when absent', () => {
    expect(parseSort(undefined, allowed, fallback)).toEqual(fallback);
    expect(parseSort('-createdAt,name', allowed, fallback)).toEqual([
      { field: 'createdAt', direction: 'desc' },
      { field: 'name', direction: 'asc' },
    ]);
  });

  it('rejects sort fields that are not allow-listed', () => {
    expect(() => parseSort('password', allowed, fallback)).toThrow(RangeError);
    const schema = sortQuerySchema(allowed, fallback);
    expect(schema.safeParse('name; drop table').success).toBe(false);
    expect(schema.parse('name')).toEqual([{ field: 'name', direction: 'asc' }]);
  });

  it('builds a page envelope', () => {
    expect(toPage(['a'], 7, { limit: 1, offset: 2 })).toEqual({
      items: ['a'],
      page: { limit: 1, offset: 2, total: 7 },
    });
    expect(pageSchema(z.string()).parse(toPage(['a'], 1, { limit: 1, offset: 0 }))).toBeTruthy();
  });
});
