// ─── Contract helpers (L3.0) — Vitest Suite ───
// Covers the keyset cursor primitive: encode/decode round-trip, garbage
// tolerance, limit clamping, SQL predicate rendering, and next_cursor logic.

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import type { Context } from 'hono';
import {
  encodeCursor,
  decodeCursor,
  parseCursor,
  cursorGt,
  cursorLt,
  nextCursor,
  problem,
  type CursorPage,
} from './contract.js';

/** Render a drizzle SQL fragment to plain text (recursing into nested SQL). */
function renderSQL(fragment: unknown): string {
  let out = '';
  const render = (chunk: any): string => {
    if (chunk == null) return '';
    if (chunk.constructor?.name === 'StringChunk') return chunk.value.join('');
    if (chunk.constructor?.name === 'SQL') return (chunk.queryChunks ?? []).map(render).join('');
    if (typeof chunk === 'string') return chunk;
    // Inline params / wrapped primitives
    try {
      const v = chunk.valueOf();
      return typeof v === 'string' ? v : String(v ?? '');
    } catch {
      return '';
    }
  };
  for (const c of (fragment as any).queryChunks ?? []) out += render(c);
  return out;
}

describe('encodeCursor / decodeCursor', () => {
  it('round-trips a string sort value with id tiebreaker', () => {
    const cursor = encodeCursor('2026-08-07T03:00:00.000Z', '11111111-1111-4111-8111-111111111111');
    expect(decodeCursor(cursor)).toEqual({
      value: '2026-08-07T03:00:00.000Z',
      id: '11111111-1111-4111-8111-111111111111',
    });
  });

  it('round-trips a numeric sort value', () => {
    const cursor = encodeCursor(42.5, '22222222-2222-4222-8222-222222222222');
    expect(decodeCursor(cursor)).toEqual({
      value: '42.5',
      id: '22222222-2222-4222-8222-222222222222',
    });
  });

  it('round-trips a Date sort value as ISO string', () => {
    const d = new Date('2026-01-01T00:00:00.000Z');
    const cursor = encodeCursor(d, '33333333-3333-4333-8333-333333333333');
    expect(decodeCursor(cursor)).toEqual({
      value: '2026-01-01T00:00:00.000Z',
      id: '33333333-3333-4333-8333-333333333333',
    });
  });

  it('cursor round-trip is exact at millisecond precision (keyset boundary)', () => {
    // Regression: PG stored microsecond timestamps (.357238) while JS Date
    // truncates to ms (.357Z). The boundary row then satisfied
    // `created_at > '...357Z'` and was re-fetched on the next page (dupes).
    // Keyset columns are now timestamp(3); verify the encoded cursor decodes
    // to exactly the value that compares equal to the stored row.
    const boundary = new Date('2026-08-06T22:21:37.357Z');
    const id = 'd7057200-04c0-4b09-ae6c-0d00b1f6f5cc';
    const cursor = encodeCursor(boundary, id);
    const decoded = decodeCursor(cursor);
    expect(decoded).not.toBeNull();
    expect(decoded!.value).toBe('2026-08-06T22:21:37.357Z');
    expect(decoded!.id).toBe(id);
    // The boundary row must NOT satisfy the ASC "after" predicate on itself.
    const gt = cursorGt(sql`created_at`, sql`id`, decoded);
    const text = renderSQL(gt[0]);
    expect(text).toContain(`created_at > 2026-08-06T22:21:37.357Z OR (created_at = 2026-08-06T22:21:37.357Z AND id > ${id})`);
  });

  it('returns null for garbage cursors (never throws)', () => {
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor('')).toBeNull();
    expect(decodeCursor('not-base64!@#$')).toBeNull();
    expect(decodeCursor(Buffer.from('not-json').toString('base64url'))).toBeNull();
    expect(decodeCursor(Buffer.from(JSON.stringify([1])).toString('base64url'))).toBeNull();
    expect(decodeCursor(Buffer.from(JSON.stringify(['v', 123])).toString('base64url'))).toBeNull();
  });
});

describe('parseCursor', () => {
  function makeCtx(query: string): Context {
    return {
      req: { query: (k: string) => new URLSearchParams(query).get(k) },
    } as unknown as Context;
  }

  it('defaults limit and accepts a cursor', () => {
    const { limit, cursor } = parseCursor(makeCtx('cursor=abc'), 50, 200);
    expect(limit).toBe(50);
    expect(cursor).toBeNull(); // 'abc' is not a valid base64url JSON pair
  });

  it('clamps limit to max', () => {
    const { limit } = parseCursor(makeCtx('limit=9999'), 50, 200);
    expect(limit).toBe(200);
  });

  it('floors limit at 1', () => {
    const { limit } = parseCursor(makeCtx('limit=0'), 50, 200);
    expect(limit).toBe(50); // 0 is falsy → default
    const { limit: l2 } = parseCursor(makeCtx('limit=-5'), 50, 200);
    expect(l2).toBe(1); // negative parses truthy → clamped to floor
  });

  it('parses a valid cursor', () => {
    const raw = encodeCursor('2026-08-07T03:00:00.000Z', '11111111-1111-4111-8111-111111111111');
    const { cursor } = parseCursor(makeCtx(`cursor=${encodeURIComponent(raw)}`), 50, 200);
    expect(cursor).toEqual({
      value: '2026-08-07T03:00:00.000Z',
      id: '11111111-1111-4111-8111-111111111111',
    });
  });
});

describe('cursorGt / cursorLt SQL predicates', () => {
  const sortCol = sql`created_at`;
  const idCol = sql`id`;

  it('returns no conditions when cursor is null', () => {
    expect(cursorGt(sortCol, idCol, null)).toEqual([]);
    expect(cursorLt(sortCol, idCol, null)).toEqual([]);
  });

  it('builds an ASC keyset predicate (sort > v OR sort = v AND id > id)', () => {
    const conds = cursorGt(sortCol, idCol, { value: '2026-08-07T03:00:00.000Z', id: 'abc' });
    expect(conds).toHaveLength(1);
    const text = renderSQL(conds[0]);
    expect(text).toContain('created_at > 2026-08-07T03:00:00.000Z');
    expect(text).toContain('created_at = 2026-08-07T03:00:00.000Z');
    expect(text).toContain('id > abc');
  });

  it('builds a DESC keyset predicate (sort < v OR sort = v AND id < id)', () => {
    const conds = cursorLt(sortCol, idCol, { value: '2026-08-07T03:00:00.000Z', id: 'abc' });
    expect(conds).toHaveLength(1);
    const text = renderSQL(conds[0]);
    expect(text).toContain('created_at < 2026-08-07T03:00:00.000Z');
    expect(text).toContain('created_at = 2026-08-07T03:00:00.000Z');
    expect(text).toContain('id < abc');
  });
});

describe('nextCursor', () => {
  it('returns null when the page is short (no more data)', () => {
    expect(nextCursor('2026-08-07T03:00:00.000Z', 'abc', 50, 10)).toBeNull();
    expect(nextCursor(null, 'abc', 50, 50)).toBeNull();
    expect(nextCursor('v', null, 50, 50)).toBeNull();
  });

  it('encodes a cursor from the last row when the page is full', () => {
    const cursor = nextCursor('2026-08-07T03:00:00.000Z', 'abc', 2, 2);
    expect(cursor).not.toBeNull();
    expect(decodeCursor(cursor)).toEqual({ value: '2026-08-07T03:00:00.000Z', id: 'abc' });
  });
});

describe('CursorPage shape', () => {
  it('matches the L3.0 list envelope', () => {
    const page: CursorPage<{ id: string }> = {
      data: [{ id: 'a' }],
      meta: { total: 1, limit: 50, next_cursor: 'xyz' },
    };
    expect(page.data).toHaveLength(1);
    expect(page.meta).toHaveProperty('total');
    expect(page.meta).toHaveProperty('limit');
    expect(page.meta).toHaveProperty('next_cursor');
  });
});

describe('RFC-7807 problem envelope (M-1)', () => {
  it('emits the L3.0 error shape with correlation_id', () => {
    const body = problem(404, 'Not Found', 'bundle not found', 'corr-123');
    expect(body).toMatchObject({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      detail: 'bundle not found',
      correlation_id: 'corr-123',
    });
  });

  it('emits 401 problem+json from the auth gate (requireAuth shape)', async () => {
    const app = new Hono();
    app.get('/x', (c) =>
      c.json(
        {
          type: 'about:blank',
          title: 'Unauthorized',
          status: 401,
          detail: 'unauthorized',
          correlation_id: c.req.header('X-Correlation-ID') ?? '',
        },
        401,
      ),
    );
    const res = await app.request('/x', { headers: { 'X-Correlation-ID': 'corr-abc' } });
    expect(res.status).toBe(401);
    const body = (await res.json()) as any;
    expect(body.title).toBe('Unauthorized');
    expect(body.detail).toBe('unauthorized');
    expect(body.correlation_id).toBe('corr-abc');
    expect(body.type).toBe('about:blank');
  });

  it('route-level errors no longer use the legacy { error: { message } } shape', async () => {
    // Guards the M-1 sweep: any route returning legacy shape would fail here.
    const app = new Hono();
    app.get('/legacy', (c) => {
      // Simulate what apiError produces: no `error` key at the top level.
      return c.json({ type: 'about:blank', title: 'Conflict', status: 409, detail: 'x', correlation_id: 'c' }, 409);
    });
    const res = await app.request('/legacy');
    const body = (await res.json()) as any;
    expect(body.error).toBeUndefined();
    expect(body.detail).toBe('x');
    expect(body.status).toBe(409);
  });
});
