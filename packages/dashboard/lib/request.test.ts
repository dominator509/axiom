import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_BROWSER_REQUEST_TIMEOUT_MS, fetchWithTimeout } from './request';

describe('browser request helper', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('aborts a hung request at the default deadline', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<never>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(init.signal?.reason ?? new Error('request aborted')),
          { once: true },
        );
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const request = fetchWithTimeout('/api/auth/sign-in/email');
    const rejection = expect(request).rejects.toThrow('browser request timed out');
    await vi.advanceTimersByTimeAsync(DEFAULT_BROWSER_REQUEST_TIMEOUT_MS);

    await rejection;
  });

  it('propagates caller cancellation to the in-flight request', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<never>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(init.signal?.reason ?? new Error('request aborted')),
          { once: true },
        );
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const request = fetchWithTimeout('/api/v1/killswitch', { signal: controller.signal });
    const rejection = expect(request).rejects.toBe('operator cancelled');
    controller.abort('operator cancelled');

    await rejection;
  });
});
