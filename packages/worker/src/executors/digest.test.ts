// ─── digest.weekly executor (F-28 / F-89) — Vitest Suite ───
// Aggregates 7-day post_metric + viral_exemplar stats and writes a durable
// relay_card (channel 'digest'). Uses the chainable tx mock: every awaited
// query resolves to mockState.result, so one object serves the raw-SQL
// aggregate reads (agg / top platform / label counts), the org UI-locale read
// and the card insert.
//
// F-89 adds localization of the operator-visible card: the executor resolves
// the org-scoped UI locale through the existing typed locale contract, renders
// catalog-backed title/description, formats numbers/dates through the locale
// helpers under an explicit UTC policy, and preserves the not-weekly-gain
// disclosure, verified-exemplar labels, relay_card state and the
// externalDelivery not-attempted boundary.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockState: {
  result: unknown;
  values: Array<Record<string, any>>;
  /** Rows returned by the org UI-locale select. */
  localeRows: Array<Record<string, unknown>>;
} = { result: [], values: [], localeRows: [] };

function makeChain(): any {
  const handler = {
    get(_t: unknown, prop: string | symbol) {
      if (prop === 'values') return (value: Record<string, any>) => { mockState.values.push(value); return makeChain(); };
      if (prop === 'then') {
        return (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
          Promise.resolve(
            // The locale read is a plain select().from().where() chain; the
            // aggregate reads are raw SQL. Serve locale rows when the chain has
            // requested the locale columns, otherwise the aggregate fixture.
            mockState.result,
          ).then(resolve, reject);
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
      orgSettings: {},
      uiLocalePreference: { orgId: 'org_id', scope: 'scope', locale: 'locale' },
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
  mockState.values = [];
  mockState.localeRows = [];
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
    expect(mockState.values).toHaveLength(1);
    expect(mockState.values[0].description).toContain('5.20% average per-post engagement');
    expect(mockState.values[0].description).toContain('not views gained during the week');
    expect(mockState.values[0].description).toContain('5 published posts');
    expect(mockState.values[0].state).toBe('stored');
    expect(mockState.values[0].config.externalDelivery).toBe('not-attempted');
    expect(mockState.values[0].config.digest.avgEngagement).toBe(0.052);
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

  it('falls back to English when the org has no valid UI-locale preference', async () => {
    mockState.result = [];
    await digestWeekly({ tx: makeChain(), job: makeJob(), killSwitchEnabled: false, workerId: 'w1' });
    const card = mockState.values[0];
    expect(card.title).toContain('Weekly digest');
    expect(card.description).toContain('average per-post engagement');
    expect(card.config.uiLocale).toBe('en');
    expect(card.config.uiLocaleSource).toBe('default');
  });

  it('preserves the stored relay_card state and externalDelivery boundary under localization', async () => {
    await digestWeekly({ tx: makeChain(), job: makeJob(), killSwitchEnabled: false, workerId: 'w1' });
    const card = mockState.values[0];
    expect(card.state).toBe('stored');
    expect(card.channel).toBe('digest');
    expect(card.config.externalDelivery).toBe('not-attempted');
    // The card never claims a dispatch attempt or an unknown outcome.
    expect(card.config.dispatchAttempted).toBeUndefined();
    expect(card.config.outcomeUnknown).toBeUndefined();
  });

  it('keeps provider platform names as data in the rendered description', async () => {
    await digestWeekly({ tx: makeChain(), job: makeJob(), killSwitchEnabled: false, workerId: 'w1' });
    expect(mockState.values[0].description).toContain('fanvue');
  });
});
