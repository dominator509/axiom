// ─── tos.scan executor (L3.4 §2, L2.10) ───
// Local ToS evaluation of a bundle per platform. Text-only bundles use the
// deterministic rules; image bundles invoke the Rust-backed vision engine.
// Writes the tos_report verdict so Relay carries pass/review/block
// (L3.3 §1, LBI-11).

import { and, eq } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { schema } from '@axiom/db';
import {
  evaluateTextToS,
  PLATFORM_RULES,
  ToSEngine,
  type EvaluationResult,
} from '@axiom/fanvue-mcp';
import { readBoundedResponseJson, type Platform } from '@axiom/core';
import type { Executor, ExecutorContext } from './context.js';
import { enqueueJob } from '../enqueue.js';

type ToSAsset = {
  kind: string;
  storageKey: string;
  sha256?: Buffer;
};

type MediaEvaluation = EvaluationResult & {
  videoCoverage?: {
    policy: 'sampled-2fps-v1';
    assetSha256: string;
    durationSeconds: number;
    frameCount: number;
    automatedScores: EvaluationResult['scores'];
  };
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
 * Images are classified directly. Short MP4 clips use the media plane's
 * versioned 2fps sampler, then classify every returned frame. Sampling cannot
 * prove all-frame or audio safety, so videos require explicit human review.
 */
export async function evaluateMediaToS(
  asset: ToSAsset,
  caption: string,
  hashtags: string[],
  platforms: string[],
): Promise<MediaEvaluation> {
  if (!['image', 'video'].includes(asset.kind)) {
    throw new Error(
      `tos.scan: visual ToS classification is unavailable for ${asset.kind} assets; refusing to continue`,
    );
  }
  const storageKey = asset.storageKey.trim();
  if (!storageKey) throw new Error('tos.scan: media asset has no storage key');

  const engine = new ToSEngine();
  if (asset.kind === 'video') {
    if (!Buffer.isBuffer(asset.sha256) || asset.sha256.length !== 32)
      throw new Error('tos.scan: video content hash required');
    const token = process.env.MEDIA_PLANE_AUTH_TOKEN?.trim();
    const response = await fetch(`${process.env.MEDIA_PLANE_URL ?? 'http://127.0.0.1:8100'}/media/video/frames`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ video_path: storageKey }), signal: AbortSignal.timeout(75_000),
      redirect: 'error',
    });
    if (!response.ok) throw new Error(`tos.scan: video extraction failed (${response.status})`);
    const manifest = await readBoundedResponseJson<{
      policy?: unknown; source_sha256?: unknown; duration_seconds?: unknown; frames?: unknown;
    }>(response);
    const hash = asset.sha256.toString('hex');
    if (manifest.policy !== 'sampled-2fps-v1' || manifest.source_sha256 !== hash
      || typeof manifest.duration_seconds !== 'number' || !Number.isFinite(manifest.duration_seconds)
      || manifest.duration_seconds <= 0 || manifest.duration_seconds > 12
      || !Array.isArray(manifest.frames) || manifest.frames.length < 1 || manifest.frames.length > 25
      || Math.abs(manifest.frames.length - Math.ceil(manifest.duration_seconds * 2)) > 1
      || new Set(manifest.frames).size !== manifest.frames.length
      || manifest.frames.some((frame, index) => frame !== `tos-video-v1/${hash}/frame-${String(index + 1).padStart(3, '0')}.png`))
      throw new Error('tos.scan: invalid video frame coverage or content identity');
    const targets = asToSPlatforms(platforms);
    const reports: EvaluationResult[] = [];
    for (const frame of manifest.frames as string[]) {
      reports.push(await engine.evaluate({ imageData: frame, caption, hashtags }, targets));
    }
    const coverage = `Video sampled at 2fps (${manifest.frames.length} frames, ${manifest.duration_seconds}s); human review of the full video and audio required`;
    const rank = { pass: 0, review: 1, block: 2 } as const;
    const automatedScores = targets.map(platform => {
      const frames = reports.map(report => report.scores.find(score => score.platform === platform));
      if (frames.some(score => !score)) throw new Error('tos.scan: incomplete video classification');
      const present = frames.filter((score): score is NonNullable<typeof score> => !!score);
      const worst = present.reduce((a, b) => rank[b.verdict] > rank[a.verdict] ? b : a);
      return { ...worst, score: Math.max(...present.map(score => score.score)),
        reasons: [...new Set(present.flatMap(score => score.reasons))] };
    });
    const scores = automatedScores.map(score => ({ ...score,
      verdict: score.verdict === 'block' ? 'block' as const : 'review' as const,
      reasons: [...score.reasons, coverage],
    }));
    return { verdict: reports.some(report => report.verdict === 'block') ? 'block' : 'review', scores,
      videoCoverage: { policy: 'sampled-2fps-v1', assetSha256: hash,
        durationSeconds: manifest.duration_seconds, frameCount: manifest.frames.length, automatedScores },
      reasons: [...new Set([...reports.flatMap(report => report.reasons), coverage])] };
  }
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
    .limit(1)
    .for('update');
  if (bundles.length === 0) throw new Error(`tos.scan: bundle ${bundleId} not found`);
  const bundle = bundles[0];
  if (bundle.state === 'revising') {
    throw new Error(
      'tos.scan: caption revision is still pending; refusing to scan superseded content',
    );
  }

  const captions = (bundle.captions as Record<string, string> | null) ?? {};
  const hashtags = (bundle.hashtags as string[] | null) ?? [];
  const platforms = asToSPlatforms(Object.keys(captions));
  if (platforms.length === 0) throw new Error('tos.scan: bundle has no target captions');
  // Each destination must be checked against the caption it will publish.
  // Group identical captions to avoid repeated visual inference when platforms
  // share content, without applying the first caption to unrelated targets.
  const captionGroups = new Map<string, Platform[]>();
  for (const platform of platforms) {
    const caption = captions[platform];
    if (typeof caption !== 'string') {
      throw new Error(`tos.scan: invalid caption for '${platform}'`);
    }
    const group = captionGroups.get(caption) ?? [];
    group.push(platform);
    captionGroups.set(caption, group);
  }
  let asset: ToSAsset | undefined;
  if (bundle.assetId) {
    const assets = await tx
      .select({ kind: schema.asset.kind, storageKey: schema.asset.storageKey, sha256: schema.asset.sha256 })
      .from(schema.asset)
      .where(
        and(
          eq(schema.asset.id, bundle.assetId),
          eq(schema.asset.orgId, ctx.job.org_id),
          eq(schema.asset.modelId, bundle.modelId),
        ),
      )
      .limit(1);
    asset = assets[0];
    if (!asset) {
      throw new Error(
        `tos.scan: asset ${bundle.assetId} not found or not owned by model ${bundle.modelId}`,
      );
    }
  }

  const reports: MediaEvaluation[] = [];
  for (const [caption, targets] of captionGroups) {
    reports.push(
      asset
        ? await evaluateMediaToS(asset, caption, hashtags, targets)
        : evaluateTextToS(caption, hashtags, targets),
    );
  }
  const scores = reports.flatMap((result) => result.scores);
  const report: EvaluationResult = {
    verdict: reports.some((result) => result.verdict === 'block')
      ? 'block'
      : reports.some((result) => result.verdict === 'review')
        ? 'review'
        : 'pass',
    scores,
    reasons: [...new Set(reports.flatMap((result) => result.reasons))],
  };

  // Preserve machine evidence separately from the mandatory human-review
  // verdict. A future review must bind to this exact scan and content snapshot,
  // not to a browser-supplied score or a previous revision's approval.
  const coverage = reports[0]?.videoCoverage;
  if (asset?.kind === 'video' && (!coverage || reports.some(result =>
    !result.videoCoverage || result.videoCoverage.assetSha256 !== coverage.assetSha256
    || result.videoCoverage.frameCount !== coverage.frameCount
    || result.videoCoverage.durationSeconds !== coverage.durationSeconds)))
    throw new Error('tos.scan: inconsistent video evidence across captions');
  const videoScan = coverage ? {
    ...coverage,
    automatedScores: reports.flatMap(result => result.videoCoverage!.automatedScores),
    scanId: randomUUID(),
    contentDigest: createHash('sha256').update(JSON.stringify({
      bundleId, assetId: bundle.assetId, assetSha256: coverage.assetSha256,
      captions: Object.entries(captions).sort(([a], [b]) => a.localeCompare(b)), hashtags,
    })).digest('hex'),
  } : undefined;

  await tx
    .update(schema.contentBundle)
    .set({
      tosReport: {
        ...report,
        ...(videoScan ? { videoScan } : {}),
        ...(bundle.tosReport?.sanitization && typeof bundle.tosReport.sanitization === 'object'
          && 'assetId' in bundle.tosReport.sanitization && bundle.tosReport.sanitization.assetId === bundle.assetId
          ? { sanitization: bundle.tosReport.sanitization } : {}),
        ...(typeof bundle.tosReport?.revisionId === 'string'
          ? { revisionId: bundle.tosReport.revisionId }
          : {}),
      },
      updatedAt: new Date(),
    })
    .where(
      and(eq(schema.contentBundle.id, bundleId), eq(schema.contentBundle.orgId, ctx.job.org_id)),
    );

  // A pass/review verdict flows to the relay card (produced by relay.card).
  await enqueueJob(tx, {
    orgId: ctx.job.org_id,
    queue: 'relay',
    kind: 'relay.card',
    payload: {
      bundleId,
      revisionId: typeof bundle.tosReport?.revisionId === 'string' ? bundle.tosReport.revisionId : null,
    },
    runAfter: new Date(),
    maxAttempts: ctx.job.max_attempts,
    // A revised bundle has a new ToS job and therefore gets a new relay card;
    // retrying this exact scan reuses its handoff key.
    dedupeParts: ['relay.card', bundleId, ctx.job.id],
  });
};
