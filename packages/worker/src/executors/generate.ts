// ─── content.generate executor (L3.4 §2, L2.5) ───
// Runs the Master Prompt Engine + optional LLM enrichment and persists a
// content_bundle, then enqueues tos.scan. This is the async/queue path of the
// same pipeline the API exposes synchronously at POST /models/:id/generate.

import { and, eq } from 'drizzle-orm';
import { schema } from '@axiom/db';
import {
  generatePhotoshootPrompts,
  buildS0,
  buildS1,
  buildS3,
  assemblePrompt,
  LLMGateway,
  type ModelProfile as PromptModelProfile,
} from '@axiom/llm-gateway';
import type { Executor, ExecutorContext } from './context.js';
import { enqueueJob } from '../enqueue.js';

export const contentGenerate: Executor = async (ctx: ExecutorContext) => {
  const { tx, job } = ctx;
  const payload = (job.payload ?? {}) as {
    bundleId?: string;
    modelId?: string;
    prompt?: string;
    count?: number;
    style?: string;
    outfit?: string;
    location?: string;
    mood?: string;
    lighting?: string;
    aspectRatio?: string;
    platform?: string;
    enrichWithLlm?: boolean;
    model?: string;
  };
  let modelId = payload.modelId;
  let existingBundle: { id: string; modelId: string } | undefined;

  // MCP requests allocate the bundle before queueing so callers can receive a
  // durable identifier immediately. Reuse that row instead of creating a
  // second bundle when the worker claims the job; this also makes retries
  // idempotent across the tool -> queue -> executor boundary.
  if (payload.bundleId) {
    const bundles = await tx
      .select({ id: schema.contentBundle.id, modelId: schema.contentBundle.modelId })
      .from(schema.contentBundle)
      .where(
        and(
          eq(schema.contentBundle.id, payload.bundleId),
          eq(schema.contentBundle.orgId, job.org_id),
        ),
      )
      .limit(1);
    if (bundles.length === 0) {
      throw new Error('content.generate: bundle ' + payload.bundleId + ' not found');
    }
    const bundle = bundles[0];
    if (!bundle) {
      throw new Error('content.generate: bundle lookup returned no row');
    }
    existingBundle = bundle;
    if (modelId && modelId !== bundle.modelId) {
      throw new Error('content.generate: bundle/model mismatch');
    }
    modelId ??= bundle.modelId;
  }

  if (!modelId) throw new Error('content.generate: payload.modelId required');

  const models = await tx
    .select()
    .from(schema.modelProfile)
    .where(eq(schema.modelProfile.id, modelId))
    .limit(1);
  if (models.length === 0) throw new Error(`content.generate: model ${modelId} not found`);
  const model = models[0];

  const platform = payload.platform ?? 'instagram';
  const profile: PromptModelProfile = {
    id: model.id,
    displayName: model.displayName,
    handle: model.handle,
    avatarUrl: model.avatarUrl ?? null,
    bio: model.bio ?? null,
  };

  const variants = generatePhotoshootPrompts({
    modelName: model.displayName,
    style: payload.style ?? 'studio',
    outfit: payload.outfit ?? 'summer dress',
    location: payload.location ?? 'studio',
    mood: payload.mood ?? 'energetic',
    lighting: payload.lighting ?? 'soft studio',
    aspectRatio: payload.aspectRatio ?? '4:5',
    platform: platform as never,
  });

  let caption = variants[0].caption;
  if (payload.enrichWithLlm) {
    try {
      const gateway = new LLMGateway();
      const prompt = assemblePrompt({
        S0: buildS0(profile),
        S1: buildS1(platform as never),
        S2: '',
        S3: buildS3({
          modelId,
          task: 'Write an engaging caption for the photoshoot, max 200 chars.',
          platform: platform as never,
          context: variants[0].caption,
        }),
      });
      const chat = await gateway.chat(
        [
          { role: 'system', content: prompt },
          { role: 'user', content: variants[0].prompt },
        ],
        { model: payload.model },
      );
      caption = chat.content.trim();
    } catch (err) {
      // Best-effort enrichment; prompt engine output still forms the bundle.
      console.error('content.generate enrich failed:', (err as Error).message);
    }
  }

  const bundleId =
    existingBundle?.id ??
    (
      await tx
        .insert(schema.contentBundle)
        .values({
          orgId: job.org_id,
          modelId,
          captions: { [platform]: caption },
          hashtags: variants[0].hashtags,
          tosReport: null,
          state: 'generated',
        })
        .returning({ id: schema.contentBundle.id })
    )[0]?.id;

  if (!bundleId) throw new Error('content.generate: bundle insert returned no id');

  if (existingBundle) {
    await tx
      .update(schema.contentBundle)
      .set({
        captions: { [platform]: caption },
        hashtags: variants[0].hashtags,
        tosReport: null,
        state: 'generated',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.contentBundle.id, bundleId),
          eq(schema.contentBundle.orgId, job.org_id),
        ),
      );
  }

  // Enqueue ToS scan for the bundle (canonical flow: generate → tos). The
  // bundle ID is the unit of work, so a retry cannot create duplicate scans.
  await enqueueJob(tx, {
    orgId: job.org_id,
    queue: 'tos',
    kind: 'tos.scan',
    payload: { bundleId },
    runAfter: new Date(),
    dedupeParts: ['tos.scan', bundleId],
  });
};
