import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  results: [] as unknown[],
  values: [] as Array<Record<string, unknown>>,
}));

function chain(): any {
  const handler = {
    get(_target: unknown, prop: string | symbol) {
      if (prop === 'then') {
        return (resolve: (value: unknown) => void) => resolve(state.results.shift() ?? []);
      }
      if (prop === 'values') return (value: Record<string, unknown>) => { state.values.push(value); return chain(); };
      if (prop === 'onConflictDoNothing') return () => chain();
      return () => chain();
    },
    apply() { return chain(); },
  };
  return new Proxy(function () {}, handler);
}

vi.mock('@axiom/db', () => ({
  schema: {
    uiLocalePreference: { orgId: 'org_id', scope: 'scope', locale: 'locale' },
    relayCard: {},
    job: { orgId: 'org_id', dedupeKey: 'dedupe_key', id: 'id' },
  },
}));

import { viralInsight } from './viral_insight.js';
import type { JobRow } from '../types.js';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const MODEL_ID = '22222222-2222-4222-8222-222222222222';

function job(): JobRow {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    org_id: ORG_ID,
    queue: 'viral',
    kind: 'viral.insight',
    payload: { modelId: MODEL_ID, windowKey: '2026-08-03' },
    state: 'ready', attempts: 0, max_attempts: 3, last_error: null,
    run_after: new Date(), locked_by: null, locked_at: null, dedupe_key: null,
    scheduled_for: null, started_at: null, completed_at: null, created_at: new Date(),
  };
}

describe('viral.insight executor', () => {
  beforeEach(() => {
    state.results = [[{
      platform: 'fanvue',
      learning_arm: 'v2:short:question',
      learning_context: 'learn-v2:scheduled-utc-2',
      published_hour_utc: 19,
      sample_size: 4,
      mean_score: 1.25,
    }], [{ scope: 'org', locale: 'de' }], [{ id: 'source-card-1' }], []];
    state.values = [];
  });

  it('stores one bounded, localized Relay card and never dispatches externally', async () => {
    await viralInsight({ tx: chain(), job: job(), workerId: 'test', killSwitchEnabled: false });
    expect(state.values).toHaveLength(2);
    expect(state.values[0]).toMatchObject({
      orgId: ORG_ID,
      modelId: MODEL_ID,
      channel: 'viral_insight',
      externalRef: `viral-insight:${MODEL_ID}:2026-08-03`,
      state: 'stored',
    });
    expect(state.values[0].config).toMatchObject({
      externalDelivery: 'not-attempted',
      viralInsight: { evidenceSource: 'published-provider-snapshot-v2', minimumSample: 3 },
    });
    expect(state.values[1]).toMatchObject({
      orgId: ORG_ID,
      queue: 'relay',
      kind: 'relay.card',
      payload: { insightCardId: 'source-card-1' },
    });
  });

  it('does not create a card when the evidence query is empty', async () => {
    state.results = [[], [{ scope: 'org', locale: 'en' }]];
    await viralInsight({ tx: chain(), job: job(), workerId: 'test', killSwitchEnabled: false });
    expect(state.values).toEqual([]);
  });
});
