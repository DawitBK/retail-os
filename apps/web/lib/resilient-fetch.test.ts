import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWithRetry } from './resilient-fetch';

const ok = () => new Response('{}', { status: 200 });

afterEach(() => vi.unstubAllGlobals());

describe('fetchWithRetry', () => {
  it('asks a read again once when the connection broke', async () => {
    const f = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(ok());
    vi.stubGlobal('fetch', f);
    const res = await fetchWithRetry('http://api/x', {}, 0);
    expect(res.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('asks a read again once on 502, 503 and 504, and returns the second answer', async () => {
    for (const status of [502, 503, 504]) {
      const f = vi
        .fn()
        .mockResolvedValueOnce(new Response('', { status }))
        .mockResolvedValueOnce(ok());
      vi.stubGlobal('fetch', f);
      expect((await fetchWithRetry('http://api/x', { method: 'GET' }, 0)).status).toBe(200);
      expect(f).toHaveBeenCalledTimes(2);
    }
  });

  it('gives up after the second failure with the real error', async () => {
    const f = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', f);
    await expect(fetchWithRetry('http://api/x', {}, 0)).rejects.toThrow('fetch failed');
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('never repeats a write, because the first try may have reached the API', async () => {
    const f = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', f);
    await expect(
      fetchWithRetry('http://api/x', { method: 'POST', body: '{}' }, 0),
    ).rejects.toThrow();
    expect(f).toHaveBeenCalledTimes(1);
    const g = vi.fn().mockResolvedValue(new Response('', { status: 503 }));
    vi.stubGlobal('fetch', g);
    expect((await fetchWithRetry('http://api/x', { method: 'DELETE' }, 0)).status).toBe(503);
    expect(g).toHaveBeenCalledTimes(1);
  });

  it('does not retry an answer the API really gave (401, 403, 404, 422, 500)', async () => {
    for (const status of [401, 403, 404, 422, 500]) {
      const f = vi.fn().mockResolvedValue(new Response('', { status }));
      vi.stubGlobal('fetch', f);
      expect((await fetchWithRetry('http://api/x', {}, 0)).status).toBe(status);
      expect(f).toHaveBeenCalledTimes(1);
    }
  });

  it('puts a time limit on every try', async () => {
    const f = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal('fetch', f);
    await fetchWithRetry('http://api/x');
    expect(f.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });
});
