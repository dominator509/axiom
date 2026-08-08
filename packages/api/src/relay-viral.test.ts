// ─── relay-viral persistence (M-7) — Vitest Suite ───
// Exercises the DB-backed ViralPersistence injected into the relay:
//   persist()  → resolve post_target → insert post_metric → enqueue viral.label
//                → compute label with the executor's z-score math
//   listExemplars() → org-scoped viral_exemplar read
// Uses the shared chainable @axiom/db mock; each query resolves to
// mockState.result so a single row object can serve resolveTarget /
// computeLabel lookups.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockState, mockDbFactory } from './routes/test-utils.js';

vi.mock('@axiom/db', () => mockDbFactory({}));

import { relayViralPersistence } from './relay-viral.js';

const ORG_ID = '11111111-1111-4111-8111-111111111111';

function makeMetrics(overrides: Record<string, unknown> = {}) {
  return {
    postId: 'post-1',
    platform: 'tiktok',
    modelName: 'flux-pro',
    impressions: 1000,
    likes: 100,
    comments: 10,
    shares: 5,
    saves: 20,
    engagementRate: 0.03,
    timestamp: Date.now(),
    ...overrides,
  };
}

beforeEach(() => {
  mockState.result = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('relayViralPersistence.persist', () => {
  it('requires orgId (fail closed — no session, no write)', async () => {
    await expect(
      relayViralPersistence.persist({ postId: 'post-1', metrics: makeMetrics(), orgId: undefined }),
    ).rejects.toThrow('orgId required');
  });

  it('fails closed when no post_target matches (org, platform, remote_id)', async () => {
    mockState.result = []; // resolveTarget → no rows
    await expect(
      relayViralPersistence.persist({ postId: 'unknown', metrics: makeMetrics(), orgId: ORG_ID }),
    ).rejects.toThrow('no post_target');
  });

  it('persists post_metric + enqueues viral.label and returns the z-score label', async () => {
    // One row object serves every chained query: resolveTarget needs
    // id/bundleId, computeLabel needs modelId + engagementRate history.
    mockState.result = [
      {
        id: 'target-1',
        bundleId: 'bundle-1',
        modelId: 'model-1',
        engagementRate: 0.05,
      },
    ];

    const result = await relayViralPersistence.persist({
      postId: 'post-1',
      metrics: makeMetrics(),
      orgId: ORG_ID,
    });

    // Single metric in window → variance 0 → perfScore 0 → baseline.
    expect(result.label).toBe('baseline');
  });
});

describe('relayViralPersistence.listExemplars', () => {
  it('requires orgId', async () => {
    await expect(
      relayViralPersistence.listExemplars({ platform: 'all', limit: 10, orgId: undefined }),
    ).rejects.toThrow('orgId required');
  });

  it('returns org-scoped exemplars when platform=all', async () => {
    mockState.result = [
      { id: 'e1', label: 'viral', platform: 'tiktok', perfScore: 2.4 },
      { id: 'e2', label: 'strong', platform: 'fanvue', perfScore: 1.3 },
    ];
    const rows = await relayViralPersistence.listExemplars({
      platform: 'all',
      limit: 10,
      orgId: ORG_ID,
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: 'e1', label: 'viral' });
  });

  it('filters by platform when a specific platform is requested', async () => {
    mockState.result = [{ id: 'e1', label: 'viral', platform: 'tiktok', perfScore: 2.4 }];
    const rows = await relayViralPersistence.listExemplars({
      platform: 'tiktok',
      limit: 5,
      orgId: ORG_ID,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].platform).toBe('tiktok');
  });
});
