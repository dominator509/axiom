// ─── digest.weekly executor (F-28) — Vitest Suite ───
// Aggregates 7-day post_metric + viral_exemplar stats and writes a durable
// relay_card (channel 'digest'). Uses the chainable tx mock: every awaited
// query resolves to mockState.result, so one object serves the three raw-SQL
// aggregate reads (agg / top platform / label counts) and the card insert.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockState: { result: unknown } = { result: [] };

function makeChain(): any {
  const handler = {
    get(_t: unknown, prop: string | symbol) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
          Promise.resolve(mockState.result).then(resolve, reject);
        };
      }
      return () => makeChain();
    },
    apply() {
      return makeChain();
    },
  };
  return new Proxy(function () {}, handler);
}

vi.mock('@axiom/db', () => {
  const schemaProxy = new Proxy<Record<string, unknown>>(
    {
      relayCard: {},
      postMetric: {},
      postTarget: {},
      contentBundle: {},
      viralExemplar: {},
      modelProfile: {},
    },
    {
      get(target, prop) {
        if (prop in target) return target[prop as string];
        return {};
      },
    },
  );
  return {
    db: {
      transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(makeChain())),
    },
    schema: schemaProxy,
  };
});

import { digestWeekly } from './digest.js';
import type { JobRow } from '../types.js';

const ORG_ID = '00000000-0000-0000-0000-000000000000';

function makeJob(overrides: Partial<JobRow> = {}): JobRow {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    org_id: ORG_ID,
    queue: 'digest',
    kind: 'digest.weekly',
    payload: { week: '2026-08-03' },
    state: 'ready',
    attempts: 0,
    max_attempts: 3,
    last_error: null,
    run_after: new Date(),
    locked_by: null,
    locked_at: null,
    dedupe_key: null,
    scheduled_for: null,
    started_at: null,
    completed_at: null,
    created_at: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  mockState.result = [
    {
      posts: 5,
      views: 1200,
      likes: 180,
      shares: 40,
      comments: 22,
      avg_engagement: 0.052,
      platform: 'fanvue',
      viral: 1,
      strong: 2,
    },
  ];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('digestWeekly executor', () => {
  it('computes digest aggregates and inserts a relay_card', async () => {
    await expect(
      digestWeekly({ tx: makeChain(), job: makeJob(), killSwitchEnabled: false, workerId: 'w1' }),
    ).resolves.toBeUndefined();
  });

  it('handles an org with zero metrics (all aggregates coalesced)', async () => {
    mockState.result = [
      {
        posts: 0,
        views: 0,
        likes: 0,
        shares: 0,
        comments: 0,
        avg_engagement: 0,
        platform: null,
        viral: 0,
        strong: 0,
      },
    ];
    await expect(
      digestWeekly({ tx: makeChain(), job: makeJob(), killSwitchEnabled: false, workerId: 'w1' }),
    ).resolves.toBeUndefined();
  });
});
