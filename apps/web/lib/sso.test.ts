import { afterEach, describe, expect, it, vi } from 'vitest';
import { ssoConfig } from './sso';

vi.mock('server-only', () => ({}));
vi.mock('./session', () => ({ API_URL: 'http://api.test' }));

const ON = {
  enabled: true,
  authorizationEndpoint: 'https://idp.test/authorize',
  endSessionEndpoint: 'https://idp.test/logout',
  clientId: 'web',
};

const json = (body: unknown, status = 200) =>
  status === 204
    ? new Response(null, { status })
    : new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });

/** A fetch that never answers until its signal aborts, like a stalled tunnel. */
const stalled = (_url: unknown, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
  });

/** Records the waits between tries instead of really waiting. */
function recorder() {
  const waits: number[] = [];
  return { waits, sleep: async (ms: number) => void waits.push(ms) };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('ssoConfig', () => {
  it('returns enabled with the config when the first try answers', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => json(ON));
    const { sleep, waits } = recorder();

    const result = await ssoConfig({ fetchImpl, sleep });

    expect(result).toEqual({ status: 'enabled', config: ON });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('http://api.test/api/v1/auth/oidc/config');
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ cache: 'no-store' });
    expect(waits).toEqual([]);
  });

  it('gives each try 8 seconds, then tries again after 300 ms and succeeds', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(stalled)
      .mockImplementationOnce(async () => json(ON));

    const pending = ssoConfig({ fetchImpl });

    await vi.advanceTimersByTimeAsync(7999);
    const firstSignal = fetchImpl.mock.calls[0]?.[1]?.signal;
    expect(firstSignal?.aborted).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(firstSignal?.aborted).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(299);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    expect(await pending).toEqual({ status: 'enabled', config: ON });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('recovers from a network error', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockImplementationOnce(async () => json(ON));
    const { sleep, waits } = recorder();

    expect(await ssoConfig({ fetchImpl, sleep })).toEqual({ status: 'enabled', config: ON });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(waits).toEqual([300]);
  });

  it('is unavailable after three failed tries, waiting 300 ms then 900 ms', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'));
    const { sleep, waits } = recorder();

    expect(await ssoConfig({ fetchImpl, sleep })).toEqual({ status: 'unavailable' });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([300, 900]);
  });

  it('is unavailable when every try times out', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>(stalled);

    const pending = ssoConfig({ fetchImpl });
    await vi.advanceTimersByTimeAsync(8000 + 300 + 8000 + 900 + 8000);

    expect(await pending).toEqual({ status: 'unavailable' });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('is disabled when the API answers 200 and says enabled is false, without retrying', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => json({ enabled: false }));
    const { sleep, waits } = recorder();

    expect(await ssoConfig({ fetchImpl, sleep })).toEqual({ status: 'disabled' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(waits).toEqual([]);
  });

  it('does not retry a definite answer, enabled or disabled', async () => {
    for (const [body, status] of [
      [ON, 'enabled'],
      [{ enabled: false }, 'disabled'],
    ] as const) {
      const fetchImpl = vi.fn<typeof fetch>(async () => json(body));
      const { sleep, waits } = recorder();

      expect((await ssoConfig({ fetchImpl, sleep })).status).toBe(status);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(waits).toEqual([]);
    }
  });

  it('stops retrying as soon as a definite answer arrives', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async () => json({ message: 'bad gateway' }, 502))
      .mockImplementationOnce(async () => json({ enabled: false }));
    const { sleep, waits } = recorder();

    expect(await ssoConfig({ fetchImpl, sleep })).toEqual({ status: 'disabled' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(waits).toEqual([300]);
  });

  it('treats a non-200 answer as unavailable, never as disabled', async () => {
    for (const status of [201, 202, 204, 301, 401, 404, 429, 500, 502, 503, 530]) {
      const fetchImpl = vi.fn<typeof fetch>(async () => json({ enabled: false }, status));
      const { sleep } = recorder();

      expect(await ssoConfig({ fetchImpl, sleep })).toEqual({ status: 'unavailable' });
      expect(fetchImpl).toHaveBeenCalledTimes(3);
    }
  });

  it('treats a 200 that is not the expected answer as unavailable', async () => {
    const bodies = [
      () => new Response('<html>tunnel error</html>', { status: 200 }),
      () => json(null),
      () => json([]),
      () => json({}),
      () => json({ enabled: 'yes' }),
    ];
    for (const make of bodies) {
      const fetchImpl = vi.fn<typeof fetch>(async () => make());
      const { sleep } = recorder();

      expect(await ssoConfig({ fetchImpl, sleep })).toEqual({ status: 'unavailable' });
      expect(fetchImpl).toHaveBeenCalledTimes(3);
    }
  });

  it('never throws, even when fetch throws before returning a promise', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => {
      throw new Error('boom');
    });
    const { sleep } = recorder();

    await expect(ssoConfig({ fetchImpl, sleep })).resolves.toEqual({ status: 'unavailable' });
  });

  it('makes a single try when asked to', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'));
    const { sleep, waits } = recorder();

    expect(await ssoConfig({ attempts: 1, fetchImpl, sleep })).toEqual({ status: 'unavailable' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(waits).toEqual([]);
  });
});
