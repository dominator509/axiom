// ─── Better Auth client (cookie-session based) ─────────────────────────────
// Talks to the BFF's Better Auth endpoints at /api/auth/*. The session cookie
// captured by apiFetch is what authenticates /api/v1/* calls.

import { apiFetch, clearStoredCookie, getStoredCookie } from './client';

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  role: string | null;
  orgId: string | null;
}

export interface SignInResult {
  token: string;
  user: SessionUser;
}

export interface AuthSession {
  user: SessionUser;
  token?: string;
}

/** Parse a Better Auth user object, throwing when the shape is unusable. */
export function parseSessionUser(value: unknown): SessionUser {
  const record = (value ?? {}) as Record<string, unknown>;
  if (typeof record['id'] !== 'string' || typeof record['email'] !== 'string') {
    throw new Error('sign-in response missing user.id or user.email');
  }
  return {
    id: record['id'],
    email: record['email'],
    name: typeof record['name'] === 'string' ? record['name'] : null,
    role: typeof record['role'] === 'string' ? record['role'] : null,
    orgId: typeof record['orgId'] === 'string' ? record['orgId'] : null,
  };
}

/**
 * POST /api/auth/sign-in/email {email, password}. Better Auth replies with
 * {token, user} and a Set-Cookie header; apiFetch stores the cookie so the
 * session is sent on all subsequent requests.
 */
export async function signIn(email: string, password: string): Promise<SignInResult> {
  const body = await apiFetch<unknown>('/api/auth/sign-in/email', {
    method: 'POST',
    body: { email, password },
  });
  const record = (body ?? {}) as Record<string, unknown>;
  if (typeof record['token'] !== 'string') {
    throw new Error('sign-in response missing token');
  }
  return {
    token: record['token'],
    user: parseSessionUser(record['user']),
  };
}

/** POST /api/auth/sign-out — clears the server session and local cookie. */
export async function signOut(): Promise<void> {
  try {
    await apiFetch<unknown>('/api/auth/sign-out', { method: 'POST' });
  } finally {
    clearStoredCookie();
  }
}

/** GET /api/auth/get-session — {user, session} or null when logged out. */
export async function getSession(): Promise<AuthSession | null> {
  const body = await apiFetch<unknown>('/api/auth/get-session');
  if (body === null || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  if (typeof record['user'] !== 'object' || record['user'] === null) return null;
  const token = getStoredCookie() ?? undefined;
  return { user: parseSessionUser(record['user']), token };
}
