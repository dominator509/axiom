// Node/Vitest and web fallback. Metro resolves storage.native.ts on iOS and
// Android, where the implementation below is replaced by SecureStore.

const COOKIE_KEY = 'axiom.session.cookie';

export async function loadSessionCookie(): Promise<string | null> {
  if (typeof globalThis.localStorage === 'undefined') return null;
  return globalThis.localStorage.getItem(COOKIE_KEY);
}

export async function saveSessionCookie(cookie: string): Promise<void> {
  if (typeof globalThis.localStorage !== 'undefined') {
    globalThis.localStorage.setItem(COOKIE_KEY, cookie);
  }
}

export async function removeSessionCookie(): Promise<void> {
  if (typeof globalThis.localStorage !== 'undefined') {
    globalThis.localStorage.removeItem(COOKIE_KEY);
  }
}
