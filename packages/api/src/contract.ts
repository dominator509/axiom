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
import { readBoundedResponseJson } from '@axiom/core';
import { db } from '@axiom/db';
import { captureUnhandledApiError, describeCrash } from './crash-reporter.js';
import {
  readBoundedBytes,
  InvalidContentLengthError,
  RequestBodyTooLargeError,
} from './webhook-body.js';

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
const IDEMPOTENCY_MAX_BODY_BYTES = 256 * 1024;
/** Opaque client keys are persisted and hashed; keep that header bounded. */
export const IDEMPOTENCY_KEY_MAX_BYTES = 256;

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
export function idempotency(required = true, maxBodyBytes = IDEMPOTENCY_MAX_BODY_BYTES) {
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1 || maxBodyBytes > 64 * 1024 * 1024)
    throw new Error('Invalid idempotency request limit');
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
    if (Buffer.byteLength(key, 'utf8') > IDEMPOTENCY_KEY_MAX_BYTES) {
      return idempotencyResponse(
        c,
        400,
        'Bad Request',
        `Idempotency-Key header exceeds the maximum size of ${IDEMPOTENCY_KEY_MAX_BYTES} bytes`,
      );
    }

    const route = c.req.path;
    const orgId = c.get('orgId') as string | undefined;
    if (!orgId) {
      return idempotencyResponse(c, 503, 'Service Unavailable', 'Idempotency store unavailable');
    }

    let requestBytes: Uint8Array;
    try {
      requestBytes = await readBoundedBytes(c.req.raw, maxBodyBytes);
      // The idempotency middleware consumes the raw stream to hash it. Cache
      // an independent ArrayBuffer so downstream Hono JSON/form parsers read
      // the exact same bytes without reopening an unbounded raw stream.
      c.req.bodyCache.arrayBuffer = Promise.resolve(
        requestBytes.slice().buffer,
      ) as unknown as ArrayBuffer;
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        const correlationId = (c.get('correlationId') as string) ?? randomUUID();
        return problemResponse(
          problem(413, 'Payload Too Large', 'request body exceeds the maximum size', correlationId),
          413,
        );
      }
      if (error instanceof InvalidContentLengthError) {
        const correlationId = (c.get('correlationId') as string) ?? randomUUID();
        return problemResponse(
          problem(400, 'Bad Request', 'invalid Content-Length header', correlationId),
          400,
        );
      }
      throw error;
    }
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

    if (!res) {
      return idempotencyResponse(c, 503, 'Service Unavailable', 'Mutation response unavailable');
    }
    let body: unknown;
    try {
      body = await readBoundedResponseJson(res.clone());
    } catch {
      return idempotencyResponse(c, 503, 'Service Unavailable', 'Mutation response was not JSON');
    }
    // Publish the response only AFTER cloning it for persistence. Hono's
    // setter wraps its body stream; cloning after that would tee the original
    // and leave the context holding a disturbed stream, breaking outer CORS
    // header writes and turning a completed mutation into an HTTP 500.
    c.res = res;
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
    // Namespace the bucket per limiter configuration: several rateLimit()
    // instances with different budgets can sit on the same request path
    // (e.g. the global /api/v1/* limiter plus a route-specific one). Without
    // this, the first-created bucket's capacity silently wins for every
    // limiter sharing the credential, and the tighter budget never bites.
    const bucketKey = createHash('sha256')
      .update(`${capacity}:${refillPerSec}:${source}`)
      .digest('base64url');
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
// Sign-in attempt throttle (per-account brute-force brake)
// ---------------------------------------------------------------------------

interface SignInAttemptRecord {
  failures: number;
  lockedUntil: number; // epoch seconds
}

const SIGNIN_ATTEMPTS = new Map<string, SignInAttemptRecord>();
const SIGNIN_MAX_FAILURES = 10;
const SIGNIN_LOCK_SECONDS = 15 * 60;
// Hard bound on attacker-controlled map growth: distinct wrong-password emails
// are attacker input, so the map must not grow with every probe.
const SIGNIN_MAX_RECORDS = 10_000;

/**
 * Evict the least-recently-used record, preferring records that are not
 * actively locking an account. Active locks survive churn; evicting a live
 * lock would silently lift it.
 */
function evictSignInRecord(): void {
  let oldestUnlockedKey: string | undefined;
  let oldestUnlockedAt = Infinity;
  let oldestKey: string | undefined;
  const now = Date.now() / 1000;
  for (const [key, record] of SIGNIN_ATTEMPTS) {
    if (oldestKey === undefined) oldestKey = key;
    if (record.lockedUntil <= now && record.lockedUntil < oldestUnlockedAt) {
      oldestUnlockedAt = record.lockedUntil;
      oldestUnlockedKey = key;
    }
  }
  SIGNIN_ATTEMPTS.delete(oldestUnlockedKey ?? oldestKey!);
}

function signInAttemptKey(email: string): string {
  return createHash('sha256').update(`signin:${email.toLowerCase().trim()}`).digest('base64url');
}

/**
 * Per-account brake for POST /api/auth/sign-in/email. The /api/auth/* IP
 * bucket is the first line of defense, but it cannot see a slow,
 * distributed password-guessing campaign aimed at one account, and there is
 * no better-auth-level lockout configured. Only 401s (wrong credentials)
 * count — never 400s — so malformed requests cannot be weaponized to lock a
 * victim out. Successful sign-in clears the account's record.
 *
 * Hardening notes (independent-review follow-up):
 * - Bounded storage: the record map is capped at `maxRecords` with
 *   LRU eviction, preferring non-locked records, so a churn of distinct
 *   emails cannot grow process memory without bound and cannot evict an
 *   active lock. Dead records (lock expired, no live failure streak) are
 *   dropped on read.
 * - No lock renewal: requests arriving while an account is locked receive
 *   429 without touching the record, so probing a locked account cannot
 *   extend the lock. The lock still expires on schedule; after expiry the
 *   failure streak restarts from zero.
 * - No email, no tracking: bodies without a parseable email are passed
 *   through untracked — there is no account to protect and no shared
 *   'unknown' bucket to poison.
 * - Residual risk (explicit lockout policy, for owner review): a patient,
 *   distributed attacker can re-lock an account indefinitely by spending
 *   `maxFailures` well-formed wrong passwords per `lockSeconds` cycle. This
 *   is inherent to any lockout and is accepted because (a) the /api/auth/*
 *   IP bucket in front of this middleware already caps single-source
 *   throughput, (b) the threshold (10) absorbs ordinary typos, and
 *   (c) a correct sign-in clears the record immediately. If owner policy
 *   prefers availability over brute-force braking, set lockSeconds to a
 *   smaller value or replace the hard lock with a delay/CAPTCHA step.
 */
export function signInAttemptThrottle(
  opts: { maxFailures?: number; lockSeconds?: number; maxRecords?: number } = {},
) {
  const maxFailures = Math.max(1, Math.floor(opts.maxFailures ?? SIGNIN_MAX_FAILURES));
  const lockSeconds = Math.max(1, Math.floor(opts.lockSeconds ?? SIGNIN_LOCK_SECONDS));
  const maxRecords = Math.max(1, Math.floor(opts.maxRecords ?? SIGNIN_MAX_RECORDS));
  return async (c: Context, next: Next): Promise<Response | void> => {
    if (c.req.method !== 'POST') return await next();
    let email: string | undefined;
    try {
      const body = (await c.req.raw.clone().json()) as { email?: unknown };
      if (typeof body?.email === 'string') email = body.email;
    } catch {
      email = undefined;
    }
    // No parseable email: no account to protect. Pass through untracked so
    // malformed/credential-less traffic cannot fill the map.
    if (!email) return await next();
    const key = signInAttemptKey(email);
    const now = Date.now() / 1000;
    let record = SIGNIN_ATTEMPTS.get(key);
    if (record) {
      // Drop dead records: lock expired and no live failure streak.
      if (record.lockedUntil <= now && record.failures === 0) {
        SIGNIN_ATTEMPTS.delete(key);
        record = undefined;
      } else {
        // LRU refresh so the size bound below evicts the least-recently-used
        // record rather than the most recently active one.
        SIGNIN_ATTEMPTS.delete(key);
        SIGNIN_ATTEMPTS.set(key, record);
      }
    }
    if (record && record.lockedUntil > now) {
      // Locked: 429 without touching the record — attempts made while locked
      // can neither extend the lock nor consume failure budget.
      const retryAfter = Math.max(1, Math.ceil(record.lockedUntil - now));
      const correlationId = (c.get('correlationId') as string) ?? randomUUID();
      return problemResponse(
        problem(429, 'Too Many Requests', 'Too many failed sign-in attempts', correlationId, {
          retry_after_seconds: retryAfter,
        }),
        429,
        { 'Retry-After': String(retryAfter) },
      );
    }
    await next();
    if (c.res.status === 401) {
      const current = SIGNIN_ATTEMPTS.get(key) ?? { failures: 0, lockedUntil: 0 };
      current.failures += 1;
      if (current.failures >= maxFailures) {
        current.lockedUntil = now + lockSeconds;
        current.failures = 0;
      }
      SIGNIN_ATTEMPTS.delete(key);
      SIGNIN_ATTEMPTS.set(key, current);
      // Bounded storage: never let attacker-chosen emails grow the map
      // without limit.
      while (SIGNIN_ATTEMPTS.size > maxRecords) evictSignInRecord();
    } else if (c.res.ok) {
      SIGNIN_ATTEMPTS.delete(key);
    }
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
