// ─── L3.0 API contract conventions ───
//  1. RFC-7807 problem+json error envelope with correlation_id
//  2. Idempotency-Key header enforcement on mutating routes
//  3. Per-token rate-limit buckets (429 + Retry-After)
//  4. correlation_id middleware (request-scoped, echoed in responses)
//
// Wire order in index.ts: correlation → rate limit → idempotency → routes.

import { randomUUID } from 'node:crypto';
import type { Context, Next } from 'hono';
import { sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;
  correlation_id: string;
  [key: string]: unknown;
}

/** RFC-7807 problem+json body. */
export function problem(
  status: number,
  title: string,
  detail: string,
  correlationId: string,
  extra?: Record<string, unknown>,
): ProblemDetails {
  return {
    type: 'about:blank',
    title,
    status,
    detail,
    correlation_id: correlationId,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Correlation ID
// ---------------------------------------------------------------------------

export async function correlationId(c: Context, next: Next): Promise<Response | void> {
  const incoming = c.req.header('X-Correlation-ID');
  const id = incoming && /^[A-Za-z0-9-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  c.set('correlationId', id);
  c.header('X-Correlation-ID', id);
  return await next();
}

// ---------------------------------------------------------------------------
// RFC-7807 error envelope (Hono onError)
// ---------------------------------------------------------------------------

export function onError(err: Error, c: Context): Response {
  const correlationId = (c.get('correlationId') as string) ?? randomUUID();
  const status = 500;
  const body = problem(status, 'Internal Server Error', err.message, correlationId);
  return c.json(body, status);
}

/** Convert a thrown ProblemError into the envelope. */
export class ProblemError extends Error {
  constructor(
    public readonly status: number,
    public readonly title: string,
    detail: string,
    public readonly extra?: Record<string, unknown>,
  ) {
    super(detail);
    this.name = 'ProblemError';
  }
}

/** Wrap a handler so thrown ProblemErrors become RFC-7807 responses. */
export function handleProblem(fn: (c: Context) => Promise<Response> | Response) {
  return async (c: Context): Promise<Response> => {
    try {
      return await fn(c);
    } catch (err) {
      const correlationId = (c.get('correlationId') as string) ?? randomUUID();
      if (err instanceof ProblemError) {
        return c.json(problem(err.status, err.title, err.message, correlationId, err.extra), err.status as 400 | 401 | 402 | 403 | 404 | 408 | 409 | 422 | 429 | 500 | 502 | 503 | 504);
      }
      return onError(err as Error, c);
    }
  };
}

// ---------------------------------------------------------------------------
// Idempotency-Key
// ---------------------------------------------------------------------------

const IDEMPOTENCY_STORE = new Map<string, { response: unknown; status: number; at: number }>();
const IDEM_TTL_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Enforce the Idempotency-Key header on mutating requests. When present and
 * previously seen (same key + route), returns the stored response without
 * re-executing the handler — the outside-world-safe behavior L3.0 requires
 * for mutations that touch platforms/queues.
 */
export function idempotency(required = true) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const method = c.req.method;
    const mutating = method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE';
    if (!mutating) {
      return await next();
    }

    const key = c.req.header('Idempotency-Key');
    if (!key) {
      if (required) {
        const correlationId = (c.get('correlationId') as string) ?? randomUUID();
        c.status(400);
        return c.json(
          problem(400, 'Bad Request', 'Idempotency-Key header required for this mutation', correlationId) as unknown as object,
        );
      }
      return await next();
    }

    const route = c.req.path;
    const storeKey = `${method} ${route} ${key}`;
    const now = Date.now();

    // Sweep expired entries occasionally.
    if (IDEMPOTENCY_STORE.size > 10_000) {
      for (const [k, v] of IDEMPOTENCY_STORE) {
        if (now - v.at > IDEM_TTL_MS) IDEMPOTENCY_STORE.delete(k);
      }
    }

    const prior = IDEMPOTENCY_STORE.get(storeKey);
    if (prior && now - prior.at <= IDEM_TTL_MS) {
      const status = (prior.status >= 200 && prior.status < 300 ? prior.status : 200) as 200 | 201 | 202;
      return c.json(prior.response as object, status);
    }

    // Capture the response via c.res after next() (Hono stores the final
    // Response there), then store it keyed by idempotency key.
    await next();

    const res = c.res;
    if (res && res.status >= 200 && res.status < 300) {
      try {
        const cloned = res.clone();
        const body: unknown = await cloned.json();
        IDEMPOTENCY_STORE.set(storeKey, { response: body, status: res.status, at: now });
      } catch {
        // Non-JSON response — skip caching (still executed once).
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Rate limiting (per-token buckets)
// ---------------------------------------------------------------------------

interface Bucket {
  tokens: number;
  capacity: number;
  refillPerSec: number;
  updatedAt: number;
}

const RATE_BUCKETS = new Map<string, Bucket>();
const DEFAULT_CAPACITY = 60; // 60 requests
const DEFAULT_REFILL = 10; // 10 req/sec sustained

function getBucket(key: string, capacity: number, refillPerSec: number): Bucket {
  let bucket = RATE_BUCKETS.get(key);
  const now = Date.now() / 1000;
  if (!bucket) {
    bucket = { tokens: capacity, capacity, refillPerSec, updatedAt: now };
    RATE_BUCKETS.set(key, bucket);
    return bucket;
  }
  // Refill
  const elapsed = now - bucket.updatedAt;
  bucket.tokens = Math.min(bucket.capacity, bucket.tokens + elapsed * bucket.refillPerSec);
  bucket.updatedAt = now;
  return bucket;
}

/**
 * Per-token rate limiter: keyed by the caller's API token (or client IP when
 * no token). Returns 429 with Retry-After per L3.0.
 */
export function rateLimit(opts: { capacity?: number; refillPerSec?: number } = {}) {
  const capacity = opts.capacity ?? DEFAULT_CAPACITY;
  const refillPerSec = opts.refillPerSec ?? DEFAULT_REFILL;
  return async (c: Context, next: Next): Promise<Response | void> => {
    const token =
      c.req.header('Authorization')?.replace(/^Bearer\s+/i, '') ||
      c.req.header('X-API-Key') ||
      c.req.header('x-forwarded-for') ||
      'anonymous';
    const bucket = getBucket(token, capacity, refillPerSec);

    if (bucket.tokens < 1) {
      const retryAfter = Math.max(1, Math.ceil(1 / bucket.refillPerSec));
      const correlationId = (c.get('correlationId') as string) ?? randomUUID();
      c.header('Retry-After', String(retryAfter));
      c.status(429);
      return c.json(
        problem(429, 'Too Many Requests', 'Rate limit exceeded', correlationId, {
          retry_after_seconds: retryAfter,
        }) as unknown as object,
      );
    }
    bucket.tokens -= 1;
    return await next();
  };
}

// ---------------------------------------------------------------------------
// Cursor pagination helper (L3.0: all list endpoints paginate cursor+limit)
// ---------------------------------------------------------------------------

export interface CursorPage<T> {
  data: T[];
  meta: {
    total: number;
    limit: number;
    next_cursor: string | null;
  };
}

/**
 * Encode a keyset cursor: base64url(JSON [sortValue, id]).
 * The id tiebreaker makes the cursor unambiguous when sort values collide.
 * Sort values are normalized to strings (ISO for Dates) so decodeCursor can
 * always hand back a comparable value — numeric columns included.
 */
export function encodeCursor(sortValue: string | number | Date, id: string): string {
  const v = sortValue instanceof Date ? sortValue.toISOString() : String(sortValue);
  return Buffer.from(JSON.stringify([v, id])).toString('base64url');
}

/**
 * Decode a keyset cursor. Returns null for missing/garbage cursors — callers
 * treat null as "start from the beginning" (never an error).
 */
export function decodeCursor(cursor: string | undefined | null): { value: string; id: string } | null {
  if (!cursor) return null;
  try {
    const [value, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as [unknown, unknown];
    if (typeof value !== 'string' || typeof id !== 'string') return null;
    return { value, id };
  } catch {
    return null;
  }
}

/** Parse cursor/limit query params per L3.0 conventions. */
export function parseCursor(c: Context, defaultLimit = 50, maxLimit = 200) {
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') ?? String(defaultLimit), 10) || defaultLimit, 1), maxLimit);
  const cursor = c.req.query('cursor');
  return { limit, cursor: decodeCursor(cursor) };
}

/** A sort/id column reference or raw SQL fragment (keyset operands). */
export type CursorColumn = AnyPgColumn | SQL;

/**
 * Keyset predicate for an ASC-ordered list keyed on (sortColumn, id).
 * Returns an array of SQL conditions to AND into the query:
 *   (sort > value) OR (sort = value AND id > id)
 */
export function cursorGt(sortCol: CursorColumn, idCol: CursorColumn, cursor: { value: string; id: string } | null) {
  if (!cursor) return [];
  return [
    sql`(${sortCol} > ${cursor.value} OR (${sortCol} = ${cursor.value} AND ${idCol} > ${cursor.id}))`,
  ];
}

/**
 * Keyset predicate for a DESC-ordered list keyed on (sortColumn, id).
 */
export function cursorLt(sortCol: CursorColumn, idCol: CursorColumn, cursor: { value: string; id: string } | null) {
  if (!cursor) return [];
  return [
    sql`(${sortCol} < ${cursor.value} OR (${sortCol} = ${cursor.value} AND ${idCol} < ${cursor.id}))`,
  ];
}

/**
 * Build the next_cursor from the last row of a page. Pass the sort value and
 * id of the last element; returns null when the page is short (no more data).
 */
export function nextCursor(lastSort: string | number | Date | null | undefined, lastId: string | null | undefined, limit: number, count: number): string | null {
  if (count < limit || lastSort === null || lastSort === undefined || lastId === null || lastId === undefined) return null;
  return encodeCursor(lastSort, lastId);
}
