// ─── Calendar & scheduled posts (F-10, L3.0) — real post_target CRUD ───
// GET /models/:id/calendar (week/month) · POST /posts · PATCH/DELETE /posts/:id

import { Hono } from 'hono';
import { z } from 'zod';
import { boundedJsonValidator as zValidator } from '../bounded-json-validator.js';
import { eq, and, gte, lte, sql, isNull } from 'drizzle-orm';
import { schema, getPublishingConsentStatus, consentRequirementMessage } from '@axiom/db';
import type { AppBindings } from '../index.js';
import {
  withOrgContext,
  requireOrg,
  writeAudit,
  apiError,
  statusTitle,
  resolvePublishConnections,
} from './helpers.js';
import {
  asPlatform,
  enqueueJob,
  resolveCapabilities,
  EXTERNAL_SIDE_EFFECT_UNKNOWN_PREFIX,
} from '@axiom/worker';
import type { Platform } from '@axiom/core';

const router = new Hono<AppBindings>();

// Call while holding the target FOR UPDATE lock, which serializes against
// publish.target. The independent dispatch marker survives a worker rollback
// before the worker has had a chance to record its dead-letter outcome.
export async function hasUnknownPublishOutcome(
  tx: any,
  orgId: string,
  targetId: string,
): Promise<boolean> {
  const jobs = await tx
    .select({ id: schema.job.id })
    .from(schema.job)
    .where(
      and(
        eq(schema.job.orgId, orgId),
        eq(schema.job.kind, 'publish.target'),
        eq(schema.job.state, 'dead'),
        sql`(${schema.job.payload} ->> 'targetId') = ${targetId}`,
        sql`${schema.job.lastError} LIKE ${`${EXTERNAL_SIDE_EFFECT_UNKNOWN_PREFIX}%`}`,
      ),
    )
    .limit(1);
  if (jobs.length > 0) return true;
  const markers = await tx
    .select({ id: schema.prePostRun.id })
    .from(schema.prePostRun)
    .where(
      and(
        eq(schema.prePostRun.orgId, orgId),
        eq(schema.prePostRun.targetId, targetId),
        eq(schema.prePostRun.script, 'publish.dispatch'),
        eq(schema.prePostRun.status, 'pending'),
      ),
    )
    .limit(1);
  return markers.length > 0;
}

const schedulePostSchema = z.object({
  bundleId: z.string().uuid(),
  platform: z.string().min(1).max(50),
  connectionId: z.string().uuid().optional(),
  scheduledFor: z.string().datetime(),
});

// Publication state is owned by the worker after it has performed the
// provider side effect. The API may reschedule or retarget an editable post,
// but it must never accept a caller-supplied terminal/worker state.
const rescheduleSchema = z
  .object({
    scheduledFor: z.string().datetime().optional(),
    platform: z.string().min(1).max(50).optional(),
    connectionId: z.string().uuid().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.scheduledFor !== undefined ||
      value.platform !== undefined ||
      value.connectionId !== undefined,
    {
      message: 'at least one editable field is required',
    },
  );

/**
 * Keep every route that can create or retarget a publish target aligned with
 * the connector media contract. Text-capable providers may publish from a
 * text-only bundle; media-only providers must have an attached asset before a
 * worker job is created.
 */
function mediaRequirementError(platform: Platform, hasAsset: boolean, kind?: 'image' | 'video'): string | null {
  // Presence is checked before loading; compatibility requires the owned row.
  if (hasAsset && !kind) return null;
  try {
    if (kind) {
      return resolveCapabilities(platform).media.includes(kind)
        ? null : `${platform} does not support ${kind} assets; scheduling cannot continue`;
    }
    if (resolveCapabilities(platform).media.includes('text')) return null;
  } catch {
    return `cannot resolve ${platform} capabilities; media requirement is unknown`;
  }
  return `bundle has no media asset; ${platform} requires media before scheduling`;
}

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
      eq(schema.contentBundle.orgId, orgId),
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

  let platform: Platform;
  try {
    platform = asPlatform(body.platform);
  } catch {
    return apiError(c, 400, statusTitle(400), `unsupported target platform '${body.platform}'`);
  }

  const result = await withOrgContext(orgId, async (tx) => {
    const bundles = await tx
      .select({
        id: schema.contentBundle.id,
        state: schema.contentBundle.state,
        modelId: schema.contentBundle.modelId,
        assetId: schema.contentBundle.assetId,
      })
      .from(schema.contentBundle)
      .where(and(eq(schema.contentBundle.id, body.bundleId), eq(schema.contentBundle.orgId, orgId)))
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
    const consent = await getPublishingConsentStatus(tx, orgId, bundle.modelId, platform);
    if (!consent.ok) {
      return {
        status: 409 as const,
        data: null,
        error: consentRequirementMessage(consent, platform),
      };
    }
    const mediaError = mediaRequirementError(platform, Boolean(bundle.assetId));
    if (mediaError) {
      return { status: 409 as const, data: null, error: mediaError };
    }

    if (bundle.assetId) {
      const assets = await tx
        .select({ id: schema.asset.id, kind: schema.asset.kind })
        .from(schema.asset)
        .where(
          and(
            eq(schema.asset.id, bundle.assetId),
            eq(schema.asset.orgId, orgId),
            eq(schema.asset.modelId, bundle.modelId),
          ),
        )
        .limit(1);
      const asset = assets[0];
      if (!asset || (asset.kind !== 'image' && asset.kind !== 'video')) {
        return {
          status: 409 as const,
          data: null,
          error:
            'bundle references an unavailable or unsupported media asset; scheduling cannot continue',
        };
      }
      const compatibilityError = mediaRequirementError(platform, true, asset.kind);
      if (compatibilityError) return { status: 409 as const, data: null, error: compatibilityError };
    }

    const connectionResolution = await resolvePublishConnections(
      tx,
      orgId,
      bundle.modelId,
      [platform],
      body.connectionId ? { [platform]: body.connectionId } : {},
    );
    if ('error' in connectionResolution) {
      return { status: 409 as const, data: null, error: connectionResolution.error };
    }

    const [row] = await tx
      .insert(schema.postTarget)
      .values({
        orgId,
        bundleId: body.bundleId,
        platform,
        connectionId: connectionResolution.connections.get(platform),
        scheduledFor,
        state: 'pending',
        idemKey: Buffer.from(`${body.bundleId}|${platform}|${scheduledFor.toISOString()}`),
      })
      .returning();
    await writeAudit(tx, orgId, userId, 'post.schedule', row.id, {
      bundleId: body.bundleId,
      platform,
      connectionId: connectionResolution.connections.get(platform),
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

  let platform: Platform | undefined;
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
      .limit(1)
      .for('update');
    const existing = existingRows[0];
    if (!existing) return { status: 404 as const, data: null };
    if (existing.state !== 'pending' || existing.remoteId) {
      return {
        status: 409 as const,
        data: null,
        error: `post cannot be edited after publication begins (current state: ${existing.state})`,
      };
    }

    if (await hasUnknownPublishOutcome(tx, orgId, id)) {
      return {
        status: 409 as const,
        data: null,
        error:
          'post provider outcome is unknown; reconcile the dead job or dispatch marker before editing',
      };
    }

    const nextPlatform = (platform ?? existing.platform) as Platform;
    const nextScheduledFor = scheduledFor ?? existing.scheduledFor;
    const platformChanged = platform !== undefined && platform !== existing.platform;

    const bundles = await tx
      .select({
        modelId: schema.contentBundle.modelId,
        assetId: schema.contentBundle.assetId,
      })
      .from(schema.contentBundle)
      .where(
        and(eq(schema.contentBundle.id, existing.bundleId), eq(schema.contentBundle.orgId, orgId)),
      )
      .limit(1);
    const bundle = bundles[0];
    if (!bundle) {
      return { status: 409 as const, data: null, error: 'post bundle is unavailable' };
    }

    const consent = await getPublishingConsentStatus(tx, orgId, bundle.modelId, nextPlatform);
    if (!consent.ok) {
      return {
        status: 409 as const,
        data: null,
        error: consentRequirementMessage(consent, nextPlatform),
      };
    }

    const mediaError = mediaRequirementError(nextPlatform, Boolean(bundle.assetId));
    if (mediaError) {
      return { status: 409 as const, data: null, error: mediaError };
    }
    if (bundle.assetId) {
      const assets = await tx
        .select({ id: schema.asset.id, kind: schema.asset.kind })
        .from(schema.asset)
        .where(
          and(
            eq(schema.asset.id, bundle.assetId),
            eq(schema.asset.orgId, orgId),
            eq(schema.asset.modelId, bundle.modelId),
          ),
        )
        .limit(1);
      const asset = assets[0];
      if (!asset || (asset.kind !== 'image' && asset.kind !== 'video')) {
        return {
          status: 409 as const,
          data: null,
          error:
            'bundle references an unavailable or unsupported media asset; retargeting cannot continue',
        };
      }
      const compatibilityError = mediaRequirementError(nextPlatform, true, asset.kind);
      if (compatibilityError) return { status: 409 as const, data: null, error: compatibilityError };
    }

    const requestedConnectionId =
      body.connectionId ?? (platformChanged ? undefined : (existing.connectionId ?? undefined));
    const connectionResolution = await resolvePublishConnections(
      tx,
      orgId,
      bundle.modelId,
      [nextPlatform],
      requestedConnectionId ? { [nextPlatform]: requestedConnectionId } : {},
    );
    if ('error' in connectionResolution) {
      return { status: 409 as const, data: null, error: connectionResolution.error };
    }

    const nextIdemKey = Buffer.from(
      `${existing.bundleId}|${nextPlatform}|${nextScheduledFor ? new Date(nextScheduledFor).toISOString() : ''}`,
    );
    const rows = await tx
      .update(schema.postTarget)
      .set({
        ...(scheduledFor ? { scheduledFor } : {}),
        ...(platform ? { platform } : {}),
        connectionId: connectionResolution.connections.get(nextPlatform),
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
    if (scheduledFor || platform || body.connectionId) {
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

// DELETE /posts/:id — cancel a pending target before provider handoff
router.delete('/posts/:id', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const { id } = c.req.param();
  const userId = c.get('userId') ?? 'system';

  const result = await withOrgContext(orgId, async (tx) => {
    // Serialize cancellation with publish.target's FOR UPDATE read. A target
    // remains pending while a provider call is in flight, so the remote ID is
    // part of the handoff boundary: once present, cancellation is too late.
    const currentRows = await tx
      .select({
        id: schema.postTarget.id,
        state: schema.postTarget.state,
        remoteId: schema.postTarget.remoteId,
      })
      .from(schema.postTarget)
      .where(and(eq(schema.postTarget.id, id), eq(schema.postTarget.orgId, orgId)))
      .limit(1)
      .for('update');
    const current = currentRows[0];
    if (!current) return { status: 404 as const, data: null };
    if (current.state !== 'pending' || current.remoteId) {
      return {
        status: 409 as const,
        data: null,
        error: `post cannot be unscheduled after publication begins (current state: ${current.state})`,
      };
    }

    if (await hasUnknownPublishOutcome(tx, orgId, id)) {
      return {
        status: 409 as const,
        data: null,
        error:
          'post provider outcome is unknown; reconcile the dead job or dispatch marker before unscheduling',
      };
    }

    const rows = await tx
      .update(schema.postTarget)
      .set({ state: 'canceled', error: 'unscheduled by operator' })
      .where(
        and(
          eq(schema.postTarget.id, id),
          eq(schema.postTarget.orgId, orgId),
          eq(schema.postTarget.state, 'pending'),
          isNull(schema.postTarget.remoteId),
        ),
      )
      .returning({ id: schema.postTarget.id, state: schema.postTarget.state });
    if (rows.length === 0) {
      return {
        status: 409 as const,
        data: null,
        error: 'post changed while unscheduling was being applied; retry the action',
      };
    }
    if (rows.length > 0) {
      await writeAudit(tx, orgId, userId, 'post.unschedule', id, {});
    }
    return { status: 200 as const, data: rows[0] };
  });
  if (result.status === 404) return apiError(c, 404, statusTitle(404), 'post not found');
  if (result.status === 409) return apiError(c, 409, statusTitle(409), result.error);
  return c.json({ success: true, data: result.data });
});

export { router as postsRouter };
