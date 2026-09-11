import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('next/server', () => ({
  NextResponse: {
    next: () => ({ type: 'next' }),
    redirect: (url: URL) => ({ type: 'redirect', url: url.toString() }),
  },
}));

import { middleware, SESSION_REQUEST_TIMEOUT_MS } from './middleware';

function requestFor(pathname: string): NextRequest {
  return {
    nextUrl: { pathname },
    headers: { get: vi.fn().mockReturnValue('') },
    url: `http://dashboard.test${pathname}`,
  } as unknown as NextRequest;
}

describe('dashboard auth middleware', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it.each(['/linkbio', '/linkbio/model', '/linkbio/model/s/slug'])('forwards public Native routes without session lookup: %s', async (path) => {
    const fetch = vi.fn().mockResolvedValue(new Response('null'));
    vi.stubGlobal('fetch', fetch);
    expect(await middleware(requestFor(path))).toEqual({ type: 'next' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['/linkbioprivate', '/models/model/linkbio'])('keeps private or lookalike routes authenticated: %s', async (path) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('null')));
    expect(await middleware(requestFor(path))).toEqual({ type: 'redirect', url: 'http://dashboard.test/login' });
  });

  it('fails closed and redirects when session bootstrap hangs', async () => {
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

    const result = middleware(requestFor('/'));
    await vi.advanceTimersByTimeAsync(SESSION_REQUEST_TIMEOUT_MS);

    await expect(result).resolves.toEqual({
      type: 'redirect',
      url: 'http://dashboard.test/login',
    });
  });
});
