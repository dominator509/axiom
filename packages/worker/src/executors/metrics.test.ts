import { describe, expect, it, vi } from 'vitest';

vi.mock('@axiom/db', () => ({ schema: {} }));
vi.mock('../connection.js', () => ({ asPlatform: vi.fn(), connectorForTarget: vi.fn() }));
vi.mock('../enqueue.js', () => ({ enqueueJob: vi.fn() }));

import { METRICS_PUBLISH_AGE_OFFSETS_MS, metricsPollDedupeParts, nextMetricsPollAt, normalizeEngagementMetrics } from './metrics.js';

describe('provider observation integrity', () => {
  it.each([{}, { likes: 4 }, { views: 30 }, { views: 0, likes: 1 }, { views: -1, likes: 0 },
    { views: 10, likes: NaN }, { views: Infinity, likes: 1 }, { views: 10, shares: 0.5 },
    { views: Number.MAX_SAFE_INTEGER + 1, likes: 1 }, { views: 1, likes: Number.MAX_SAFE_INTEGER, comments: 1 },
  ])('rejects missing or invalid counters %j', metrics => {
    expect(() => normalizeEngagementMetrics(metrics)).toThrow('metrics.poll:');
  });
  it('retains observed zero, rather than confusing it with absent data', () => {
    expect(normalizeEngagementMetrics({ views: 0, likes: 0 })).toEqual({ impressions: 0, likes: 0, comments: 0, shares: 0, engagementRate: 0 });
  });
  it('normalizes provider aliases without counting them twice', () => {
    expect(normalizeEngagementMetrics({ impressions: 100, views: 90, likes: 2, comments: 1, shares: 3, reposts: 3, saves: 4 }))
      .toEqual({ impressions: 100, likes: 2, comments: 1, shares: 3, engagementRate: 0.1 });
  });
});

describe('metrics poll scheduling', () => {
  it('captures the 1h, 6h, 24h and 7d windows before decaying to sparse snapshots', () => {
    const publishedAt = new Date('2026-09-09T20:00:00.000Z');
    expect(nextMetricsPollAt(publishedAt, publishedAt)).toEqual(new Date(publishedAt.getTime() + 60 * 60_000));
    expect(nextMetricsPollAt(publishedAt, new Date(publishedAt.getTime() + 60 * 60_000)))
      .toEqual(new Date(publishedAt.getTime() + 6 * 60 * 60_000));
    expect(nextMetricsPollAt(publishedAt, new Date(publishedAt.getTime() + 6 * 60 * 60_000)))
      .toEqual(new Date(publishedAt.getTime() + 24 * 60 * 60_000));
    expect(nextMetricsPollAt(publishedAt, new Date(publishedAt.getTime() + 24 * 60 * 60_000)))
      .toEqual(new Date(publishedAt.getTime() + 7 * 24 * 60 * 60_000));
    expect(METRICS_PUBLISH_AGE_OFFSETS_MS).toHaveLength(8);
    expect(nextMetricsPollAt(publishedAt, new Date(publishedAt.getTime() + 90 * 24 * 60 * 60_000))).toBeNull();
  });

  it('deduplicates the exact target and scheduled window while keeping separate windows distinct', () => {
    const runAt = new Date('2026-09-09T21:00:00.000Z');
    expect(metricsPollDedupeParts('target-1', runAt)).toEqual([
      'metrics.poll',
      'target-1',
      runAt.toISOString(),
    ]);
    expect(metricsPollDedupeParts('target-1', new Date('2026-09-10T02:00:00.000Z')))
      .not.toEqual(metricsPollDedupeParts('target-1', runAt));
  });
});
