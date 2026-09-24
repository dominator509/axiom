import { describe, expect, it, vi } from 'vitest';

vi.mock('@axiom/db', () => ({ schema: {} }));
vi.mock('../connection.js', () => ({ asPlatform: vi.fn(), connectorForTarget: vi.fn() }));
vi.mock('../enqueue.js', () => ({ enqueueJob: vi.fn() }));

import { METRICS_POLL_INTERVAL_MS, metricsPollDedupeParts, nextMetricsPollAt, normalizeEngagementMetrics } from './metrics.js';

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
  it('advances the loop by the bounded polling cadence', () => {
    const now = new Date('2026-09-09T20:00:00.000Z');
    expect(nextMetricsPollAt(now)).toEqual(new Date(now.getTime() + METRICS_POLL_INTERVAL_MS));
  });

  it('deduplicates one target within a cadence bucket', () => {
    const runAt = new Date('2026-09-09T20:15:00.000Z');
    expect(metricsPollDedupeParts('target-1', runAt)).toEqual([
      'metrics.poll',
      'target-1',
      String(Math.floor(runAt.getTime() / METRICS_POLL_INTERVAL_MS)),
    ]);
  });
});
