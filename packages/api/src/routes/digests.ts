// ─── Weekly digests (F-28, L2.7) — durable digest cards via the queue ───
// POST /api/v1/digests/generate — enqueue digest.weekly (deduped per ISO week)
// GET  /api/v1/digests          — list digest relay cards (cursor paginated)

import { Hono } from 'hono';
import { eq, and, desc } from 'drizzle-orm';
import { schema } from '@axiom/db';
import { enqueueJob } from '@axiom/worker';
import type { AppBindings } from '../index.js';
import { withOrgContext, requireOrg, apiError, statusTitle } from './helpers.js';
import { parseCursor, cursorLt, nextCursor } from '../contract.js';

const router = new Hono<AppBindings>();

/** ISO-8601 Monday of the current week — the digest dedupe key. */
export function isoWeekKey(d: Date = new Date()): string {
  const day = (d.getUTCDay() + 6) % 7; // Monday=0
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
  return monday.toISOString().slice(0, 10);
}

// POST /api/v1/digests/generate — enqueue this week's digest (one per org/week)
router.post('/digests/generate', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');

  const job = await withOrgContext(orgId, (tx) =>
    enqueueJob(tx, {
      orgId,
      queue: 'digest',
      kind: 'digest.weekly',
      payload: { week: isoWeekKey() },
      dedupeParts: ['digest.weekly', isoWeekKey()],
    }),
  );

  if (!job) return apiError(c, 409, 'Conflict', 'digest for this week already enqueued');
  return c.json({ success: true, jobId: job.id });
});

// GET /api/v1/digests — the org's digest cards, newest first
router.get('/digests', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const { limit, cursor } = parseCursor(c, 20, 100);

  const rows = await withOrgContext(orgId, (tx) =>
    tx
      .select()
      .from(schema.relayCard)
      .where(
        and(
          eq(schema.relayCard.orgId, orgId),
          eq(schema.relayCard.channel, 'digest'),
          ...cursorLt(schema.relayCard.createdAt, schema.relayCard.id, cursor),
        ),
      )
      .orderBy(desc(schema.relayCard.createdAt), desc(schema.relayCard.id))
      .limit(limit),
  );
  const last = rows[rows.length - 1];
  return c.json({
    data: rows,
    meta: { total: rows.length, limit, next_cursor: nextCursor(last?.createdAt, last?.id, limit, rows.length) },
  });
});

export { router as digestsRouter };
