import { describe, expect, it, vi } from 'vitest';

vi.mock('@axiom/db', () => ({ schema: {} }));

import { latestMetricSamples, scoreTargetEngagement } from './viral.js';

describe('latestMetricSamples', () => {
  it('keeps one newest-first snapshot per target for cumulative metrics', () => {
    const newest = { postTargetId: 'target-1', engagementRate: 0.02, collectedAt: new Date() };
    const older = {
      postTargetId: 'target-1',
      engagementRate: 0.01,
      collectedAt: new Date(Date.now() - 60_000),
    };
    const other = { postTargetId: 'target-2', engagementRate: 0.03, collectedAt: new Date() };

    expect(latestMetricSamples([newest, older, other])).toEqual([newest, other]);
  });
});

describe('scoreTargetEngagement', () => {
  it('scores the requested target rather than the newest unrelated sample', () => {
    const score = scoreTargetEngagement(
      [
        { postTargetId: 'other-target', engagementRate: 0.03 },
        { postTargetId: 'target-1', engagementRate: 0.01 },
      ],
      'target-1',
    );

    expect(score.own.postTargetId).toBe('target-1');
    expect(score.mean).toBe(0.02);
    expect(score.perfScore).toBe(-1);
  });

  it('rejects a window that does not contain the requested target', () => {
    expect(() =>
      scoreTargetEngagement([{ postTargetId: 'other-target', engagementRate: 0.03 }], 'target-1'),
    ).toThrow('no post_metric history for target target-1 in window');
  });
});
