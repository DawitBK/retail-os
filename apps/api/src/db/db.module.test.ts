import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPool } from './db.module.js';

describe('createPool', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs an idle connection error instead of throwing, so the process stays up', async () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    // A pool opens no connection until the first query, so no database is needed here.
    const pool = createPool('postgres://user:secret@localhost:5432/db');
    try {
      expect(() =>
        pool.emit('error', new Error('terminating connection due to administrator command')),
      ).not.toThrow();
      expect(error).toHaveBeenCalledTimes(1);
      expect(String(error.mock.calls[0]?.[0])).toContain('terminating connection');
      expect(String(error.mock.calls[0]?.[0])).not.toContain('secret');
    } finally {
      await pool.end();
    }
  });
});
