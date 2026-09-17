// ─── Content bundles (F-36/F-37, L3.0) — real DB CRUD + lifecycle ───
// state machine: generated/hold → approved → scheduled → publishing → published
// approve/revise/reject transitions are audited (LBI-08) and ToS-gated
// (LBI-11: only a complete passing report can reach approval).

import { Hono } from 'hono';
import { z } from 'zod';
import { boundedJsonValidator as zValidator } from '../bounded-json-validator.js';
import { sql, eq, and } from 'drizzle-orm';
import {
  schema,
  getPublishingConsentStatus,
  consentRequirementMessage,
  getTosScanState,
} from '@axiom/db';
import type { AppBindings } from '../index.js';
import {
  withOrgContext,
  modelOrgId,
  requireOrg,
  writeAudit,
  apiError,
  statusTitle,
  tosApprovalFailure,
  resolvePublishConnections,
} from './helpers.js';
import { parseCursor, cursorLt, nextCursor } from '../contract.js';
import { asPlatform, enqueueJob, resolveCapabilities } from '@axiom/worker';
import type { Platform } from '@axiom/core';
import { queueBundleRevision } from '../bundle-revision.js';
import { assetPreview } from '../asset-preview.js';
import { isScopedHumanRole, modelAccessCondition } from '../model-access.js';
import { reviewedVideoReport, videoReviewRequest } from '../video-review.js';

const router = new Hono<AppBindings>();

const createBundleSchema = z.object({
  modelId: z.string().uuid(),
  assetId: z.string().uuid().optional(),
  variantId: z.string().uuid().optional(),
  assignmentId: z.string().uuid().optional(),
  variantCaption: z.object({ platform: z.string().min(1).max(50), text: z.string().trim().min(1).max(10000) }).strict().optional(),
  captions: z.record(z.string(), z.string()).default({}),
  hashtags: z.array(z.string()).default([]),
  scheduleRequest: z.object({ platform: z.string().min(1).max(30), scheduledAt: z.string().datetime() }).strict().optional(),
}).refine(body => !body.scheduleRequest || Date.parse(body.scheduleRequest.scheduledAt) > Date.now(),
  { message: 'Requested schedule must be in the future' });

const approveBundleSchema = z.object({
  revisionId: z.string().uuid().optional(),
  platforms: z.array(z.string().min(1)).min(1),
  slot: z.string().datetime().optional(),
  connectionIds: z.record(z.string().min(1), z.string().uuid()).default({}),
});

const reviseBundleSchema = z.object({
  revisionId: z.string().uuid().optional(),
  instructions: z.string().trim().min(1).max(2000),
});

const rejectBundleSchema = z.object({ revisionId: z.string().uuid().optional() });

type PublishIntent = {
  action: 'schedule' | 'publish';
  platform: string;
  scheduledAt: string | null;
};

function parsePublishIntent(value: unknown): PublishIntent | null {
  if (!value || typeof value !== 'object') return null;
  const intent = value as Record<string, unknown>;
  if (intent.action !== 'schedule' && intent.action !== 'publish') return null;
  if (typeof intent.platform !== 'string' || intent.platform.length === 0) return null;
  if (intent.scheduledAt !== null && typeof intent.scheduledAt !== 'string') return null;
  return {
    action: intent.action,
    platform: intent.platform,
    scheduledAt: intent.scheduledAt,
  };
}

// GET /api/v1/bundles/:id — bundle detail + variants + ToS scores
router.get('/:id', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const { id } = c.req.param();

  const result = await withOrgContext(orgId, async (tx) => {
    const rows = await tx
      .select()
      .from(schema.contentBundle)
      .where(and(eq(schema.contentBundle.id, id), eq(schema.contentBundle.orgId, orgId), modelAccessCondition(c.get('role'), orgId, c.get('userId'), schema.contentBundle.modelId)))
      .limit(1);
    if (!rows[0]) return null;
    if (rows[0].assetId && rows[0].tosReport?.verdict === 'pending') {
      return { data: rows[0], scanFailed: (await getTosScanState(tx, orgId, id)) === 'failed' };
    }
    if (rows[0].state !== 'generated' || rows[0].assetId) return { data: rows[0] };
    const settings = await tx.select({ publishingEnabled: schema.orgSettings.publishingEnabled })
      .from(schema.orgSettings).where(eq(schema.orgSettings.orgId, orgId)).limit(1);
    // Same fail-closed interpretation as the worker; this is a snapshot, not
    // a claim that a worker is running or that a generation was dispatched.
    return { data: rows[0], generationPaused: settings[0]?.publishingEnabled !== true };
  });
  if (!result) return apiError(c, 404, statusTitle(404), 'bundle not found');
  return c.json(result);
});

// Authenticated browser media delivery; no storage path is returned to clients.
router.get('/:id/media', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const id = z.string().uuid().safeParse(c.req.param('id'));
  if (!id.success) return apiError(c, 400, statusTitle(400), 'invalid bundle id');
  const asset = await withOrgContext(orgId, async (tx) => {
    const [bundle] = await tx.select().from(schema.contentBundle)
      .where(and(eq(schema.contentBundle.id, id.data), eq(schema.contentBundle.orgId, orgId), modelAccessCondition(c.get('role'), orgId, c.get('userId'), schema.contentBundle.modelId))).limit(1);
    if (!bundle?.assetId || bundle.orgId !== orgId) return null;
    const [row] = await tx.select().from(schema.asset).where(and(
      eq(schema.asset.id, bundle.assetId), eq(schema.asset.orgId, orgId), eq(schema.asset.modelId, bundle.modelId),
    )).limit(1);
    return row?.orgId === orgId && row.modelId === bundle.modelId && row.id === bundle.assetId ? row : null;
  });
  if (!asset) return apiError(c, 404, statusTitle(404), 'media unavailable');
  try {
    return await assetPreview(asset, c.req.raw, process.env.AXIOM_MEDIA_ROOT ?? 'var/media');
  } catch {
    // Filesystem errors must never reveal paths or asset metadata.
    return apiError(c, 404, statusTitle(404), 'media unavailable');
  }
});

// Separate, explicit compliance decision. This neither schedules nor publishes.
router.post('/:id/video-review', zValidator('json', videoReviewRequest), async (c) => {
  const orgId = requireOrg(c);
  const userId = c.get('userId');
  if (!orgId || !userId) return apiError(c, 401, statusTitle(401), 'authentication required');
  const id = z.string().uuid().safeParse(c.req.param('id'));
  if (!id.success) return apiError(c, 400, statusTitle(400), 'invalid bundle id');
  const input = c.req.valid('json');
  const result = await withOrgContext(orgId, async (tx) => {
    const [bundle] = await tx.select().from(schema.contentBundle).where(and(
      eq(schema.contentBundle.id, id.data), eq(schema.contentBundle.orgId, orgId),
    )).limit(1).for('update');
    if (!bundle || bundle.orgId !== orgId) return { status: 404 as const, error: 'bundle not found' };
    if (!['generated', 'hold'].includes(bundle.state) || !bundle.assetId
      || await getTosScanState(tx, orgId, bundle.id) !== 'completed')
      return { status: 409 as const, error: 'A completed video scan on a reviewable bundle is required' };
    const [asset] = await tx.select().from(schema.asset).where(and(
      eq(schema.asset.id, bundle.assetId), eq(schema.asset.orgId, orgId), eq(schema.asset.modelId, bundle.modelId),
    )).limit(1).for('share');
    if (!asset || asset.id !== bundle.assetId || asset.orgId !== orgId || asset.modelId !== bundle.modelId
      || asset.kind !== 'video' || asset.mimeType !== 'video/mp4')
      return { status: 409 as const, error: 'Video asset unavailable' };
    let report;
    try {
      report = reviewedVideoReport(bundle, Buffer.from(asset.sha256).toString('hex'), input, userId, new Date());
      // Confirm that the bytes still match the scan, without delivering a body.
      await assetPreview(asset, new Request('http://internal/media', { method: 'HEAD', signal: c.req.raw.signal }),
        process.env.AXIOM_MEDIA_ROOT ?? 'var/media');
    } catch {
      return { status: 409 as const, error: 'Video review could not be accepted: refresh and check the current scan and media' };
    }
    await tx.update(schema.contentBundle).set({ tosReport: report, updatedAt: new Date() }).where(and(
      eq(schema.contentBundle.id, bundle.id), eq(schema.contentBundle.orgId, orgId),
    ));
    await writeAudit(tx, orgId, userId, 'bundle.video-review', bundle.id, report.humanReview);
    return { status: 200 as const, data: { id: bundle.id, tosReport: report } };
  });
  if (result.status !== 200) return apiError(c, result.status, statusTitle(result.status), result.error);
  return c.json({ data: result.data });
});

// POST /api/v1/bundles — create a generated bundle (from generator pipeline)
router.post('/', zValidator('json', createBundleSchema), async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const body = c.req.valid('json');
  const userId = c.get('userId') ?? 'system';
  if (body.assignmentId && !body.variantId) return apiError(c, 400, statusTitle(400), 'Assignment review requires its variant');
  if (body.variantCaption && !body.variantId) return apiError(c, 400, statusTitle(400), 'Variant caption requires a variant');
  if (body.variantId && (body.assetId || Object.keys(body.captions).length || body.hashtags.length))
    return apiError(c, 400, statusTitle(400), 'Variant review uses the saved copy and media; overrides are not accepted');
  if (body.assetId) {
    const entries = Object.entries(body.captions);
    if (!entries.length || entries.length > 11 || entries.some(([, caption]) => !caption.trim() || caption.length > 10_000)
      || body.hashtags.length > 100 || body.hashtags.some(tag => tag.length > 100))
      return apiError(c, 400, statusTitle(400), 'Saved media requires bounded captions for at least one platform');
    try { entries.forEach(([platform]) => asPlatform(platform)); }
    catch { return apiError(c, 400, statusTitle(400), 'Unsupported target platform'); }
  }

  const inserted = await withOrgContext(orgId, async (tx) => {
    if ((await modelOrgId(tx, body.modelId)) !== orgId) return null;
    if (isScopedHumanRole(c.get('role'))) {
      const [assigned] = await tx.select({ id: schema.modelProfile.id }).from(schema.modelProfile).where(and(
        eq(schema.modelProfile.id, body.modelId), eq(schema.modelProfile.orgId, orgId),
        modelAccessCondition(c.get('role'), orgId, userId),
      )).limit(1);
      if (!assigned) return null;
    }
    let assignmentPlatform: string | undefined;
    if (body.assignmentId) {
      const a = schema.variantExperimentAssignment, e = schema.variantExperiment;
      const [lookup] = await tx.select({ experimentId: a.experimentId }).from(a).where(and(eq(a.id, body.assignmentId), eq(a.orgId, orgId))).limit(1);
      if (!lookup) return null;
      const [experiment] = await tx.select().from(e).where(and(eq(e.id, lookup.experimentId), eq(e.orgId, orgId), eq(e.modelId, body.modelId))).limit(1).for('share');
      if (!experiment) return null;
      const [assignment] = await tx.select().from(a).where(and(eq(a.id, body.assignmentId), eq(a.orgId, orgId), eq(a.experimentId, experiment.id))).limit(1).for('update');
      if (!assignment || assignment.variantId !== body.variantId || !experiment.variantIds.includes(body.variantId)) return null;
      if (assignment.reviewBundleId) {
        const [existing] = await tx.select().from(schema.contentBundle).where(and(eq(schema.contentBundle.id, assignment.reviewBundleId), eq(schema.contentBundle.orgId, orgId), eq(schema.contentBundle.modelId, body.modelId))).limit(1);
        return existing ?? null;
      }
      if (!['running', 'paused'].includes(experiment.status)) return null;
      assignmentPlatform = experiment.platform;
    }
    if (body.variantId) {
      const [variant] = await tx.select({ id: schema.assetVariant.id, outputAssetId: schema.assetVariant.outputAssetId,
        variantType: schema.assetVariant.variantType, settings: schema.assetVariant.settings,
      }).from(schema.assetVariant).innerJoin(schema.asset, eq(schema.asset.id, schema.assetVariant.assetId)).where(and(
        eq(schema.assetVariant.id, body.variantId), eq(schema.assetVariant.orgId, orgId),
        eq(schema.asset.orgId, orgId), eq(schema.asset.modelId, body.modelId),
      )).limit(1).for('share');
      if (!variant || !variant.outputAssetId) return null;
      const isCopy = ['caption', 'teaser'].includes(variant.variantType);
      if (isCopy && body.variantCaption) return null;
      if (!isCopy && !['crop', 'image_clip', 'image_resize', 'video_clip', 'video_transcode'].includes(variant.variantType)) return null;
      const copy = z.object({ platform: z.string().min(1).max(50), text: z.string().trim().min(1).max(10000) }).safeParse(isCopy ? variant.settings?.copy : body.variantCaption);
      if (!copy.success) return null;
      if (assignmentPlatform && copy.data.platform !== assignmentPlatform) return null;
      try { asPlatform(copy.data.platform); } catch { return null; }
      body.assetId = variant.outputAssetId;
      body.captions = { [copy.data.platform]: copy.data.text };
    }
    if (body.scheduleRequest && !Object.hasOwn(body.captions, body.scheduleRequest.platform)) return null;
    if (body.assetId) {
      const [asset] = await tx.select().from(schema.asset).where(and(
        eq(schema.asset.id, body.assetId), eq(schema.asset.orgId, orgId), eq(schema.asset.modelId, body.modelId),
      )).limit(1).for('share');
      if (!asset || asset.id !== body.assetId || asset.orgId !== orgId || asset.modelId !== body.modelId
        || !['image/jpeg', 'image/png', 'video/mp4'].includes(asset.mimeType)) return null;
      try {
        await assetPreview(asset, new Request('http://internal/media', { method: 'HEAD', signal: c.req.raw.signal }),
          process.env.AXIOM_MEDIA_ROOT ?? 'var/media');
      } catch { return null; }
    }
    const [row] = await tx
      .insert(schema.contentBundle)
      .values({
        orgId,
        modelId: body.modelId,
        assetId: body.assetId,
        sourceVariantId: body.variantId,
        publishIntent: body.scheduleRequest ? { action: 'schedule', platform: body.scheduleRequest.platform, scheduledAt: body.scheduleRequest.scheduledAt } : null,
        captions: body.captions,
        hashtags: body.hashtags,
        // Compliance reports are produced by the trusted generation/worker
        // path. Never accept a browser-supplied report as an approval input.
        tosReport: body.assetId ? { verdict: 'pending', scores: [], reasons: ['Saved media and captions await a fresh ToS scan'] } : null,
        state: 'generated',
      })
      .returning();
    if (body.assignmentId) await tx.update(schema.variantExperimentAssignment).set({ reviewBundleId: row.id }).where(and(
      eq(schema.variantExperimentAssignment.id, body.assignmentId), eq(schema.variantExperimentAssignment.orgId, orgId),
    ));
    await writeAudit(tx, orgId, userId, 'bundle.create', row.id, {
      modelId: body.modelId,
      assetId: body.assetId,
      sourceVariantId: body.variantId,
      state: 'generated',
    });
    if (body.assetId) await enqueueJob(tx, { orgId, queue: 'tos', kind: 'tos.scan',
      payload: { bundleId: row.id }, dedupeParts: ['tos.scan', row.id] });
    return row;
  });
  if (!inserted) return apiError(c, 404, statusTitle(404), 'Model or saved media unavailable; review requires JPEG, PNG or MP4');
  return c.json({ data: inserted }, 201);
});

// POST /api/v1/bundles/:id/approve — ToS-gated approval (LBI-11)
router.post('/:id/approve', zValidator('json', approveBundleSchema), async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const { id } = c.req.param();
  const body = c.req.valid('json');
  const userId = c.get('userId') ?? 'system';

  const platforms: Platform[] = [];
  const seenPlatforms = new Set<string>();
  for (const requestedPlatform of body.platforms) {
    let platform: Platform;
    try {
      platform = asPlatform(requestedPlatform);
    } catch {
      return apiError(
        c,
        400,
        statusTitle(400),
        `unsupported target platform '${requestedPlatform}'`,
      );
    }
    if (seenPlatforms.has(platform)) {
      return apiError(c, 400, statusTitle(400), `duplicate target platform '${platform}'`);
    }
    seenPlatforms.add(platform);
    platforms.push(platform);
  }

  const result = await withOrgContext(orgId, async (tx) => {
    const rows = await tx
      .select()
      .from(schema.contentBundle)
      .where(and(eq(schema.contentBundle.id, id), eq(schema.contentBundle.orgId, orgId)))
      .limit(1)
      .for('update');
    if (rows.length === 0) return { status: 404 as const, data: null };
    const bundle = rows[0];
    if ((bundle.tosReport?.revisionId ?? null) !== (body.revisionId ?? null)) {
      return {
        status: 409 as const,
        error: 'bundle revision changed; refresh and review the latest content before approval',
      };
    }
    if (bundle.state !== 'generated' && bundle.state !== 'hold') {
      return {
        status: 409 as const,
        error: `bundle is already ${bundle.state}; only generated or held bundles can be approved`,
      };
    }

    // ToS gate: every requested destination needs exactly one trusted passing
    // score. Missing, review, block, and malformed reports all fail closed.
    const tosFailure = tosApprovalFailure(bundle.tosReport, platforms);
    if (tosFailure) return { status: 409 as const, error: tosFailure };

    for (const platform of platforms) {
      const consent = await getPublishingConsentStatus(tx, orgId, bundle.modelId, platform);
      if (!consent.ok) {
        return {
          status: 409 as const,
          error: consentRequirementMessage(consent, platform),
        };
      }
    }

    // Generation currently creates prompt/caption bundles; it does not
    // create an asset row. Do not enqueue a publish job that the connector
    // will inevitably reject for missing media. Text-capable connectors can
    // still be approved without an asset; all others fail before mutation.
    if (!bundle.assetId) {
      for (const platform of platforms) {
        try {
          if (resolveCapabilities(platform).media.includes('text')) continue;
        } catch {
          return {
            status: 409 as const,
            error: `cannot resolve ${platform} capabilities; media requirement is unknown`,
          };
        }
        return {
          status: 409 as const,
          error: `bundle has no media asset; ${platform} requires media before approval`,
        };
      }
    }

    // The asset foreign key only proves that the referenced row exists; it
    // does not enforce the bundle's org/model ownership. Validate the full
    // publication asset contract before creating targets so approval cannot
    // enqueue a job that the worker will inevitably reject later.
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
          error:
            'bundle references an unavailable or unsupported media asset; approval cannot continue',
        };
      }
      // Ownership and a passing scan do not prove that every destination can
      // publish this asset. Match the same capability contract used downstream
      // before committing an approval or any durable publishing work.
      for (const platform of platforms) {
        try {
          if (resolveCapabilities(platform).media.includes(asset.kind)) continue;
        } catch {
          return {
            status: 409 as const,
            error: `cannot resolve ${platform} capabilities; media support is unknown`,
          };
        }
        return {
          status: 409 as const,
          error: `${platform} does not support ${asset.kind} assets; approval cannot continue`,
        };
      }
    }

    const tosScanState = await getTosScanState(tx, orgId, id);
    if (tosScanState !== 'completed') {
      return {
        status: 409 as const,
        error:
          tosScanState === 'pending'
            ? 'ToS scan is still running; approval must wait for the scan to complete'
            : tosScanState === 'failed'
              ? 'ToS scan failed; approval is blocked until a successful scan is available'
              : 'ToS scan is missing; approval is blocked until the bundle is scanned',
      };
    }

    // MCP-created bundles keep their requested timing until approval. An
    // explicit dashboard slot always wins; otherwise publish requests become
    // immediate on approval and scheduled requests use their persisted slot.
    const publishIntent = parsePublishIntent(bundle.publishIntent);
    const immediateIntent = !body.slot && publishIntent?.action === 'publish';
    const slot = body.slot
      ? new Date(body.slot)
      : immediateIntent
        ? new Date()
        : publishIntent?.scheduledAt
          ? new Date(publishIntent.scheduledAt)
          : new Date(Date.now() + 3600_000);
    if (!immediateIntent && (Number.isNaN(slot.getTime()) || slot.getTime() <= Date.now())) {
      return {
        status: 400 as const,
        error: 'approval slot must be a valid future timestamp',
      };
    }

    const connectionResolution = await resolvePublishConnections(
      tx,
      orgId,
      bundle.modelId,
      platforms,
      body.connectionIds,
    );
    if ('error' in connectionResolution) {
      return { status: 409 as const, error: connectionResolution.error };
    }

    // Claim the approval transition before creating any downstream work. The
    // compare-and-set is the concurrency gate: if another operator changed
    // the bundle after the initial read, return a conflict without leaving
    // post targets or publish jobs behind in a transaction that did not win.
    const [updated] = await tx
      .update(schema.contentBundle)
      .set({ state: 'approved', updatedAt: new Date() })
      .where(
        and(
          eq(schema.contentBundle.id, id),
          eq(schema.contentBundle.orgId, orgId),
          eq(schema.contentBundle.state, bundle.state),
        ),
      )
      .returning();
    if (!updated) {
      return {
        status: 409 as const,
        error: 'bundle changed while approval was being applied; retry the action',
      };
    }

    // Create post_targets (per-platform) and durable publish jobs in the same
    // transaction as the winning state transition.
    for (const platform of platforms) {
      const [target] = await tx
        .insert(schema.postTarget)
        .values({
          orgId,
          bundleId: id,
          platform,
          connectionId: connectionResolution.connections.get(platform),
          scheduledFor: slot,
          state: 'pending',
          remoteId: null,
          error: null,
          idemKey: Buffer.from(`${id}|${platform}|${slot.toISOString()}`),
        })
        .returning({ id: schema.postTarget.id });
      if (!target?.id) throw new Error(`bundle.approve: target insert returned no id`);

      // Approval is also the dashboard's scheduling action. Enqueue in the
      // same transaction as the target so a committed approval always has a
      // durable worker handoff, with duplicate taps collapsed by target ID.
      await enqueueJob(tx, {
        orgId,
        queue: 'publish',
        kind: 'publish.target',
        payload: { targetId: target.id },
        runAfter: slot,
        dedupeParts: ['publish.target', target.id],
      });
    }
    await writeAudit(tx, orgId, userId, 'bundle.approve', id, {
      platforms,
      connectionIds: Object.fromEntries(
        platforms.map((platform) => [platform, connectionResolution.connections.get(platform)]),
      ),
      slot: slot.toISOString(),
    });
    return { status: 200 as const, data: updated };
  });

  if (result.status === 404) return apiError(c, 404, statusTitle(404), 'bundle not found');
  if (result.status === 400)
    return apiError(c, 400, statusTitle(400), result.error ?? 'invalid slot');
  if (result.status === 409) return apiError(c, 409, statusTitle(409), result.error ?? 'conflict');
  return c.json({ data: result.data });
});

// POST /api/v1/bundles/:id/revise — queue caption revision and a fresh ToS scan
router.post('/:id/revise', zValidator('json', reviseBundleSchema), async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const { id } = c.req.param();
  const body = c.req.valid('json');
  const userId = c.get('userId') ?? 'system';

  const result = await withOrgContext(orgId, async (tx) => {
    const current = await tx
      .select({
        id: schema.contentBundle.id,
        state: schema.contentBundle.state,
        tosReport: schema.contentBundle.tosReport,
      })
      .from(schema.contentBundle)
      .where(and(eq(schema.contentBundle.id, id), eq(schema.contentBundle.orgId, orgId)))
      .limit(1)
      .for('update');
    if (current.length === 0) return { status: 404 as const, data: null };
    if ((current[0].tosReport?.revisionId ?? null) !== (body.revisionId ?? null)) {
      return {
        status: 409 as const,
        error: 'bundle revision changed; refresh and review the latest content before revision',
      };
    }
    if (current[0].state !== 'generated' && current[0].state !== 'hold') {
      return {
        status: 409 as const,
        error: `bundle is already ${current[0].state}; only generated or held bundles can be revised`,
      };
    }

    const revised = await queueBundleRevision(
      tx,
      orgId,
      id,
      current[0].state,
      body.instructions,
      userId,
    );
    await writeAudit(tx, orgId, userId, 'bundle.revise', id, {
      instructions: body.instructions,
    });
    return { status: 200 as const, data: revised };
  });
  if (result.status === 404) return apiError(c, 404, statusTitle(404), 'bundle not found');
  if (result.status === 409) return apiError(c, 409, statusTitle(409), result.error ?? 'conflict');
  return c.json({ data: result.data });
});

// POST /api/v1/bundles/:id/reject
router.post('/:id/reject', zValidator('json', rejectBundleSchema), async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const { id } = c.req.param();
  const body = c.req.valid('json');
  const userId = c.get('userId') ?? 'system';

  const result = await withOrgContext(orgId, async (tx) => {
    const current = await tx
      .select({
        id: schema.contentBundle.id,
        state: schema.contentBundle.state,
        tosReport: schema.contentBundle.tosReport,
      })
      .from(schema.contentBundle)
      .where(and(eq(schema.contentBundle.id, id), eq(schema.contentBundle.orgId, orgId)))
      .limit(1)
      .for('update');
    if (current.length === 0) return { status: 404 as const, data: null };
    if ((current[0].tosReport?.revisionId ?? null) !== (body.revisionId ?? null)) {
      return {
        status: 409 as const,
        error: 'bundle revision changed; refresh and review the latest content before rejection',
      };
    }
    if (current[0].state !== 'generated' && current[0].state !== 'hold') {
      return {
        status: 409 as const,
        error: `bundle is already ${current[0].state}; only generated or held bundles can be rejected`,
      };
    }

    const rows = await tx
      .update(schema.contentBundle)
      .set({ state: 'rejected', updatedAt: new Date() })
      .where(
        and(
          eq(schema.contentBundle.id, id),
          eq(schema.contentBundle.orgId, orgId),
          eq(schema.contentBundle.state, current[0].state),
        ),
      )
      .returning();
    if (rows.length === 0) {
      return {
        status: 409 as const,
        error: 'bundle changed while rejection was being applied; retry the action',
      };
    }
    await writeAudit(tx, orgId, userId, 'bundle.reject', id, {});
    return { status: 200 as const, data: rows[0] };
  });
  if (result.status === 404) return apiError(c, 404, statusTitle(404), 'bundle not found');
  if (result.status === 409) return apiError(c, 409, statusTitle(409), result.error ?? 'conflict');
  return c.json({ data: result.data });
});

// GET /api/v1/bundles — list bundles for a model (dashboard approvals tab)
router.get('/', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const modelId = c.req.query('modelId');
  const state = c.req.query('state');
  const { limit, cursor } = parseCursor(c);

  const rows = await withOrgContext(orgId, (tx) => {
    const conds = [
      eq(schema.contentBundle.orgId, orgId),
      modelAccessCondition(c.get('role'), orgId, c.get('userId'), schema.contentBundle.modelId),
      ...cursorLt(schema.contentBundle.createdAt, schema.contentBundle.id, cursor),
    ];
    if (modelId) conds.push(eq(schema.contentBundle.modelId, modelId));
    if (state) conds.push(eq(schema.contentBundle.state, state));
    return tx
      .select()
      .from(schema.contentBundle)
      .where(and(...conds))
      .limit(limit)
      .orderBy(sql`${schema.contentBundle.createdAt} DESC`, sql`${schema.contentBundle.id} DESC`);
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

export { router as bundlesRouter };
