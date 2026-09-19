import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAll: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: mocks.getAll }),
}));

import { api, DEFAULT_SERVER_REQUEST_TIMEOUT_MS, getSession } from './api';

describe('dashboard server API client', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    mocks.getAll.mockReturnValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('adds an idempotency key to server-side API mutations', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: {} }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await api.models.create({ displayName: 'Test model', handle: 'test-model' });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get('Idempotency-Key')).toMatch(/^\S+$/);
    expect(headers.get('content-type')).toBe('application/json');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it.each(['revise', 'reject'] as const)(
    'echoes the reviewed version for %s mutations',
    async (action) => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: {} })));
      vi.stubGlobal('fetch', fetchMock);
      const revisionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      if (action === 'revise') await api.bundles.revise('bundle', 'Make it warmer', revisionId);
      else await api.bundles.reject('bundle', revisionId);
      const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
      expect(JSON.parse(String(init.body)).revisionId).toBe(revisionId);
      expect(new Headers(init.headers).get('Idempotency-Key')).toBeTruthy();
    },
  );

  it('aborts a hung server API request at the default deadline', async () => {
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

    const request = api.models.list();
    const rejection = expect(request).rejects.toThrow('server API request timed out');
    await vi.advanceTimersByTimeAsync(DEFAULT_SERVER_REQUEST_TIMEOUT_MS);

    await rejection;
  });

  it('fails closed when session bootstrap times out', async () => {
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

    const session = getSession();
    await vi.advanceTimersByTimeAsync(DEFAULT_SERVER_REQUEST_TIMEOUT_MS);

    await expect(session).resolves.toBeNull();
  });
});
