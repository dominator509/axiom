import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { reviewedVideoReport, videoReviewRequest } from './video-review.js';

export function reviewFixture() {
  const scanId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const hash = '01'.repeat(32);
  const bundle = { id: '33333333-3333-4333-8333-333333333333', assetId: 'asset-1',
    captions: { instagram: 'Safe' }, hashtags: [] as string[] };
  const digest = createHash('sha256').update(JSON.stringify({ bundleId: bundle.id, assetId: bundle.assetId,
    assetSha256: hash, captions: Object.entries(bundle.captions), hashtags: bundle.hashtags })).digest('hex');
  const score = { platform: 'instagram', score: 0, threshold: 20, verdict: 'review', reasons: ['Full video review required'] };
  return { hash, input: { scanId, platforms: ['instagram'], fullVideoAndAudioReviewed: true as const, reason: 'Reviewed the full clip and caption' },
    bundle: { ...bundle, tosReport: { verdict: 'review', scores: [score], videoScan: {
      policy: 'sampled-2fps-v1', assetSha256: hash, durationSeconds: 6, frameCount: 12, scanId,
      contentDigest: digest, automatedScores: [{ ...score, verdict: 'pass', reasons: [] as string[] }],
    } } } };
}

describe('explicit video compliance review', () => {
  it('preserves machine evidence and records per-platform human provenance', () => {
    const { bundle, hash, input } = reviewFixture();
    const original = structuredClone(bundle.tosReport);
    const result = reviewedVideoReport(bundle, hash, input, 'operator-1', new Date('2026-09-11T00:00:00Z'));
    expect(result.verdict).toBe('pass');
    expect(result.decisionSource).toBe('human-review');
    expect(result.videoScan).toEqual(original.videoScan);
    expect(result.humanReview).toMatchObject({ actorId: 'operator-1', platforms: ['instagram'], scanId: input.scanId,
      fullVideoAndAudioReviewed: true, reason: input.reason });
    expect(bundle.tosReport).toEqual(original);
  });
  it.each(['global-block', 'score-block', 'machine-block', 'duplicate-score', 'missing-score', 'bad-score',
    'scan-changed', 'caption-changed', 'asset-changed', 'incomplete-coverage', 'missing-platform', 'duplicate-platform'])(
    'rejects %s', failure => {
      const { bundle, hash, input } = reviewFixture();
      if (failure === 'global-block') bundle.tosReport.verdict = 'block';
      if (failure === 'score-block') bundle.tosReport.scores[0].verdict = 'block';
      if (failure === 'machine-block') bundle.tosReport.videoScan.automatedScores[0].verdict = 'block';
      if (failure === 'duplicate-score') bundle.tosReport.scores.push(bundle.tosReport.scores[0]);
      if (failure === 'missing-score') bundle.tosReport.videoScan.automatedScores = [];
      if (failure === 'bad-score') bundle.tosReport.videoScan.automatedScores[0].score = NaN;
      if (failure === 'scan-changed') input.scanId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
      if (failure === 'caption-changed') bundle.captions.instagram = 'Different content';
      if (failure === 'asset-changed') bundle.assetId = 'asset-2';
      if (failure === 'incomplete-coverage') bundle.tosReport.videoScan.frameCount = 1;
      if (failure === 'missing-platform') input.platforms = [];
      if (failure === 'duplicate-platform') input.platforms.push('instagram');
      expect(() => reviewedVideoReport(bundle, hash, input, 'operator-1', new Date())).toThrow();
    });
  it('does not accept client-provided scores, absent attestation, or an empty rationale', () => {
    const { input } = reviewFixture();
    for (const patch of [{ scores: [] }, { fullVideoAndAudioReviewed: false }, { reason: ' ' }])
      expect(videoReviewRequest.safeParse({ ...input, ...patch }).success).toBe(false);
  });
});
