import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getHeader: vi.fn(),
}));

vi.mock('next/headers', () => ({
  headers: async () => ({ get: mocks.getHeader }),
}));

import { api, DEFAULT_SERVER_REQUEST_TIMEOUT_MS, getSession } from './api';

describe('dashboard server API client', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    mocks.getHeader.mockReturnValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
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

  it('forwards the original cookie header verbatim for model and session reads', async () => {
    const cookieHeader = 'better-auth.session_token=first%3Avalue; preference=en; better-auth.session_token=second%2Bvalue';
    mocks.getHeader.mockImplementation((name: string) => name === 'cookie' ? cookieHeader : null);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: 'model' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ user: { id: 'operator' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));
    vi.stubGlobal('fetch', fetchMock);

    await api.models.get('model');
    await getSession();

    for (const [, init] of fetchMock.mock.calls) {
      expect(new Headers(init?.headers).get('cookie')).toBe(cookieHeader);
    }
  });

  it('emits safe fixture-only status diagnostics without logging cookie values', async () => {
    const cookieHeader = 'better-auth.session_token=do-not-log-this-value';
    mocks.getHeader.mockImplementation((name: string) => name === 'cookie' ? cookieHeader : null);
    vi.stubEnv('AXIOM_BROWSER_DIAGNOSTICS', '1');
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'not found' }), { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ user: { id: 'operator', role: 'operator' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.models.get('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).rejects.toMatchObject({ status: 404 });
    await getSession();

    const diagnostics = info.mock.calls.map(([message]) => String(message));
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics.join('\n')).not.toContain(cookieHeader);
    expect(JSON.parse(diagnostics[0]!.replace('[AXIOM_BROWSER_DIAGNOSTIC] ', ''))).toEqual({
      event: 'server-api-response',
      method: 'GET',
      path: '/api/v1/models/<fixture-id>',
      status: 404,
      cookieForwarded: true,
    });
    expect(JSON.parse(diagnostics[1]!.replace('[AXIOM_BROWSER_DIAGNOSTIC] ', ''))).toEqual({
      event: 'server-session-response',
      status: 200,
      cookieForwarded: true,
      userRole: 'operator',
    });
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
