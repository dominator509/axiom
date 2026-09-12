import { describe, expect, it, vi } from 'vitest';

vi.mock('@axiom/db', () => ({ schema: {} }));
vi.mock('../connection.js', () => ({ asPlatform: vi.fn(), connectorForTarget: vi.fn() }));
vi.mock('../enqueue.js', () => ({ enqueueJob: vi.fn() }));

import { METRICS_POLL_INTERVAL_MS, metricsPollDedupeParts, nextMetricsPollAt } from './metrics.js';

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
