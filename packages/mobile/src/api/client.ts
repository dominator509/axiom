// ─── Pure API client ────────────────────────────────────────────────────────
// No react-native imports in this file: it runs under plain node for vitest
// and in the Expo runtime (native + web) unchanged.
//
// Auth model: Better Auth sets the session via Set-Cookie on
// POST /api/auth/sign-in/email. We capture that header into secure/native
// storage and attach it as a Cookie header on every subsequent request
// (react-native fetch lets us set Cookie; on web the header is also attached
// when the CORS policy permits it).
//
// Base URL: EXPO_PUBLIC_API_URL is inlined by Metro at build time; when unset
// the BFF is assumed to run locally on :3001.

declare const process: { env: Record<string, string | undefined> } | undefined;

import { loadSessionCookie, removeSessionCookie, saveSessionCookie } from './storage';

export const DEFAULT_API_BASE_URL = 'http://localhost:3001';

/** Resolve the BFF base URL: EXPO_PUBLIC_API_URL env var, else local default. */
export function resolveBaseUrl(): string {
  const configured = typeof process !== 'undefined' ? process.env.EXPO_PUBLIC_API_URL : undefined;
  if (configured && configured.trim().length > 0) {
    return configured.replace(/\/+$/, '');
  }
  return DEFAULT_API_BASE_URL;
}

/** Error thrown for non-2xx responses; message is extracted from the body. */
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

let storedCookie: string | null = null;

export function getStoredCookie(): string | null {
  return storedCookie;
}

export function setStoredCookie(cookie: string | null): void {
  storedCookie = cookie;
}

export function clearStoredCookie(): void {
  storedCookie = null;
}

/** Restore the cookie before the authenticated navigation is rendered. */
export async function restoreStoredCookie(): Promise<void> {
  storedCookie = await loadSessionCookie();
}

/** Clear both the in-memory and persisted session material. */
export async function clearPersistedCookie(): Promise<void> {
  storedCookie = null;
  await removeSessionCookie();
}

/**
 * Capture a Set-Cookie response header into the in-memory cookie store.
 * Request Cookie headers may contain only name/value pairs. Strip response
 * attributes (Path, HttpOnly, SameSite, Expires, ...) before persisting so a
 * native fetch implementation never sends them back as fake cookies.
 */
export async function captureSetCookie(headers: Headers): Promise<void> {
  const value = headers.get('set-cookie');
  if (value && value.trim().length > 0) {
    const cookiePairs = value
      .split(/,(?=\s*[^\s=;,]+=[^;,]*)/)
      .map((cookie) => cookie.split(';', 1)[0]?.trim() ?? '')
      .filter((cookie) => cookie.length > 0 && cookie.includes('='));
    if (cookiePairs.length > 0) {
      storedCookie = cookiePairs.join('; ');
      await saveSessionCookie(storedCookie);
    }
  }
}

/** The Cookie header value to send on the next request, if any. */
export function buildCookieHeader(): string | undefined {
  return storedCookie ?? undefined;
}

/**
 * Pull a human-readable message out of an error body. The BFF returns
 * RFC-7807 problem+json ({ detail, title, status, correlation_id }), Better
 * Auth returns { message }, and proxies may return plain text.
 */
export function extractErrorMessage(body: unknown, status: number, rawText: string): string {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    const detail = record['detail'];
    if (typeof detail === 'string' && detail.length > 0) return detail;
    const message = record['message'];
    if (typeof message === 'string' && message.length > 0) return message;
    const error = record['error'];
    if (typeof error === 'string' && error.length > 0) return error;
    const title = record['title'];
    if (typeof title === 'string' && title.length > 0) return title;
  }
  if (typeof body === 'string' && body.length > 0) return body;
  if (rawText && rawText.length > 0) return rawText;
  return `Request failed with status ${status}`;
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Reuse this key when resuming the same user intent after a lost response. */
  idempotencyKey?: string;
  /** Number of network-error retries for BFF mutations; all attempts reuse the key. */
  retries?: number;
}

function createIdempotencyKey(): string {
  const randomUuid = globalThis.crypto?.randomUUID;
  if (typeof randomUuid === 'function') return randomUuid.call(globalThis.crypto);
  return `axiom-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Fetch wrapper: resolves the base URL, attaches the stored session cookie,
 * JSON-encodes the body, captures Set-Cookie from the response, and throws
 * ApiError with a message from the body on non-2xx. BFF mutations carry one
 * stable idempotency key and retry transport failures with that same key.
 */
export async function apiFetch<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  const cookie = buildCookieHeader();
  if (cookie) {
    headers.set('Cookie', cookie);
  }
  if (options.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = `${resolveBaseUrl()}${normalizedPath}`;
  const method = options.method ?? 'GET';
  const isBffMutation = normalizedPath.startsWith('/api/v1/') && method !== 'GET';
  const idempotencyKey = isBffMutation
    ? (options.idempotencyKey ?? headers.get('Idempotency-Key') ?? createIdempotencyKey())
    : undefined;
  if (idempotencyKey) headers.set('Idempotency-Key', idempotencyKey);
  const retries = isBffMutation ? Math.max(0, options.retries ?? 1) : 0;

  let res: Response | undefined;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      res = await fetch(url, {
        method,
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: options.signal,
      });
      break;
    } catch (err) {
      lastError = err;
      if (options.signal?.aborted || attempt === retries) {
        // Network-level failure (BFF down, DNS, CORS preflight) — not an ApiError.
        throw new Error(`network error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  if (!res) throw new Error(`network error: ${String(lastError)}`);

  await captureSetCookie(res.headers);

  const raw = await res.text();
  let body: unknown = null;
  if (raw.length > 0) {
    try {
      body = JSON.parse(raw) as unknown;
    } catch {
      body = raw;
    }
  }

  if (!res.ok) {
    throw new ApiError(extractErrorMessage(body, res.status, raw), res.status, body);
  }
  return body as T;
}
