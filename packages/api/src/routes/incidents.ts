// ─── Incidents & DLQ (F-73..F-78, L3.0) — real job-table reads + replay ───
// GET /incidents — failed/dead jobs + recent incident events
// POST /incidents/:jobId/replay — idempotent DLQ replay (reset → ready)

import { Hono } from 'hono';
import { z } from 'zod';
import { sql, eq, and, desc } from 'drizzle-orm';
import { schema } from '@axiom/db';
import type { AppBindings } from '../index.js';
import { withOrgContext, requireOrg, writeAudit, apiError, statusTitle } from './helpers.js';
import { parseCursor, cursorLt, nextCursor } from '../contract.js';
import { boundedJsonValidator as zValidator } from '../bounded-json-validator.js';
import { modelAccessCondition } from '../model-access.js';

const router = new Hono<AppBindings>();
const publishOutcomeSchema = z.object({
  outcome: z.enum(['published', 'not_published']),
  confirmed: z.literal(true),
  remoteId: z.string().trim().min(1).max(500).optional(),
}).strict().superRefine((body, context) => {
  if (body.outcome === 'not_published' && body.remoteId !== undefined) {
    context.addIssue({ code: 'custom', path: ['remoteId'], message: 'remoteId is only valid for a published outcome' });
  }
});
const publishJobPayloadSchema = z.object({ targetId: z.string().uuid() });
const reconciliationRoles = new Set(['owner', 'manager', 'operator']);

// GET /incidents — dead/failed jobs (the durable DLQ view)
router.get('/incidents', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const { limit, cursor } = parseCursor(c);

  const rows = await withOrgContext(orgId, (tx) => {
    const conds = [
      eq(schema.job.orgId, orgId),
      sql`${schema.job.state} IN ('dead', 'failed') OR ${schema.job.attempts} >= ${schema.job.maxAttempts}`,
      ...cursorLt(schema.job.createdAt, schema.job.id, cursor),
    ];
    return tx
      .select()
      .from(schema.job)
      .where(and(...conds))
      .orderBy(desc(schema.job.createdAt), desc(schema.job.id))
      .limit(limit);
  });
  const last = rows[rows.length - 1];
  return c.json({
    data: rows,
    meta: {
      total: rows.length,
      limit,
      next_cursor: nextCursor(last?.createdAt, last?.id, limit, rows.length),
    },
  });
});

// POST /incidents/:jobId/replay — reset a dead job back to ready (DLQ replay).
// The mounted API middleware supplies durable request replay protection.
router.post('/incidents/:jobId/replay', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const { jobId } = c.req.param();
  const userId = c.get('userId') ?? 'system';

  const result = await withOrgContext(orgId, async (tx) => {
    const existing = await tx
      .select({ state: schema.job.state, lastError: schema.job.lastError })
      .from(schema.job)
      .where(and(eq(schema.job.id, jobId), eq(schema.job.orgId, orgId)))
      .limit(1)
      .for('update');
    if (existing.length === 0) return { status: 404 as const, data: null };
    // Keep the eligibility check and reset under the same row lock. A replay
    // must never steal an active lease or erase a worker's unknown outcome.
    if (!['dead', 'failed'].includes(existing[0].state)) {
      return {
        status: 409 as const,
        data: null,
        message: 'Only dead or failed jobs can be replayed',
      };
    }
    if (existing[0].lastError?.startsWith('external-side-effect-unknown:')) {
      return {
        status: 409 as const,
        data: null,
        message: 'Provider outcome is unknown; reconcile the external side effect before replaying',
      };
    }

    const rows = await tx
      .update(schema.job)
      .set({
        state: 'ready',
        attempts: 0,
        lastError: null,
        runAfter: new Date(),
        lockedBy: null,
        lockedAt: null,
        startedAt: null,
        completedAt: null,
      })
      .where(
        and(
          eq(schema.job.id, jobId),
          eq(schema.job.orgId, orgId),
          sql`${schema.job.state} IN ('dead', 'failed')`,
        ),
      )
      .returning();
    if (rows.length === 0) return { status: 404 as const, data: null };
    await writeAudit(tx, orgId, userId, 'incident.replay', jobId, {});
    return { status: 200 as const, data: rows[0] };
  });
  if (result.status === 404) return apiError(c, 404, statusTitle(404), 'job not found');
  if (result.status === 409) {
    return apiError(c, 409, statusTitle(409), result.message);
  }
  return c.json({ success: true, data: result.data });
});

// This records an operator's external provider readback. It never contacts a
// provider and never dispatches work; a confirmed "not published" outcome
// leaves replay as a separate, explicit action.
router.post('/incidents/:jobId/reconcile', zValidator('json', publishOutcomeSchema), async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const userId = c.get('userId');
  if (!userId) return apiError(c, 401, statusTitle(401), 'authentication required');
  const role = c.get('role');
  if (!reconciliationRoles.has(role ?? '')) {
    return apiError(c, 403, statusTitle(403), 'publish reconciliation requires an owner, manager or operator role');
  }

  const { jobId } = c.req.param();
  const { outcome, remoteId } = c.req.valid('json');
  const result = await withOrgContext(orgId, async tx => {
    const jobs = await tx.select({
      id: schema.job.id,
      kind: schema.job.kind,
      payload: schema.job.payload,
      state: schema.job.state,
      lastError: schema.job.lastError,
    }).from(schema.job).where(and(
      eq(schema.job.id, jobId),
      eq(schema.job.orgId, orgId),
    )).limit(1).for('update');
    const job = jobs[0];
    if (!job) return { status: 404 as const };
    if (!['dead', 'failed'].includes(job.state)) {
      return { status: 409 as const, message: 'Only dead or failed jobs can be reconciled' };
    }
    if (job.kind !== 'publish.target' || !job.lastError?.startsWith('external-side-effect-unknown:')) {
      return { status: 409 as const, message: 'Job does not have an unknown publish outcome to reconcile' };
    }
    const parsedPayload = publishJobPayloadSchema.safeParse(job.payload);
    if (!parsedPayload.success) {
      return { status: 409 as const, message: 'Publish job has no valid target reference' };
    }

    const targets = await tx.select({
      id: schema.postTarget.id,
      platform: schema.postTarget.platform,
      state: schema.postTarget.state,
      remoteId: schema.postTarget.remoteId,
    }).from(schema.postTarget)
      .innerJoin(schema.contentBundle, eq(schema.contentBundle.id, schema.postTarget.bundleId))
      .where(and(
        eq(schema.postTarget.id, parsedPayload.data.targetId),
        eq(schema.postTarget.orgId, orgId),
        eq(schema.contentBundle.orgId, orgId),
        modelAccessCondition(role, orgId, userId, schema.contentBundle.modelId),
      )).limit(1).for('update');
    const target = targets[0];
    if (!target) return { status: 404 as const };
    if (target.state !== 'pending' || target.remoteId) {
      return { status: 409 as const, message: 'Publish target already has a recorded provider state' };
    }

    const markers = await tx.select({ id: schema.prePostRun.id })
      .from(schema.prePostRun)
      .where(and(
        eq(schema.prePostRun.orgId, orgId),
        eq(schema.prePostRun.targetId, target.id),
        eq(schema.prePostRun.script, 'publish.dispatch'),
        eq(schema.prePostRun.status, 'pending'),
      )).limit(2).for('update');
    if (markers.length !== 1) {
      return { status: 409 as const, message: 'Expected exactly one unresolved publish dispatch marker' };
    }

    const now = new Date();
    const resolvedMarker = await tx.update(schema.prePostRun).set({
      status: outcome === 'published' ? 'success' : 'reconciled-not-published',
      output: outcome === 'published'
        ? { state: 'published', remoteId: remoteId ?? null, reconciledByOperator: true }
        : { state: 'not_published', reconciledByOperator: true },
      error: null,
      finishedAt: now,
    }).where(and(
      eq(schema.prePostRun.id, markers[0].id),
      eq(schema.prePostRun.orgId, orgId),
      eq(schema.prePostRun.status, 'pending'),
    )).returning({ id: schema.prePostRun.id });
    if (resolvedMarker.length !== 1) throw new Error('publish dispatch marker changed while locked');

    if (outcome === 'published') {
      const updatedTarget = await tx.update(schema.postTarget).set({
        state: 'published',
        remoteId: remoteId ?? null,
        publishedAt: now,
        error: null,
      }).where(and(
        eq(schema.postTarget.id, target.id),
        eq(schema.postTarget.orgId, orgId),
        eq(schema.postTarget.state, 'pending'),
      )).returning({ id: schema.postTarget.id });
      if (updatedTarget.length !== 1) throw new Error('publish target changed while locked');
      const completedJob = await tx.update(schema.job).set({
        state: 'done',
        lastError: null,
        lockedBy: null,
        lockedAt: null,
        completedAt: now,
      }).where(and(
        eq(schema.job.id, jobId),
        eq(schema.job.orgId, orgId),
        sql`${schema.job.state} IN ('dead', 'failed')`,
      )).returning({ id: schema.job.id });
      if (completedJob.length !== 1) throw new Error('publish job changed while locked');
    } else {
      const updatedJob = await tx.update(schema.job).set({
        lastError: 'provider-reconciled-not-published: operator confirmed; explicit replay required',
        lockedBy: null,
        lockedAt: null,
      }).where(and(
        eq(schema.job.id, jobId),
        eq(schema.job.orgId, orgId),
        sql`${schema.job.state} IN ('dead', 'failed')`,
      )).returning({ id: schema.job.id });
      if (updatedJob.length !== 1) throw new Error('publish job changed while locked');
    }

    await writeAudit(tx, orgId, userId, 'incident.publish.reconcile', jobId, {
      outcome,
      targetId: target.id,
      platform: target.platform,
      remoteIdRecorded: Boolean(remoteId),
      dispatchStarted: false,
    });
    return {
      status: 200 as const,
      data: {
        jobId,
        targetId: target.id,
        outcome,
        state: outcome === 'published' ? 'done' : job.state,
        replayRequired: outcome === 'not_published',
        dispatchStarted: false as const,
      },
    };
  });

  if (result.status === 404) return apiError(c, 404, statusTitle(404), 'job or publish target not found');
  if (result.status === 409) return apiError(c, 409, statusTitle(409), result.message);
  return c.json({ success: true, data: result.data });
});

// POST /incidents/:jobId/discard — keep the row and audit event, but make a
// terminal failed/dead job ineligible for future execution.
router.post('/incidents/:jobId/discard', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const { jobId } = c.req.param();
  const userId = c.get('userId') ?? 'system';

  const result = await withOrgContext(orgId, async (tx) => {
    const existing = await tx
      .select({ state: schema.job.state, lastError: schema.job.lastError })
      .from(schema.job)
      .where(and(eq(schema.job.id, jobId), eq(schema.job.orgId, orgId)))
      .limit(1)
      .for('update');
    if (existing.length === 0) return { status: 404 as const, data: null };
    if (!['dead', 'failed'].includes(existing[0].state)) {
      return {
        status: 409 as const,
        data: null,
        message: 'Only dead or failed jobs can be discarded',
      };
    }
    if (existing[0].lastError?.startsWith('external-side-effect-unknown:')) {
      return {
        status: 409 as const,
        data: null,
        message: 'Provider outcome is unknown; reconcile the external side effect before discarding',
      };
    }

    const rows = await tx
      .update(schema.job)
      .set({
        state: 'cancelled',
        lockedBy: null,
        lockedAt: null,
        completedAt: new Date(),
      })
      .where(
        and(
          eq(schema.job.id, jobId),
          eq(schema.job.orgId, orgId),
          sql`${schema.job.state} IN ('dead', 'failed')`,
        ),
      )
      .returning();
    if (rows.length === 0) return { status: 404 as const, data: null };
    await writeAudit(tx, orgId, userId, 'incident.discard', jobId, {
      previousState: existing[0].state,
    });
    return { status: 200 as const, data: rows[0] };
  });

  if (result.status === 404) return apiError(c, 404, statusTitle(404), 'job not found');
  if (result.status === 409) return apiError(c, 409, statusTitle(409), result.message);
  return c.json({ success: true, data: result.data });
});

export { router as incidentsRouter };
