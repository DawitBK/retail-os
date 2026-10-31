import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWithRetry } from './resilient-fetch';

const ok = () => new Response('{}', { status: 200 });
const reset = () => new TypeError('fetch failed');
const quick = { delaysMs: [0, 0] };

afterEach(() => vi.unstubAllGlobals());

describe('fetchWithRetry', () => {
  it('asks a read again when the connection broke, up to two more times', async () => {
    const f = vi
      .fn()
      .mockRejectedValueOnce(reset())
      .mockRejectedValueOnce(reset())
      .mockResolvedValueOnce(ok());
    vi.stubGlobal('fetch', f);
    expect((await fetchWithRetry('http://api/x', {}, quick)).status).toBe(200);
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('asks a read again on 502, 503 and 504, and returns the later answer', async () => {
    for (const status of [502, 503, 504]) {
      const f = vi
        .fn()
        .mockResolvedValueOnce(new Response('', { status }))
        .mockResolvedValueOnce(ok());
      vi.stubGlobal('fetch', f);
      expect((await fetchWithRetry('http://api/x', { method: 'GET' }, quick)).status).toBe(200);
      expect(f).toHaveBeenCalledTimes(2);
    }
  });

  it('gives up after the third failure with the real error', async () => {
    const f = vi.fn().mockRejectedValue(reset());
    vi.stubGlobal('fetch', f);
    await expect(fetchWithRetry('http://api/x', {}, quick)).rejects.toThrow('fetch failed');
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('hands back the gateway answer itself when every try got one', async () => {
    const f = vi.fn().mockImplementation(async () => new Response('', { status: 503 }));
    vi.stubGlobal('fetch', f);
    expect((await fetchWithRetry('http://api/x', {}, quick)).status).toBe(503);
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('never repeats a write, because an earlier try may have reached the API', async () => {
    const f = vi.fn().mockRejectedValue(reset());
    vi.stubGlobal('fetch', f);
    await expect(
      fetchWithRetry('http://api/x', { method: 'POST', body: '{}' }, quick),
    ).rejects.toThrow();
    expect(f).toHaveBeenCalledTimes(1);
    const g = vi.fn().mockResolvedValue(new Response('', { status: 503 }));
    vi.stubGlobal('fetch', g);
    expect((await fetchWithRetry('http://api/x', { method: 'DELETE' }, quick)).status).toBe(503);
    expect(g).toHaveBeenCalledTimes(1);
  });

  it('does not retry an answer the API really gave (401, 403, 404, 422, 500)', async () => {
    for (const status of [401, 403, 404, 422, 500]) {
      const f = vi.fn().mockResolvedValue(new Response('', { status }));
      vi.stubGlobal('fetch', f);
      expect((await fetchWithRetry('http://api/x', {}, quick)).status).toBe(status);
      expect(f).toHaveBeenCalledTimes(1);
    }
  });

  it('stops retrying when the time budget cannot cover another try', async () => {
    const f = vi.fn().mockRejectedValue(reset());
    vi.stubGlobal('fetch', f);
    await expect(
      fetchWithRetry('http://api/x', {}, { delaysMs: [0, 0], budgetMs: 500 }),
    ).rejects.toThrow('fetch failed');
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('puts a time limit on every try', async () => {
    const f = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal('fetch', f);
    await fetchWithRetry('http://api/x');
    expect(f.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });
});
