// ─── Calendar & scheduled posts (F-10, L3.0) — real post_target CRUD ───
// GET /models/:id/calendar (week/month) · POST /posts · PATCH/DELETE /posts/:id

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, and, gte, lte, sql } from 'drizzle-orm';
import { schema } from '@axiom/db';
import type { AppBindings } from '../index.js';
import { withOrgContext, requireOrg, writeAudit, apiError, statusTitle } from './helpers.js';
import { asPlatform, enqueueJob } from '@axiom/worker';

const router = new Hono<AppBindings>();

const schedulePostSchema = z.object({
  bundleId: z.string().uuid(),
  platform: z.string().min(1).max(50),
  scheduledFor: z.string().datetime(),
});

// Publication state is owned by the worker after it has performed the
// provider side effect. The API may reschedule or retarget an editable post,
// but it must never accept a caller-supplied terminal/worker state.
const rescheduleSchema = z
  .object({
    scheduledFor: z.string().datetime().optional(),
    platform: z.string().min(1).max(50).optional(),
  })
  .strict()
  .refine((value) => value.scheduledFor !== undefined || value.platform !== undefined, {
    message: 'at least one editable field is required',
  });

// GET /models/:id/calendar?from=...&to=... — scheduled posts in range
router.get('/models/:modelId/calendar', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const { modelId } = c.req.param();
  const from = c.req.query('from');
  const to = c.req.query('to');
  const fromDate = from ? new Date(from) : undefined;
  const toDate = to ? new Date(to) : undefined;
  if (fromDate && Number.isNaN(fromDate.getTime())) {
    return apiError(c, 400, statusTitle(400), 'from must be a valid timestamp');
  }
  if (toDate && Number.isNaN(toDate.getTime())) {
    return apiError(c, 400, statusTitle(400), 'to must be a valid timestamp');
  }

  const rows = await withOrgContext(orgId, (tx) => {
    // Drizzle's where() replaces the previous predicate. Build every scope
    // and range condition first, then apply one combined predicate so date
    // filters cannot discard tenant/model isolation.
    const conditions = [
      eq(schema.postTarget.orgId, orgId),
      eq(schema.contentBundle.modelId, modelId),
    ];
    if (fromDate) conditions.push(gte(schema.postTarget.scheduledFor, fromDate));
    if (toDate) conditions.push(lte(schema.postTarget.scheduledFor, toDate));

    return tx
      .select({
        id: schema.postTarget.id,
        bundleId: schema.postTarget.bundleId,
        platform: schema.postTarget.platform,
        scheduledFor: schema.postTarget.scheduledFor,
        state: schema.postTarget.state,
        remoteId: schema.postTarget.remoteId,
        error: schema.postTarget.error,
      })
      .from(schema.postTarget)
      .innerJoin(schema.contentBundle, eq(schema.contentBundle.id, schema.postTarget.bundleId))
      .where(and(...conditions))
      .orderBy(schema.postTarget.scheduledFor);
  });
  return c.json({ data: rows, meta: { total: rows.length } });
});

// POST /posts — schedule a post target from an approved bundle
router.post('/posts', zValidator('json', schedulePostSchema), async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const body = c.req.valid('json');
  const userId = c.get('userId') ?? 'system';
  const scheduledFor = new Date(body.scheduledFor);

  let platform: string;
  try {
    platform = asPlatform(body.platform);
  } catch {
    return apiError(c, 400, statusTitle(400), `unsupported target platform '${body.platform}'`);
  }

  const result = await withOrgContext(orgId, async (tx) => {
    const bundles = await tx
      .select({ id: schema.contentBundle.id, state: schema.contentBundle.state })
      .from(schema.contentBundle)
      .where(
        and(
          eq(schema.contentBundle.id, body.bundleId),
          eq(schema.contentBundle.orgId, orgId),
        ),
      )
      .limit(1);
    if (bundles.length === 0) return { status: 404 as const, data: null };
    const bundle = bundles[0];
    if (bundle.state !== 'approved') {
      return {
        status: 409 as const,
        data: null,
        error: `bundle must be approved before scheduling (current state: ${bundle.state})`,
      };
    }

    const [row] = await tx
      .insert(schema.postTarget)
      .values({
        orgId,
        bundleId: body.bundleId,
        platform,
        scheduledFor,
        state: 'pending',
        idemKey: Buffer.from(`${body.bundleId}|${platform}|${scheduledFor.toISOString()}`),
      })
      .returning();
    await writeAudit(tx, orgId, userId, 'post.schedule', row.id, {
      bundleId: body.bundleId,
      platform,
      scheduledFor: scheduledFor.toISOString(),
    });

    // Canonical flow (L2.0): schedule → worker publish at slot time. Enqueue
    // publish.target in the SAME transaction; dedupe on the target id.
    await enqueueJob(tx, {
      orgId,
      queue: 'publish',
      kind: 'publish.target',
      payload: { targetId: row.id },
      runAfter: scheduledFor,
      dedupeParts: ['publish.target', row.id],
    });

    return { status: 201 as const, data: row };
  });
  if (result.status === 404) return apiError(c, 404, statusTitle(404), 'bundle not found');
  if (result.status === 409) return apiError(c, 409, statusTitle(409), result.error);
  return c.json({ data: result.data }, 201);
});

// PATCH /posts/:id — reschedule / edit target
router.patch('/posts/:id', zValidator('json', rescheduleSchema), async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const { id } = c.req.param();
  const body = c.req.valid('json');
  const userId = c.get('userId') ?? 'system';

  let platform: string | undefined;
  if (body.platform !== undefined) {
    try {
      platform = asPlatform(body.platform);
    } catch {
      return apiError(c, 400, statusTitle(400), `unsupported target platform '${body.platform}'`);
    }
  }
  const scheduledFor = body.scheduledFor ? new Date(body.scheduledFor) : undefined;

  const result = await withOrgContext(orgId, async (tx) => {
    const existingRows = await tx
      .select()
      .from(schema.postTarget)
      .where(and(eq(schema.postTarget.id, id), eq(schema.postTarget.orgId, orgId)))
      .limit(1);
    const existing = existingRows[0];
    if (!existing) return { status: 404 as const, data: null };
    if (existing.state !== 'pending') {
      return {
        status: 409 as const,
        data: null,
        error: `post cannot be edited after publication begins (current state: ${existing.state})`,
      };
    }

    const nextPlatform = platform ?? existing.platform;
    const nextScheduledFor = scheduledFor ?? existing.scheduledFor;
    const platformChanged = platform !== undefined && platform !== existing.platform;
    const nextIdemKey = Buffer.from(
      `${existing.bundleId}|${nextPlatform}|${nextScheduledFor ? new Date(nextScheduledFor).toISOString() : ''}`,
    );
    const rows = await tx
      .update(schema.postTarget)
      .set({
        ...(scheduledFor ? { scheduledFor } : {}),
        ...(platform
          ? { platform, ...(platformChanged ? { connectionId: null } : {}) }
          : {}),
        idemKey: nextIdemKey,
      })
      .where(
        and(
          eq(schema.postTarget.id, id),
          eq(schema.postTarget.orgId, orgId),
          eq(schema.postTarget.state, 'pending'),
        ),
      )
      .returning();
    if (rows.length === 0) {
      return {
        status: 409 as const,
        data: null,
        error: 'post changed while the edit was being applied; retry the action',
      };
    }
    if (scheduledFor || platform) {
      // Keep the durable worker handoff aligned with the edited target. The
      // dedupe key makes this a no-op when the original job is still present;
      // the UPDATE fixes its run time when it is ready, and enqueue repairs a
      // pending target whose job was lost before the edit.
      await enqueueJob(tx, {
        orgId,
        queue: 'publish',
        kind: 'publish.target',
        payload: { targetId: id },
        runAfter: nextScheduledFor ? new Date(nextScheduledFor) : new Date(),
        dedupeParts: ['publish.target', id],
      });
      if (nextScheduledFor) {
        await tx.execute(sql`
          UPDATE job
             SET run_after = ${new Date(nextScheduledFor)}
           WHERE org_id = ${orgId}
             AND kind = 'publish.target'
             AND state = 'ready'
             AND payload ->> 'targetId' = ${id}
        `);
      }
    }
    await writeAudit(tx, orgId, userId, 'post.update', id, { changes: body });
    return { status: 200 as const, data: rows[0] };
  });
  if (result.status === 404) return apiError(c, 404, statusTitle(404), 'post not found');
  if (result.status === 409) return apiError(c, 409, statusTitle(409), result.error);
  return c.json({ data: result.data });
});

// DELETE /posts/:id — unschedule
router.delete('/posts/:id', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const { id } = c.req.param();
  const userId = c.get('userId') ?? 'system';

  const result = await withOrgContext(orgId, async (tx) => {
    const rows = await tx
      .delete(schema.postTarget)
      .where(and(eq(schema.postTarget.id, id), eq(schema.postTarget.orgId, orgId)))
      .returning({ id: schema.postTarget.id });
    if (rows.length > 0) {
      await writeAudit(tx, orgId, userId, 'post.unschedule', id, {});
    }
    return rows;
  });
  if (result.length === 0) return apiError(c, 404, statusTitle(404), 'post not found');
  return c.json({ success: true, data: result[0] });
});

export { router as postsRouter };
