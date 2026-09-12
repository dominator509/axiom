// ─── content.generate executor (L3.4 §2, L2.5) ───
// Runs the Master Prompt Engine + optional LLM enrichment and persists a
// text-only content brief, then enqueues tos.scan. Media generation and asset
// storage are not part of this executor. This is the async/queue path of the
// same pipeline the API exposes synchronously at POST /models/:id/generate.

import { and, eq } from 'drizzle-orm';
import { schema } from '@axiom/db';
import {
  generatePhotoshootPrompts,
  buildS0,
  buildS1,
  buildS2,
  buildS3,
  assemblePrompt,
  LLMGateway,
  type ModelProfile as PromptModelProfile,
} from '@axiom/llm-gateway';
import type { Executor, ExecutorContext } from './context.js';
import { enqueueJob } from '../enqueue.js';
import { asPlatform } from '../connection.js';
import { retrieveTopExemplars } from '../viral-retrieval.js';

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
    revision?: { id: string; instructions: string; userId?: string };
  };
  let modelId = payload.modelId;
  let existingBundle: typeof schema.contentBundle.$inferSelect | undefined;

  // MCP requests allocate the bundle before queueing so callers can receive a
  // durable identifier immediately. Reuse that row instead of creating a
  // second bundle when the worker claims the job; this also makes retries
  // idempotent across the tool -> queue -> executor boundary.
  if (payload.bundleId) {
    const bundles = await tx
      .select()
      .from(schema.contentBundle)
      .where(
        and(
          eq(schema.contentBundle.id, payload.bundleId),
          eq(schema.contentBundle.orgId, job.org_id),
        ),
      )
      .limit(1)
      .for('update');
    if (bundles.length === 0) {
      throw new Error('content.generate: bundle ' + payload.bundleId + ' not found');
    }
    const bundle = bundles[0];
    if (!bundle) {
      throw new Error('content.generate: bundle lookup returned no row');
    }
    existingBundle = bundle;
    if (payload.revision) {
      const revision = payload.revision;
      if (
        typeof revision.id !== 'string' ||
        typeof revision.instructions !== 'string' ||
        !revision.instructions.trim() ||
        revision.instructions.length > 2000 ||
        (revision.userId !== undefined && typeof revision.userId !== 'string')
      ) {
        throw new Error('content.generate: invalid revision request');
      }
      if (bundle.state !== 'revising' || bundle.tosReport?.revisionId !== revision.id) {
        throw new Error(
          'content.generate: stale revision; bundle is no longer awaiting this request',
        );
      }
    } else if (bundle.state !== 'generated' || bundle.tosReport?.revisionId) {
      throw new Error('content.generate: existing bundle is no longer awaiting generation');
    }
    if (modelId && modelId !== bundle.modelId) {
      throw new Error('content.generate: bundle/model mismatch');
    }
    modelId ??= bundle.modelId;
  }

  if (!modelId) throw new Error('content.generate: payload.modelId required');
  if (payload.revision && !existingBundle)
    throw new Error('content.generate: revision requires a bundle');

  const models = await tx
    .select()
    .from(schema.modelProfile)
    .where(and(eq(schema.modelProfile.id, modelId), eq(schema.modelProfile.orgId, job.org_id)))
    .limit(1);
  if (models.length === 0) throw new Error(`content.generate: model ${modelId} not found`);
  const model = models[0];

  let platform: string;
  try {
    platform = asPlatform(payload.platform ?? 'instagram');
  } catch {
    throw new Error(`content.generate: unsupported target platform '${payload.platform}'`);
  }
  const profile: PromptModelProfile = {
    id: model.id,
    displayName: model.displayName,
    handle: model.handle,
    avatarUrl: model.avatarUrl ?? null,
    bio: model.bio ?? null,
  };

  if (payload.revision && existingBundle) {
    const currentCaptions = existingBundle.captions ?? {};
    const platforms = Object.keys(currentCaptions).map(asPlatform);
    if (platforms.length === 0)
      throw new Error('content.generate: revision has no target captions');
    const captions: Record<string, string> = {};
    const gateway = new LLMGateway();
    for (const target of platforms) {
      const original = currentCaptions[target];
      if (typeof original !== 'string') throw new Error('content.generate: invalid source caption');
      const exemplars = await retrieveTopExemplars(tx, job.org_id, modelId, target, 3);
      const prompt = assemblePrompt({
        S0: buildS0(profile),
        S1: buildS1(target),
        S2: buildS2(exemplars),
        S3: buildS3({
          modelId,
          platform: target,
          task: 'Revise the supplied caption according to the operator instructions. Return only the revised caption, without commentary. Preserve the depicted content; do not claim the media was changed.',
          context: JSON.stringify({
            caption: original,
            hashtags: existingBundle.hashtags,
            instructions: payload.revision.instructions,
          }),
        }),
      });
      // Unlike optional enrichment, a requested revision must not silently
      // fall back to unchanged text. Errors roll back and use normal job retry.
      const result = await gateway.chat(
        [
          { role: 'system', content: prompt },
          { role: 'user', content: payload.revision.instructions },
        ],
        { model: payload.model, userId: payload.revision.userId },
      );
      const caption = result.content.trim();
      if (!caption || caption.length > 32000)
        throw new Error('content.generate: invalid revised caption');
      captions[target] = caption;
    }
    if (platforms.every((target) => captions[target] === currentCaptions[target])) {
      throw new Error('content.generate: provider returned unchanged captions');
    }
    await tx
      .update(schema.contentBundle)
      .set({
        captions,
        tosReport: { verdict: 'pending', revisionId: payload.revision.id },
        state: 'generated',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.contentBundle.id, existingBundle.id),
          eq(schema.contentBundle.orgId, job.org_id),
        ),
      );
    await enqueueJob(tx, {
      orgId: job.org_id,
      queue: 'tos',
      kind: 'tos.scan',
      payload: { bundleId: existingBundle.id },
      dedupeParts: ['tos.scan', existingBundle.id, payload.revision.id],
    });
    return;
  }

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
      const exemplars = await retrieveTopExemplars(tx, job.org_id, modelId, platform, 3);
      const prompt = assemblePrompt({
        S0: buildS0(profile),
        S1: buildS1(platform as never),
        S2: buildS2(exemplars),
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
        and(eq(schema.contentBundle.id, bundleId), eq(schema.contentBundle.orgId, job.org_id)),
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
