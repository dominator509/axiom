import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearStoredCookie } from './client';
import { getUiLocale, parseUiLocaleSnapshot, patchUiLocale } from './endpoints';

const snapshot = {
  locale: 'de',
  source: 'user',
  userLocale: 'de',
  orgLocale: 'es',
  supportedLocales: ['en', 'es', 'ja', 'it', 'pt-BR', 'de'],
  canSetOrg: false,
} as const;

describe('mobile F-89 locale endpoints', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    clearStoredCookie();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('validates all six supported locale choices and precedence metadata', () => {
    expect(parseUiLocaleSnapshot(snapshot)).toEqual(snapshot);
    expect(() => parseUiLocaleSnapshot({ ...snapshot, locale: 'fr' })).toThrow('unsupported ui locale');
  });

  it('loads the persisted mobile locale', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: snapshot }), { status: 200 }));
    await expect(getUiLocale()).resolves.toMatchObject({ locale: 'de', userLocale: 'de', orgLocale: 'es' });
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/api/v1/ui-locale');
  });

  it('persists one user selection with a reusable idempotency key', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: { ...snapshot, locale: 'it', userLocale: 'it' } }), { status: 200 }));
    await patchUiLocale('it', 'user', 'mobile-locale-intent');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toBeInstanceOf(Headers);
    expect((init.headers as Headers).get('Idempotency-Key')).toBe('mobile-locale-intent');
    expect(JSON.parse(String(init.body))).toEqual({ scope: 'user', locale: 'it' });
  });
});
