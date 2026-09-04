// ─── Unit tests for the pure API-client logic ──────────────────────────────
// No react-native imports anywhere in the tested modules; the only mock is
// global fetch. Run with: pnpm --filter @axiom/mobile test

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ApiError,
  apiFetch,
  buildCookieHeader,
  captureSetCookie,
  clearStoredCookie,
  extractErrorMessage,
  getStoredCookie,
  resolveBaseUrl,
  setStoredCookie,
} from './client';
import { parseCrashReport, parseCursorPage, parseDigestCard, parseOrgSettings } from './endpoints';

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('resolveBaseUrl', () => {
  const originalEnv = process.env.EXPO_PUBLIC_API_URL;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.EXPO_PUBLIC_API_URL;
    } else {
      process.env.EXPO_PUBLIC_API_URL = originalEnv;
    }
  });

  it('falls back to the local BFF default when EXPO_PUBLIC_API_URL is unset', () => {
    delete process.env.EXPO_PUBLIC_API_URL;
    expect(resolveBaseUrl()).toBe('http://localhost:3001');
  });

  it('uses EXPO_PUBLIC_API_URL when set, stripping trailing slashes', () => {
    process.env.EXPO_PUBLIC_API_URL = 'https://bff.axiom.example/';
    expect(resolveBaseUrl()).toBe('https://bff.axiom.example');
  });
});

describe('cookie store', () => {
  beforeEach(() => clearStoredCookie());
  afterEach(() => clearStoredCookie());

  it('captures Set-Cookie and replays it as a Cookie header', async () => {
    await captureSetCookie(
      new Headers({
        'set-cookie': 'axiom_session=abc123; Path=/; HttpOnly; SameSite=Lax',
      }),
    );
    expect(getStoredCookie()).toBe('axiom_session=abc123');
    expect(buildCookieHeader()).toBe('axiom_session=abc123');
  });

  it('keeps multiple cookie pairs while stripping response attributes', async () => {
    await captureSetCookie(
      new Headers({
        'set-cookie':
          'axiom_session=abc123; Path=/; HttpOnly, axiom_session_data=def456; Path=/; SameSite=Lax',
      }),
    );
    expect(buildCookieHeader()).toBe('axiom_session=abc123; axiom_session_data=def456');
  });

  it('ignores responses without a Set-Cookie header', async () => {
    await captureSetCookie(new Headers({ 'content-type': 'application/json' }));
    expect(getStoredCookie()).toBeNull();
  });

  it('clearStoredCookie empties the store', () => {
    setStoredCookie('axiom_session=xyz');
    clearStoredCookie();
    expect(getStoredCookie()).toBeNull();
    expect(buildCookieHeader()).toBeUndefined();
  });
});

describe('apiFetch', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    clearStoredCookie();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearStoredCookie();
  });

  it('POSTs JSON, captures the session cookie, and parses the JSON body', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ token: 'tok-1', user: { id: 'u1', email: 'a@b.c' } }, 200, {
        'set-cookie': 'axiom_session=sess-1; Path=/',
      }),
    );

    const result = await apiFetch<{ token: string; user: { id: string; email: string } }>(
      '/api/auth/sign-in/email',
      { method: 'POST', body: { email: 'a@b.c', password: 'secret123' } },
    );

    expect(result.token).toBe('tok-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3001/api/auth/sign-in/email');
    expect(init.method).toBe('POST');
    expect((init.headers as Headers).get('Content-Type')).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ email: 'a@b.c', password: 'secret123' }));
    // Set-Cookie from the response is now stored…
    expect(getStoredCookie()).toContain('axiom_session=sess-1');
  });

  it('sends the captured cookie on subsequent requests', async () => {
    setStoredCookie('axiom_session=sess-9; Path=/');
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [] }));

    await apiFetch<unknown>('/api/v1/digests');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Headers).get('Cookie')).toContain('axiom_session=sess-9');
  });

  it('reuses one idempotency key across a BFF mutation network retry', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('connection reset'))
      .mockResolvedValueOnce(jsonResponse({ success: true }));

    await apiFetch<unknown>('/api/v1/digests/generate', { method: 'POST', body: {} });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstHeaders = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Headers;
    const secondHeaders = (fetchMock.mock.calls[1]?.[1] as RequestInit).headers as Headers;
    expect(firstHeaders.get('Idempotency-Key')).toBeTruthy();
    expect(secondHeaders.get('Idempotency-Key')).toBe(firstHeaders.get('Idempotency-Key'));
  });

  it('preserves an explicit BFF mutation intent key', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true }));

    await apiFetch<unknown>('/api/v1/org-settings', {
      method: 'PATCH',
      body: { viralSharing: true },
      idempotencyKey: 'mobile-intent-1',
      retries: 0,
    });

    const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Headers;
    expect(headers.get('Idempotency-Key')).toBe('mobile-intent-1');
  });

  it('throws ApiError with the RFC-7807 detail on non-2xx', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          type: 'about:blank',
          title: 'Unauthorized',
          status: 401,
          detail: 'unauthorized',
          correlation_id: 'corr-1',
        },
        401,
      ),
    );

    const error = await apiFetch<unknown>('/api/v1/org-settings').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(401);
    expect((error as ApiError).message).toBe('unauthorized');
  });

  it('falls back to the Better Auth {message} body on non-2xx', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'Invalid email or password' }, 401));

    const error = await apiFetch<unknown>('/api/auth/sign-in/email', {
      method: 'POST',
      body: { email: 'x@y.z', password: 'wrong' },
    }).catch((e: unknown) => e);
    expect((error as ApiError).message).toBe('Invalid email or password');
  });
});

describe('extractErrorMessage', () => {
  it('prefers problem+json detail, then message, then raw text', () => {
    expect(
      extractErrorMessage(
        { title: 'Bad Request', detail: 'bad body', correlation_id: 'c' },
        400,
        '{"detail":"bad body"}',
      ),
    ).toBe('bad body');
    expect(extractErrorMessage({ message: 'nope' }, 401, '')).toBe('nope');
    expect(extractErrorMessage('plain text error', 502, 'plain text error')).toBe(
      'plain text error',
    );
    expect(extractErrorMessage(null, 500, '')).toBe('Request failed with status 500');
  });
});

describe('response parsing', () => {
  it('parses a cursor page of digest cards', () => {
    const page = parseCursorPage(
      {
        data: [
          {
            id: 'card-1',
            title: 'Weekly digest',
            description: 'Top posts',
            channel: 'digest',
            createdAt: '2026-08-03T00:00:00.000Z',
            config: { week: '2026-08-03' },
          },
        ],
        meta: { total: 1, limit: 20, next_cursor: 'abc' },
      },
      parseDigestCard,
    );

    expect(page.data).toHaveLength(1);
    expect(page.data[0]?.title).toBe('Weekly digest');
    expect(page.data[0]?.config).toEqual({ week: '2026-08-03' });
    expect(page.meta.next_cursor).toBe('abc');
  });

  it('parses crash reports and org settings', () => {
    const report = parseCrashReport({
      id: 'cr-1',
      fingerprint: 'f1',
      service: 'worker',
      message: 'boom',
      count: 3,
      status: 'open',
      lastSeen: '2026-08-07T10:00:00.000Z',
      severity: 'sev-1',
    });
    expect(report.status).toBe('open');
    expect(report.count).toBe(3);
    expect(report.severity).toBe('sev-1');

    const settings = parseOrgSettings({
      orgId: 'org-1',
      publishingEnabled: true,
      viralSharing: false,
    });
    expect(settings.viralSharing).toBe(false);
    expect(settings.orgId).toBe('org-1');
  });

  it('rejects malformed shapes instead of silently accepting them', () => {
    expect(() => parseCrashReport({ id: 'cr-1', status: 'weird' })).toThrow(/response shape/);
    expect(() => parseOrgSettings({ orgId: 'org-1' })).toThrow(/response shape/);
    expect(() => parseCursorPage({ data: 'nope', meta: {} }, parseDigestCard)).toThrow(
      /response shape/,
    );
  });
});
