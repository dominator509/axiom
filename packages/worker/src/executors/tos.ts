// ─── tos.scan executor (L3.4 §2, L2.10) ───
// Local ToS evaluation of a bundle per platform. Text-only bundles use the
// deterministic rules; image bundles invoke the Rust-backed vision engine.
// Writes the tos_report verdict so Relay carries pass/review/block
// (L3.3 §1, LBI-11).

import { and, eq } from 'drizzle-orm';
import { schema } from '@axiom/db';
import {
  evaluateTextToS,
  PLATFORM_RULES,
  ToSEngine,
  type EvaluationResult,
} from '@axiom/fanvue-mcp';
import type { Platform } from '@axiom/core';
import type { Executor, ExecutorContext } from './context.js';
import { enqueueJob } from '../enqueue.js';

type ToSAsset = {
  kind: string;
  storageKey: string;
};

function asToSPlatforms(platforms: string[]): Platform[] {
  return platforms.map((platform) => {
    if (!Object.prototype.hasOwnProperty.call(PLATFORM_RULES, platform)) {
      throw new Error(`tos.scan: unsupported target platform '${platform}'`);
    }
    return platform as Platform;
  });
}

/**
 * Run the mandatory local visual ToS check for a persisted image asset.
 *
 * The vision engine reads the asset's storage key from the media-plane
 * filesystem. Video frame extraction is intentionally not implied here: until
 * the repository has a real frame-extraction contract, media that cannot be
 * visually classified must fail closed instead of reaching Relay.
 */
export async function evaluateMediaToS(
  asset: ToSAsset,
  caption: string,
  hashtags: string[],
  platforms: string[],
): Promise<EvaluationResult> {
  if (asset.kind !== 'image') {
    throw new Error(
      `tos.scan: visual ToS classification is unavailable for ${asset.kind} assets; refusing to continue`,
    );
  }
  const storageKey = asset.storageKey.trim();
  if (!storageKey) throw new Error('tos.scan: media asset has no storage key');

  const engine = new ToSEngine();
  return engine.evaluate({ imageData: storageKey, caption, hashtags }, asToSPlatforms(platforms));
}

export const tosScan: Executor = async (ctx: ExecutorContext) => {
  const { tx } = ctx;
  const payload = (ctx.job.payload ?? {}) as { bundleId?: string };
  const bundleId = payload.bundleId;
  if (!bundleId) throw new Error('tos.scan: payload.bundleId required');

  const bundles = await tx
    .select()
    .from(schema.contentBundle)
    .where(
      and(eq(schema.contentBundle.id, bundleId), eq(schema.contentBundle.orgId, ctx.job.org_id)),
    )
    .limit(1);
  if (bundles.length === 0) throw new Error(`tos.scan: bundle ${bundleId} not found`);
  const bundle = bundles[0];

  const captions = (bundle.captions as Record<string, string> | null) ?? {};
  const hashtags = (bundle.hashtags as string[] | null) ?? [];
  const platforms = Object.keys(captions).length > 0 ? Object.keys(captions) : ['instagram'];
  let report: EvaluationResult | ReturnType<typeof evaluateTextToS>;
  if (bundle.assetId) {
    const assets = await tx
      .select({ kind: schema.asset.kind, storageKey: schema.asset.storageKey })
      .from(schema.asset)
      .where(
        and(
          eq(schema.asset.id, bundle.assetId),
          eq(schema.asset.orgId, ctx.job.org_id),
          eq(schema.asset.modelId, bundle.modelId),
        ),
      )
      .limit(1);
    const asset = assets[0];
    if (!asset) {
      throw new Error(
        `tos.scan: asset ${bundle.assetId} not found or not owned by model ${bundle.modelId}`,
      );
    }
    report = await evaluateMediaToS(asset, captions[platforms[0]] ?? '', hashtags, platforms);
  } else {
    report = evaluateTextToS(captions[platforms[0]] ?? '', hashtags, asToSPlatforms(platforms));
  }

  await tx
    .update(schema.contentBundle)
    .set({ tosReport: report, updatedAt: new Date() })
    .where(
      and(eq(schema.contentBundle.id, bundleId), eq(schema.contentBundle.orgId, ctx.job.org_id)),
    );

  // A pass/review verdict flows to the relay card (produced by relay.card).
  await enqueueJob(tx, {
    orgId: ctx.job.org_id,
    queue: 'relay',
    kind: 'relay.card',
    payload: { bundleId },
    runAfter: new Date(),
    maxAttempts: ctx.job.max_attempts,
    // A revised bundle has a new ToS job and therefore gets a new relay card;
    // retrying this exact scan reuses its handoff key.
    dedupeParts: ['relay.card', bundleId, ctx.job.id],
  });
};
