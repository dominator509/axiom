import { createHash } from 'node:crypto';
import { z } from 'zod';

export const videoReviewRequest = z.object({
  scanId: z.string().uuid(),
  platforms: z.array(z.string().min(1)).min(1).max(11),
  fullVideoAndAudioReviewed: z.literal(true),
  reason: z.string().trim().min(10).max(1000),
}).strict();

const score = z.object({
  platform: z.string().min(1), score: z.number().finite().min(0).max(100),
  threshold: z.number().finite().min(0).max(100),
  verdict: z.enum(['pass', 'review']), reasons: z.array(z.string()),
}).passthrough();
const reportSchema = z.object({
  verdict: z.literal('review'), scores: z.array(score).min(1),
  videoScan: z.object({
    policy: z.literal('sampled-2fps-v1'), assetSha256: z.string().regex(/^[0-9a-f]{64}$/),
    durationSeconds: z.number().finite().positive().max(12), frameCount: z.number().int().min(1).max(25),
    automatedScores: z.array(score).min(1), scanId: z.string().uuid(),
    contentDigest: z.string().regex(/^[0-9a-f]{64}$/),
  }).passthrough(),
}).passthrough();

/** Only called with locked, tenant-authorized DB data and a completed scan.
 * Keeps machine evidence intact; the resulting pass is explicitly human-sourced.
 */
export function reviewedVideoReport(bundle: {
  id: string; assetId: string; captions: Record<string, string>; hashtags: string[]; tosReport: unknown;
}, assetSha256: string, input: z.infer<typeof videoReviewRequest>, actorId: string, now: Date) {
  const parsed = reportSchema.safeParse(bundle.tosReport);
  if (!parsed.success) throw new Error('A complete non-blocked video scan is required');
  const report = parsed.data;
  const scan = report.videoScan;
  const platforms = Object.keys(bundle.captions).sort();
  const samePlatforms = (values: string[]) => values.length === platforms.length
    && new Set(values).size === values.length
    && [...values].sort().every((value, i) => value === platforms[i]);
  if (!samePlatforms(input.platforms) || !samePlatforms(report.scores.map(s => s.platform))
    || !samePlatforms(scan.automatedScores.map(s => s.platform)))
    throw new Error('Review every destination on this exact bundle');
  const digest = createHash('sha256').update(JSON.stringify({
    bundleId: bundle.id, assetId: bundle.assetId, assetSha256,
    captions: Object.entries(bundle.captions).sort(([a], [b]) => a.localeCompare(b)), hashtags: bundle.hashtags,
  })).digest('hex');
  if (scan.scanId !== input.scanId || scan.assetSha256 !== assetSha256 || scan.contentDigest !== digest
    || Math.abs(scan.frameCount - Math.ceil(scan.durationSeconds * 2)) > 1)
    throw new Error('Video or scan changed; refresh and review the current content');
  return {
    ...report,
    verdict: 'pass' as const,
    decisionSource: 'human-review' as const,
    scores: report.scores.map(s => ({ ...s, verdict: 'pass' as const, decisionSource: 'human-review' as const })),
    humanReview: {
      actorId, reviewedAt: now.toISOString(), scanId: scan.scanId, contentDigest: digest,
      assetSha256, platforms, fullVideoAndAudioReviewed: true, reason: input.reason,
    },
  };
}
