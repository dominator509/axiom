import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mutationFetch } from './mutation';

describe('mutationFetch', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it('reuses one idempotency key across a network retry', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('connection reset'))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await mutationFetch('/api/v1/mutate', { method: 'POST', body: '{}' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstHeaders = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Headers;
    const secondHeaders = (fetchMock.mock.calls[1]?.[1] as RequestInit).headers as Headers;
    expect(firstHeaders.get('Idempotency-Key')).toBeTruthy();
    expect(secondHeaders.get('Idempotency-Key')).toBe(firstHeaders.get('Idempotency-Key'));
  });

  it('aborts a hung mutation at the configured timeout', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        });
      });
      vi.stubGlobal('fetch', fetchMock);

      const request = mutationFetch(
        '/api/v1/mutate',
        { method: 'POST' },
        { retries: 0, timeoutMs: 25 },
      );
      const outcome = request.then(
        () => null,
        (error: unknown) => error,
      );
      await vi.advanceTimersByTimeAsync(25);

      await expect(outcome).resolves.toMatchObject({ message: 'aborted' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('propagates a caller abort to the in-flight attempt', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('caller aborted')), {
          once: true,
        });
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const request = mutationFetch(
      '/api/v1/mutate',
      { method: 'POST', signal: controller.signal },
      { retries: 0, timeoutMs: 1_000 },
    );
    const outcome = request.then(
      () => null,
      (error: unknown) => error,
    );
    controller.abort();

    await expect(outcome).resolves.toMatchObject({ message: 'caller aborted' });
  });

  it('preserves an explicit intent key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await mutationFetch('/api/v1/mutate', { method: 'POST' }, { idempotencyKey: 'intent-1' });

    const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Headers;
    expect(headers.get('Idempotency-Key')).toBe('intent-1');
  });

  it('does not dispatch a caller-cancelled request', async () => {
    const controller = new AbortController();
    controller.abort(new Error('cancelled before dispatch'));
    const fetchMock = vi.fn().mockRejectedValue(controller.signal.reason);
    vi.stubGlobal('fetch', fetchMock);
    await expect(mutationFetch('/api/v1/mutate', { signal: controller.signal }))
      .rejects.toThrow('cancelled before dispatch');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not retry after caller cancellation with the default retry policy', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockImplementation(() => {
      controller.abort(new Error('cancelled during dispatch'));
      return Promise.reject(controller.signal.reason);
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(mutationFetch('/api/v1/mutate', { signal: controller.signal }))
      .rejects.toThrow('cancelled during dispatch');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([NaN, Infinity, -1, 0.5])('rejects invalid retry budget %s before dispatch', async (retries) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(mutationFetch('/api/v1/mutate', {}, { retries })).rejects.toThrow('retries');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
