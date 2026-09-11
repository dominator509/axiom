// ─── Generation pipeline (F-36, L3.0) — TOKENKILLER + LLM + ToS → bundle ───
// POST /models/:id/generate — runs the Master Prompt Engine
// (generatePhotoshootPrompts, TOKENKILLER S0-S3), optionally enriches via the
// LLM gateway, evaluates text ToS rules per platform (LBI-11), and persists a
// text-only content_bundle. It does not create a media asset; the operator
// must supply one separately before approving a media-only destination.
// The operator then approves/revises/rejects via Relay or the dashboard
// approvals tab.

import { Hono } from 'hono';
import { z } from 'zod';
import { boundedJsonValidator as zValidator } from '../bounded-json-validator.js';
import { eq, and, desc, inArray, sql } from 'drizzle-orm';
import { schema } from '@axiom/db';
import type { AppBindings } from '../index.js';
import { withOrgContext, requireOrg, writeAudit, apiError, statusTitle } from './helpers.js';
import {
  generatePhotoshootPrompts,
  buildS0,
  buildS1,
  buildS2,
  buildS3,
  assemblePrompt,
  type ModelProfile as PromptModelProfile,
} from '@axiom/llm-gateway';
import { LLMGateway } from '@axiom/llm-gateway';
import { evaluateTextToS } from '@axiom/fanvue-mcp';
import { asPlatform, enqueueJob, retrieveTopExemplars } from '@axiom/worker';

type PromptPlatform =
  | 'instagram'
  | 'tiktok'
  | 'x'
  | 'youtube'
  | 'facebook'
  | 'reddit'
  | 'threads'
  | 'snapchat'
  | 'discord'
  | 'telegram'
  | 'fanvue';

const router = new Hono<AppBindings>();

router.get('/models/:modelId/media-source-images', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const modelId = c.req.param('modelId');
  const data = await withOrgContext(orgId, async tx => tx.select({
    id: schema.asset.id, fileName: schema.asset.fileName,
  }).from(schema.asset).where(and(
    eq(schema.asset.orgId, orgId), eq(schema.asset.modelId, modelId),
    eq(schema.asset.kind, 'image'), inArray(schema.asset.mimeType, ['image/jpeg', 'image/png']),
  )).orderBy(desc(schema.asset.createdAt), desc(schema.asset.id)).limit(100));
  return c.json({ data });
});

const generateSchema = z.object({
  style: z.string().min(1).max(100).default('studio'),
  outfit: z.string().min(1).max(100).default('summer dress'),
  location: z.string().min(1).max(100).default('studio'),
  mood: z.string().min(1).max(100).default('energetic'),
  lighting: z.string().min(1).max(100).default('soft studio'),
  aspectRatio: z.string().min(1).max(20).default('4:5'),
  platforms: z.array(z.string().min(1).max(30)).min(1).default(['instagram']),
  enrichWithLlm: z.boolean().default(false),
  model: z.string().max(100).optional(),
  media: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('image'), prompt: z.string().trim().min(1).max(4000),
      aspectRatio: z.enum(['auto', '1:1', '16:9', '9:16', '4:5', '3:2', '2:3']).default('auto') }).strict(),
    z.object({ kind: z.literal('video'), prompt: z.string().trim().min(1).max(4000),
      sourceAssetId: z.string().uuid(), duration: z.union([z.literal(6), z.literal(10)]).default(6) }).strict(),
  ]).optional(),
});

// Explicit user intent, never an automatic provider retry. Keep old evidence
// intact and reject the superseded bundle so concurrent clicks cannot fork it.
router.post('/models/:modelId/generate/:bundleId/retry', zValidator('json', z.object({
  prompt: z.string().trim().min(1).max(4000).optional(),
  acknowledgeUsage: z.literal(true),
}).strict()), async c => {
  const orgId = requireOrg(c);
  const userId = c.get('userId');
  if (!orgId || !userId) return apiError(c, 401, statusTitle(401), 'Authenticated operator required');
  const { modelId, bundleId } = c.req.param();
  if (!z.string().uuid().safeParse(bundleId).success || !z.string().uuid().safeParse(modelId).success)
    return apiError(c, 400, statusTitle(400), 'Invalid model or bundle');
  const body = c.req.valid('json');
  const result = await withOrgContext(orgId, async tx => {
    const [bundle] = await tx.select().from(schema.contentBundle).where(and(
      eq(schema.contentBundle.id, bundleId), eq(schema.contentBundle.orgId, orgId),
      eq(schema.contentBundle.modelId, modelId),
    )).limit(1).for('update');
    if (!bundle) return null;
    if (!['generated', 'hold'].includes(bundle.state)) return false;
    const [job] = await tx.select().from(schema.job).where(and(
      eq(schema.job.orgId, orgId), eq(schema.job.kind, 'media.generate'),
      sql`${schema.job.payload}->>'bundleId' = ${bundleId}`,
    )).orderBy(desc(schema.job.createdAt), desc(schema.job.id)).limit(1).for('update');
    if (!job || job.payload?.userId !== userId || job.lockedBy || job.lockedAt) return false;
    const media = generateSchema.shape.media.safeParse(job.payload && {
      kind: job.payload.kind, prompt: body.prompt ?? job.payload.prompt,
      ...(job.payload.kind === 'image' ? { aspectRatio: job.payload.aspectRatio } : {
        sourceAssetId: job.payload.sourceAssetId, duration: job.payload.duration,
      }),
    });
    if (!media.success || !media.data) return false;
    const [attempt] = await tx.select().from(schema.mediaGenerationAttempt).where(and(
      eq(schema.mediaGenerationAttempt.jobId, job.id), eq(schema.mediaGenerationAttempt.orgId, orgId),
    )).limit(1);
    const preDispatchFailure = !bundle.assetId && !attempt && ['dead', 'failed'].includes(job.state)
      && !job.lastError?.startsWith('external-side-effect-unknown:');
    const scannedOutput = job.state === 'done' && bundle.assetId && attempt?.state === 'completed'
      && attempt.assetId === bundle.assetId && ['block', 'review'].includes(String(bundle.tosReport?.verdict));
    if (!preDispatchFailure && !scannedOutput) return false;
    // A moderation block requires a substantive, operator-reviewed change.
    if (bundle.tosReport?.verdict === 'block' && (!body.prompt || body.prompt === job.payload?.prompt)) return false;
    const [next] = await tx.insert(schema.contentBundle).values({
      orgId, modelId, captions: bundle.captions, hashtags: bundle.hashtags,
      state: 'generated', tosReport: { verdict: 'pending', reasons: ['New media and fresh ToS scan required'] },
    }).returning();
    await tx.update(schema.contentBundle).set({ state: 'rejected', updatedAt: new Date() })
      .where(and(eq(schema.contentBundle.id, bundleId), eq(schema.contentBundle.orgId, orgId)));
    await enqueueJob(tx, { orgId, queue: 'content', kind: 'media.generate',
      payload: { ...media.data, userId, bundleId: next.id },
      dedupeParts: ['media.generate', next.id] });
    await writeAudit(tx, orgId, userId, 'bundle.media-retry', next.id, {
      previousBundleId: bundleId, previousJobId: job.id, promptModified: body.prompt !== undefined,
    });
    return next;
  });
  if (result === null) return apiError(c, 404, statusTitle(404), 'Bundle not found');
  if (result === false) return apiError(c, 409, statusTitle(409),
    'Retry unavailable: reconcile active or uncertain provider outcomes first. Blocked content requires an edited prompt. Privacy, storage and account errors require configuration changes.');
  return c.json({ data: { bundle: result, mediaGeneration: 'queued' } }, 201);
});

// POST /models/:id/generate
router.post('/models/:modelId/generate', zValidator('json', generateSchema), async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const { modelId } = c.req.param();
  const body = c.req.valid('json');
  const userId = c.get('userId') ?? 'system';

  // Keep generation targets aligned with the connector/worker contract. The
  // prompt and ToS paths use platform-specific rules, so accepting arbitrary
  // strings here would persist captions that no worker can publish.
  const platforms: PromptPlatform[] = [];
  const seenPlatforms = new Set<PromptPlatform>();
  for (const requestedPlatform of body.platforms) {
    let platform: PromptPlatform;
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
    // Verify model belongs to org
    const models = await tx
      .select()
      .from(schema.modelProfile)
      .where(and(eq(schema.modelProfile.id, modelId), eq(schema.modelProfile.orgId, orgId)))
      .limit(1);
    if (models.length === 0) return { status: 404 as const, data: null };
    const model = models[0];
    if (body.media?.kind === 'video') {
      const [source] = await tx.select().from(schema.asset).where(and(
        eq(schema.asset.id, body.media.sourceAssetId), eq(schema.asset.orgId, orgId),
        eq(schema.asset.modelId, modelId),
      )).limit(1);
      if (!source || source.kind !== 'image' || !['image/jpeg', 'image/png'].includes(source.mimeType))
        return { status: 400 as const, data: null };
    }

    const promptPlatform = (platforms[0] ?? 'instagram') as PromptPlatform;
    const profile: PromptModelProfile = {
      id: model.id,
      displayName: model.displayName,
      handle: model.handle,
      avatarUrl: model.avatarUrl ?? null,
      bio: model.bio ?? null,
    };

    // 1. Master Prompt Engine — 5 variants (F-36)
    const variants = generatePhotoshootPrompts({
      modelName: model.displayName,
      style: body.style,
      outfit: body.outfit,
      location: body.location,
      mood: body.mood,
      lighting: body.lighting,
      aspectRatio: body.aspectRatio,
      platform: promptPlatform,
    });

    // 2. Optional LLM enrichment through the gateway (real provider call)
    let enrichedCaption: string | null = null;
    if (body.enrichWithLlm) {
      try {
        const gateway = new LLMGateway();
        // F-83 exemplar injection: retrieve the model's best-performing
        // exemplars from the DB-backed viral memory (L2.8) and feed them
        // into the S2 segment so generation is guided by what worked.
        const exemplars = await retrieveTopExemplars(tx, orgId, modelId, promptPlatform, 3);
        const prompt = assemblePrompt({
          S0: buildS0(profile),
          S1: buildS1(promptPlatform),
          S2: buildS2(exemplars),
          S3: buildS3({
            modelId,
            task: 'Write an engaging caption for the photoshoot, max 200 chars.',
            platform: promptPlatform,
            context: variants[0].caption,
          }),
        });
        const chat = await gateway.chat(
          [
            { role: 'system', content: prompt },
            { role: 'user', content: variants[0].prompt },
          ],
          // The subscription profile is selected from authenticated context,
          // never from request JSON or the audit-only 'system' fallback.
          { model: body.model, userId: c.get('userId') },
        );
        enrichedCaption = chat.content.trim();
      } catch (err) {
        // LLM enrichment is best-effort; the bundle still forms from the
        // prompt engine. Never fail generation because a provider is down.
        console.error('generate enrich failed:', (err as Error).message);
      }
    }

    // 3. ToS text evaluation per platform (LBI-11)
    const captions: Record<string, string> = {};
    const tosScores: Record<string, unknown>[] = [];
    const allReasons = new Set<string>();
    for (const platform of platforms) {
      const caption = enrichedCaption ?? variants[0].caption;
      captions[platform] = caption;
      const evalResult = evaluateTextToS(caption, variants[0].hashtags, [platform]);
      tosScores.push(...evalResult.scores);
      evalResult.reasons.forEach((r) => allReasons.add(r));
    }
    const textReport = {
      verdict: tosScores.some((s) => s.verdict === 'block')
        ? 'block'
        : tosScores.some((s) => s.verdict === 'review')
          ? 'review'
          : 'pass',
      scores: tosScores,
      reasons: Array.from(allReasons),
    };

    // A text scan cannot certify media that has not been generated yet.
    const tosReport = body.media
      ? { verdict: 'pending', scores: [], reasons: ['Media generation and visual ToS scan pending'] }
      : textReport;

    // 4. Persist the bundle
    const [bundle] = await tx
      .insert(schema.contentBundle)
      .values({
        orgId,
        modelId,
        captions,
        hashtags: variants[0].hashtags,
        tosReport,
        state: 'generated',
      })
      .returning();
    await writeAudit(tx, orgId, userId, 'bundle.generate', bundle.id, {
      modelId,
      variantCount: variants.length,
      platforms,
      tosVerdict: tosReport.verdict,
    });

    // Canonical flow (L2.0): generate → ToS scan → relay card → operator.
    // Enqueue in the SAME transaction as the bundle (L3.4 §1).
    await enqueueJob(tx, {
      orgId,
      queue: body.media ? 'content' : 'tos',
      kind: body.media ? 'media.generate' : 'tos.scan',
      payload: body.media
        ? { ...body.media, bundleId: bundle.id, userId }
        : { bundleId: bundle.id },
      dedupeParts: [body.media ? 'media.generate' : 'tos.scan', bundle.id],
    });

    return {
      status: 201 as const,
      data: { bundle, variants, tosReport, ...(body.media ? { mediaGeneration: 'queued' } : {}) },
    };
  });

  if (result.status === 404) return apiError(c, 404, statusTitle(404), 'model not found');
  if (result.status === 400) return apiError(c, 400, statusTitle(400), 'source image must belong to this model and organization');
  return c.json({ data: result.data }, 201);
});

export { router as generateRouter };
