// ─── L3.0 API contract conventions ───
//  1. RFC-7807 problem+json error envelope with correlation_id
//  2. Idempotency-Key header enforcement on mutating routes
//  3. Per-token rate-limit buckets (429 + Retry-After)
//  4. correlation_id middleware (request-scoped, echoed in responses)
//
// Wire order in index.ts: correlation → rate limit → idempotency → routes.

import { createHash, randomUUID } from 'node:crypto';
import { BlockList, isIP } from 'node:net';
import type { Context, Next } from 'hono';
import { sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { db } from '@axiom/db';
import { captureUnhandledApiError, describeCrash } from './crash-reporter.js';

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

/**
 * Serialize an RFC-7807 response with the media type required by the
 * contract. Hono's `c.json()` always labels a response as application/json,
 * even when its body is a Problem Details document.
 */
export function problemResponse(
  body: ProblemDetails,
  status: number,
  additionalHeaders?: Record<string, string>,
): Response {
  const headers = new Headers(additionalHeaders);
  headers.set('Content-Type', 'application/problem+json; charset=UTF-8');
  headers.set('X-Correlation-ID', body.correlation_id);
  return new Response(JSON.stringify(body), { status, headers });
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

export async function onError(err: Error, c: Context): Promise<Response> {
  const correlationId = (c.get('correlationId') as string) ?? randomUUID();
  const status = 500;
  // Keep implementation details in server logs; public 5xx responses expose
  // only a stable message plus the correlation ID used to find that log.
  const details = describeCrash(err);
  console.error('Unhandled API error', { correlationId, error: details.message });
  await captureUnhandledApiError(c.get('orgId') as string | undefined, err, correlationId);
  const body = problem(
    status,
    'Internal Server Error',
    'An internal error occurred',
    correlationId,
  );
  return problemResponse(body, status);
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
        return problemResponse(
          problem(err.status, err.title, err.message, correlationId, err.extra),
          err.status,
        );
      }
      return onError(err as Error, c);
    }
  };
}

// ---------------------------------------------------------------------------
// Idempotency-Key
// ---------------------------------------------------------------------------

const IDEM_TTL_MS = 24 * 60 * 60 * 1000; // 24h

interface IdempotencyRow {
  id: string;
  state: 'pending' | 'completed';
  request_hash: string;
  owner_token: string | null;
  status: number | null;
  response_body: unknown;
  expires_at: Date;
}

function isProblemDetails(value: unknown): value is ProblemDetails {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    record.type === 'about:blank' &&
    typeof record.title === 'string' &&
    typeof record.status === 'number' &&
    typeof record.detail === 'string' &&
    typeof record.correlation_id === 'string'
  );
}

function queryRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return ((result as { rows?: T[] } | null)?.rows ?? []) as T[];
}

function idempotencyResponse(
  c: Context,
  status: number,
  title: string,
  detail: string,
  extra?: Record<string, unknown>,
  additionalHeaders?: Record<string, string>,
): Response {
  const correlationId = (c.get('correlationId') as string) ?? randomUUID();
  return problemResponse(
    problem(status, title, detail, correlationId, extra),
    status,
    additionalHeaders,
  );
}

/**
 * Enforce the Idempotency-Key header on mutating requests. When present and
 * previously seen (same org + method + route + key), returns the stored
 * response without re-executing the handler — the outside-world-safe behavior
 * L3.0 requires for mutations that touch platforms/queues.
 *
 * Durable: a pending reservation is committed before the handler executes,
 * then promoted to completed with the response. Concurrent duplicates cannot
 * execute the handler, and DB failures fail closed rather than risking a
 * repeated outside-world side effect.
 */
export function idempotency(required = true) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const method = c.req.method;
    const mutating =
      method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE';
    if (!mutating) {
      return await next();
    }

    const key = c.req.header('Idempotency-Key');
    if (!key) {
      if (required) {
        const correlationId = (c.get('correlationId') as string) ?? randomUUID();
        return problemResponse(
          problem(
            400,
            'Bad Request',
            'Idempotency-Key header required for this mutation',
            correlationId,
          ),
          400,
        );
      }
      return await next();
    }

    const route = c.req.path;
    const orgId = c.get('orgId') as string | undefined;
    if (!orgId) {
      return idempotencyResponse(c, 503, 'Service Unavailable', 'Idempotency store unavailable');
    }

    const requestBytes = Buffer.from(await c.req.raw.clone().arrayBuffer());
    // Include the query string in the fingerprint. Some mutating routes use
    // query parameters for resource identity (for example, modelId on the
    // social-account connect route); omitting it could replay a response for
    // a different resource when an idempotency key is accidentally reused.
    const query = new URL(c.req.url).search;
    const requestHash = createHash('sha256')
      .update(method)
      .update('\n')
      .update(route)
      .update('\n')
      .update(query)
      .update('\n')
      .update(c.req.header('content-type') ?? '')
      .update('\n')
      .update(requestBytes)
      .digest('hex');
    const ownerToken = randomUUID();
    const expiresAt = new Date(Date.now() + IDEM_TTL_MS);

    let reservation: { owner: boolean; row: IdempotencyRow };
    try {
      reservation = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('app.current_org_id', ${orgId}, true)`);
        const claimed = queryRows<IdempotencyRow>(
          await tx.execute(sql`
            INSERT INTO api_idempotency
              (org_id, method, route, idem_key, state, request_hash, owner_token, expires_at)
            VALUES
              (${orgId}, ${method}, ${route}, ${key}, 'pending', ${requestHash}, ${ownerToken}, ${expiresAt})
            ON CONFLICT (org_id, method, route, idem_key) DO UPDATE SET
              state = 'pending',
              request_hash = EXCLUDED.request_hash,
              owner_token = EXCLUDED.owner_token,
              status = NULL,
              response_body = NULL,
              created_at = now(),
              expires_at = EXCLUDED.expires_at
            WHERE api_idempotency.state = 'completed'
              AND api_idempotency.expires_at <= now()
            RETURNING id, state, request_hash, owner_token, status, response_body, expires_at
          `),
        );
        if (claimed[0]) return { owner: true, row: claimed[0] };
        const existing = queryRows<IdempotencyRow>(
          await tx.execute(sql`
            SELECT id, state, request_hash, owner_token, status, response_body, expires_at
              FROM api_idempotency
             WHERE org_id = ${orgId}
               AND method = ${method}
               AND route = ${route}
               AND idem_key = ${key}
             LIMIT 1
          `),
        )[0];
        if (!existing) throw new Error('idempotency reservation disappeared');
        return { owner: false, row: existing };
      });
    } catch {
      return idempotencyResponse(c, 503, 'Service Unavailable', 'Idempotency store unavailable');
    }

    if (!reservation.owner) {
      if (reservation.row.request_hash !== requestHash) {
        return idempotencyResponse(
          c,
          409,
          'Conflict',
          'Idempotency-Key was already used with a different request',
        );
      }
      if (reservation.row.state === 'pending') {
        return idempotencyResponse(
          c,
          409,
          'Conflict',
          'A request with this key is still in progress',
          { retry_after_seconds: 2 },
          { 'Retry-After': '2' },
        );
      }
      if (reservation.row.status === null || reservation.row.response_body === null) {
        return idempotencyResponse(
          c,
          503,
          'Service Unavailable',
          'Stored idempotency response is invalid',
        );
      }
      const headers = new Headers({ 'Content-Type': 'application/json' });
      if (isProblemDetails(reservation.row.response_body)) {
        headers.set('Content-Type', 'application/problem+json; charset=UTF-8');
        headers.set('X-Correlation-ID', reservation.row.response_body.correlation_id);
      } else {
        const correlationId = c.get('correlationId') as string | undefined;
        if (correlationId) headers.set('X-Correlation-ID', correlationId);
      }
      return new Response(JSON.stringify(reservation.row.response_body), {
        status: reservation.row.status,
        headers,
      });
    }

    // Execute only after durable ownership is established. If a downstream
    // handler throws outside its route-level ProblemError boundary, convert
    // the exception through the same sanitized error boundary used by the
    // application. The reservation must still be completed: leaving it in
    // `pending` would make every retry return 409 until the 24-hour TTL,
    // while clearing it would permit an unsafe re-execution after a possible
    // outside-world side effect.
    let res: Response;
    try {
      await next();
      res = c.res;
      // Hono may catch a downstream exception inside its composed dispatcher
      // and return its default plain-text 500 instead of rejecting `next()`.
      // Detect that path as well. The production app's onError already emits
      // our problem+json response, so only replace non-contract responses to
      // avoid recording duplicate crash reports.
      if (
        c.error &&
        !res.headers.get('Content-Type')?.toLowerCase().startsWith('application/problem+json')
      ) {
        res = await onError(c.error, c);
      }
    } catch (err: unknown) {
      res = await onError(err instanceof Error ? err : new Error(String(err)), c);
    }

    // Preserve the normalized response when Hono had already installed its
    // default error response on the context. The middleware returns void
    // after completion, so the context response is what the outer dispatcher
    // ultimately sends to the client.
    c.res = res;

    if (!res) {
      return idempotencyResponse(c, 503, 'Service Unavailable', 'Mutation response unavailable');
    }
    let body: unknown;
    try {
      body = await res.clone().json();
    } catch {
      return idempotencyResponse(c, 503, 'Service Unavailable', 'Mutation response was not JSON');
    }
    try {
      const completed = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('app.current_org_id', ${orgId}, true)`);
        return queryRows<{ id: string }>(
          await tx.execute(sql`
            UPDATE api_idempotency
               SET state = 'completed',
                   status = ${res.status},
                   response_body = ${JSON.stringify(body)}::jsonb,
                   owner_token = NULL
             WHERE org_id = ${orgId}
               AND method = ${method}
               AND route = ${route}
               AND idem_key = ${key}
               AND state = 'pending'
               AND owner_token = ${ownerToken}
            RETURNING id
          `),
        );
      });
      if (completed.length !== 1) throw new Error('idempotency ownership lost');
    } catch {
      return idempotencyResponse(
        c,
        503,
        'Service Unavailable',
        'Mutation completed but its idempotency response could not be stored',
      );
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

// The API normally sits behind Caddy, which overwrites X-Forwarded-For with
// the client address before forwarding. A direct client must not be able to
// rotate that header to evade anonymous limits, so only transport peers in a
// private/loopback network may delegate the client identity to that header.
const TRUSTED_PROXY_NETWORKS = new BlockList();
for (const [address, prefix, family] of [
  ['127.0.0.0', 8, 'ipv4'],
  ['10.0.0.0', 8, 'ipv4'],
  ['172.16.0.0', 12, 'ipv4'],
  ['192.168.0.0', 16, 'ipv4'],
  ['::1', 128, 'ipv6'],
  ['fc00::', 7, 'ipv6'],
  ['fe80::', 10, 'ipv6'],
] as const) {
  TRUSTED_PROXY_NETWORKS.addSubnet(address, prefix, family);
}

type NodeIncomingBinding = { socket?: { remoteAddress?: string } };

function transportPeerAddress(c: Context): string | undefined {
  const incoming = (c.env as { incoming?: NodeIncomingBinding } | undefined)?.incoming;
  return incoming?.socket?.remoteAddress;
}

function isTrustedProxyAddress(address: string | undefined): boolean {
  if (!address) return false;
  const normalized = address.replace(/^::ffff:/i, '');
  const family = isIP(normalized);
  if (family === 4) return TRUSTED_PROXY_NETWORKS.check(normalized, 'ipv4');
  if (family === 6) return TRUSTED_PROXY_NETWORKS.check(normalized, 'ipv6');
  return false;
}

function getBucket(
  key: string,
  capacity: number,
  refillPerSec: number,
  maxBuckets: number,
): Bucket {
  let bucket = RATE_BUCKETS.get(key);
  const now = Date.now() / 1000;
  if (!bucket) {
    if (RATE_BUCKETS.size >= maxBuckets) {
      const oldest = RATE_BUCKETS.keys().next().value as string | undefined;
      if (oldest) RATE_BUCKETS.delete(oldest);
    }
    bucket = { tokens: capacity, capacity, refillPerSec, updatedAt: now };
    RATE_BUCKETS.set(key, bucket);
    return bucket;
  }
  // Refill
  const elapsed = now - bucket.updatedAt;
  bucket.tokens = Math.min(bucket.capacity, bucket.tokens + elapsed * bucket.refillPerSec);
  bucket.updatedAt = now;
  // Refresh insertion order so the size bound below behaves as an LRU cache.
  RATE_BUCKETS.delete(key);
  RATE_BUCKETS.set(key, bucket);
  return bucket;
}

/**
 * Per-token rate limiter: keyed by the caller's API token (or client IP when
 * no token). Returns 429 with Retry-After per L3.0.
 */
export function rateLimit(
  opts: { capacity?: number; refillPerSec?: number; maxBuckets?: number } = {},
) {
  const capacity = opts.capacity ?? DEFAULT_CAPACITY;
  const refillPerSec = opts.refillPerSec ?? DEFAULT_REFILL;
  const maxBuckets = Math.max(1, opts.maxBuckets ?? 10_000);
  return async (c: Context, next: Next): Promise<Response | void> => {
    const credential = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '');
    const apiKey = c.req.header('X-API-Key');
    const peerAddress = transportPeerAddress(c);
    const forwardedFor = c.req
      .header('x-forwarded-for')
      ?.split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .at(-1);
    const clientAddress = isTrustedProxyAddress(peerAddress) ? forwardedFor : peerAddress;
    const source = credential
      ? `bearer:${credential}`
      : apiKey
        ? `api-key:${apiKey}`
        : `ip:${clientAddress || 'anonymous'}`;
    // Retain only an irreversible fingerprint, never a live credential.
    const bucketKey = createHash('sha256').update(source).digest('base64url');
    const bucket = getBucket(bucketKey, capacity, refillPerSec, maxBuckets);

    if (bucket.tokens < 1) {
      const retryAfter =
        bucket.refillPerSec > 0 ? Math.max(1, Math.ceil(1 / bucket.refillPerSec)) : 60;
      const correlationId = (c.get('correlationId') as string) ?? randomUUID();
      return problemResponse(
        problem(429, 'Too Many Requests', 'Rate limit exceeded', correlationId, {
          retry_after_seconds: retryAfter,
        }),
        429,
        { 'Retry-After': String(retryAfter) },
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
export function decodeCursor(
  cursor: string | undefined | null,
): { value: string; id: string } | null {
  if (!cursor) return null;
  try {
    const [value, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as [
      unknown,
      unknown,
    ];
    if (typeof value !== 'string' || typeof id !== 'string') return null;
    return { value, id };
  } catch {
    return null;
  }
}

/** Parse cursor/limit query params per L3.0 conventions. */
export function parseCursor(c: Context, defaultLimit = 50, maxLimit = 200) {
  const limit = Math.min(
    Math.max(parseInt(c.req.query('limit') ?? String(defaultLimit), 10) || defaultLimit, 1),
    maxLimit,
  );
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
export function cursorGt(
  sortCol: CursorColumn,
  idCol: CursorColumn,
  cursor: { value: string; id: string } | null,
) {
  if (!cursor) return [];
  return [
    sql`(${sortCol} > ${cursor.value} OR (${sortCol} = ${cursor.value} AND ${idCol} > ${cursor.id}))`,
  ];
}

/**
 * Keyset predicate for a DESC-ordered list keyed on (sortColumn, id).
 */
export function cursorLt(
  sortCol: CursorColumn,
  idCol: CursorColumn,
  cursor: { value: string; id: string } | null,
) {
  if (!cursor) return [];
  return [
    sql`(${sortCol} < ${cursor.value} OR (${sortCol} = ${cursor.value} AND ${idCol} < ${cursor.id}))`,
  ];
}

/**
 * Build the next_cursor from the last row of a page. Pass the sort value and
 * id of the last element; returns null when the page is short (no more data).
 */
export function nextCursor(
  lastSort: string | number | Date | null | undefined,
  lastId: string | null | undefined,
  limit: number,
  count: number,
): string | null {
  if (
    count < limit ||
    lastSort === null ||
    lastSort === undefined ||
    lastId === null ||
    lastId === undefined
  )
    return null;
  return encodeCursor(lastSort, lastId);
}
