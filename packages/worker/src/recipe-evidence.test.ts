import { describe, expect, it } from 'vitest';
import { recipeEvidence } from './recipe-evidence.js';

describe('publication recipe evidence', () => {
  it('retains dispatched hook, ToS and distinct scheduled/actual UTC timing', () => {
    const report = { verdict: 'pass', score: 0.1 };
    const result = recipeEvidence({
      caption: 'A first line?\r\nRemaining caption',
      scheduledFor: '2026-09-13T21:00:00Z', tosReport: report,
      media: { kind: 'video', mimeType: 'video/mp4', width: 1080, height: 1920, duration: 6 },
    }, new Date('2026-09-14T00:15:00Z'));
    expect(result).toMatchObject({ hook: 'A first line?', hook_source: 'caption-first-line',
      scheduled_for: '2026-09-13T21:00:00Z', published_at: '2026-09-14T00:15:00.000Z',
      published_weekday_utc: 1, published_hour_utc: 0, tos_report_at_publication: report,
      media: { kind: 'video', mimeType: 'video/mp4', width: 1080, height: 1920, duration: 6 } });
  });

  it('does not fabricate historical ToS or publication times', () => {
    const snapshot = { caption: '', scheduledFor: null };
    for (const date of [null, new Date('invalid')]) {
      expect(recipeEvidence(snapshot, date)).toMatchObject({ hook: '',
        published_at: null, published_weekday_utc: null, published_hour_utc: null,
        tos_report_at_publication: null });
    }
  });
});
