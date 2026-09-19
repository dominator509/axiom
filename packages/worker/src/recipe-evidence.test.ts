import { describe, expect, it } from 'vitest';
import { recipeEvidence } from './recipe-evidence.js';

describe('publication recipe evidence', () => {
  it('retains dispatched hook, ToS and distinct scheduled/actual UTC timing', () => {
    const report = { verdict: 'pass', score: 0.1 };
    const result = recipeEvidence({
      caption: 'A first line?\r\nRemaining caption',
      assetId: 'asset-1',
      scheduledFor: '2026-09-13T21:00:00Z', tosReport: report,
      media: { kind: 'video', mimeType: 'video/mp4', width: 1080, height: 1920, duration: 6 },
      shootConfig: { style: 'editorial', outfit: 'summer dress', location: 'Miami Beach', mood: 'energetic', lighting: 'golden hour', aspectRatio: '4:5' },
    }, new Date('2026-09-14T00:15:00Z'));
    expect(result).toMatchObject({ hook: 'A first line?', hook_source: 'caption-first-line',
      scheduled_for: '2026-09-13T21:00:00Z', published_at: '2026-09-14T00:15:00.000Z',
      published_weekday_utc: 1, published_hour_utc: 0, tos_report_at_publication: report,
      media: { kind: 'video', mimeType: 'video/mp4', width: 1080, height: 1920, duration: 6 },
      shoot_config: { style: 'editorial', outfit: 'summer dress', location: 'Miami Beach', mood: 'energetic', lighting: 'golden hour', aspectRatio: '4:5' } });
  });

  it('does not fabricate historical ToS or publication times', () => {
    const snapshot = { caption: '', scheduledFor: null };
    for (const date of [null, new Date('invalid')]) {
      expect(recipeEvidence({ ...snapshot, assetId: null }, date)).toMatchObject({ hook: '',
        published_at: null, published_weekday_utc: null, published_hour_utc: null,
        tos_report_at_publication: null, shoot_config: null, thumbnail_features: null });
    }
  });

  it('keeps only a trusted descriptor bound to the published asset', () => {
    const features = {
      version: 'vision-analysis-v1', source: 'rust_engine', assetId: 'asset-1',
      assetSha256: 'a'.repeat(64), confidence: 0.91,
      dimensions: { width: 864, height: 1152 }, avgBrightness: 120,
      colorVariance: 22, aspectRatio: 0.75,
    } as const;
    const evidence = recipeEvidence({
      caption: '', assetId: 'asset-1', scheduledFor: null, thumbnailFeatures: features,
    }, null);
    expect(evidence.thumbnail_features).toEqual(features);
    expect(recipeEvidence({
      caption: '', assetId: 'other-asset', scheduledFor: null, thumbnailFeatures: features,
    }, null).thumbnail_features).toBeNull();
  });

  it('does not carry fallback, override or malformed descriptors into recipe evidence', () => {
    for (const value of [
      { version: 'vision-analysis-v1', source: 'local_fallback' },
      { version: 'vision-analysis-v1', source: 'rust_engine', assetId: 'asset-1', assetSha256: 'not-a-hash' },
      { version: 'vision-analysis-v1', source: 'rust_engine', assetId: 'asset-1', assetSha256: 'b'.repeat(64), confidence: 2 },
    ]) {
      expect(recipeEvidence({ caption: '', assetId: 'asset-1', scheduledFor: null, thumbnailFeatures: value }, null)
        .thumbnail_features).toBeNull();
    }
  });
});
