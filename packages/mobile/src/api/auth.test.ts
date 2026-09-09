import { afterEach, describe, expect, it, vi } from 'vitest';

import { restoreSession } from './auth';
import { clearStoredCookie, getStoredCookie } from './client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function installLocalStorage(initialCookie: string | null): void {
  let cookie = initialCookie;
  vi.stubGlobal('localStorage', {
    getItem: vi.fn(() => cookie),
    setItem: vi.fn((_key: string, value: string) => {
      cookie = value;
    }),
    removeItem: vi.fn(() => {
      cookie = null;
    }),
  });
}

describe('restoreSession', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearStoredCookie();
  });

  it('hydrates the persisted cookie before querying the server session', async () => {
    installLocalStorage('axiom_session=persisted-session');
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        user: { id: 'user-1', email: 'operator@axiom.local', name: 'Operator' },
        session: { id: 'session-1' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const session = await restoreSession();

    expect(session?.user).toMatchObject({
      id: 'user-1',
      email: 'operator@axiom.local',
      name: 'Operator',
    });
    expect(getStoredCookie()).toBe('axiom_session=persisted-session');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Headers).get('Cookie')).toBe('axiom_session=persisted-session');
  });

  it('clears an expired persisted cookie and fails closed to login', async () => {
    installLocalStorage('axiom_session=expired-session');
    const removeItem = (
      globalThis.localStorage as unknown as { removeItem: ReturnType<typeof vi.fn> }
    ).removeItem;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(jsonResponse({ message: 'expired' }, 401)),
    );

    await expect(restoreSession()).resolves.toBeNull();

    expect(getStoredCookie()).toBeNull();
    expect(removeItem).toHaveBeenCalledWith('axiom.session.cookie');
  });
});
