import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Tier, type AgentPermission } from '../auth.js';

const testState = vi.hoisted(() => {
  const state: { rows: unknown[]; operations: Array<{ method: string; value?: unknown }> } = {
    rows: [],
    operations: [],
  };
  const schema = {
    contentBundle: {
      orgId: 'content_bundle.org_id',
      modelId: 'content_bundle.model_id',
    },
    postMetric: {
      collectedAt: 'post_metric.collected_at',
      views: 'post_metric.views',
      likes: 'post_metric.likes',
      shares: 'post_metric.shares',
      comments: 'post_metric.comments',
      engagementRate: 'post_metric.engagement_rate',
      postTargetId: 'post_metric.post_target_id',
    },
    postTarget: { id: 'post_target.id', bundleId: 'post_target.bundle_id' },
  };

  type Query = {
    select(...args: unknown[]): Query;
    from(...args: unknown[]): Query;
    innerJoin(...args: unknown[]): Query;
    where(...args: unknown[]): Query;
    then<TResult = unknown>(
      onfulfilled?: ((value: unknown) => TResult | PromiseLike<TResult>) | null,
      onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
    ): PromiseLike<TResult>;
  };
  const tx = {} as Query;
  tx.select = (value: unknown) => {
    state.operations.push({ method: 'select', value });
    return tx;
  };
  tx.from = (value: unknown) => {
    state.operations.push({ method: 'from', value });
    return tx;
  };
  tx.innerJoin = (value: unknown) => {
    state.operations.push({ method: 'innerJoin', value });
    return tx;
  };
  tx.where = (value: unknown) => {
    state.operations.push({ method: 'where', value });
    return tx;
  };
  tx.then = (resolve, reject) =>
    Promise.resolve(state.rows).then(resolve ?? undefined, reject ?? undefined);

  return { state, schema, tx };
});

vi.mock('drizzle-orm', () => ({
  and: (...conditions: unknown[]) => ({ op: 'and', conditions }),
  eq: (column: unknown, value: unknown) => ({ op: 'eq', column, value }),
  gte: (column: unknown, value: unknown) => ({ op: 'gte', column, value }),
  lte: (column: unknown, value: unknown) => ({ op: 'lte', column, value }),
}));

vi.mock('../org-context.js', () => ({
  schema: testState.schema,
  withModelOrg: async (_modelId: string, fn: (tx: unknown, orgId: string) => unknown) =>
    fn(testState.tx, 'org-a'),
}));

import { AnalyticsTool } from './analytics.js';

const MODEL_ID = '11111111-1111-4111-8111-111111111111';
const permission: AgentPermission = {
  agentId: 'agent-1',
  modelId: MODEL_ID,
  tier: Tier.Viewer,
  scopes: [],
  expiresAt: null,
};

function conditions(value: unknown): Array<{ column: unknown; value: unknown }> {
  if (!value || typeof value !== 'object') return [];
  const condition = value as {
    op?: string;
    column?: unknown;
    value?: unknown;
    conditions?: unknown[];
  };
  if (condition.op === 'eq') return [{ column: condition.column, value: condition.value }];
  return (condition.conditions ?? []).flatMap((nested) => conditions(nested));
}

describe('AnalyticsTool', () => {
  beforeEach(() => {
    testState.state.rows = [];
    testState.state.operations = [];
  });

  it('returns the requested metric value and keeps the aggregate summary', async () => {
    testState.state.rows = [
      { views: 100, likes: 10, shares: 2, comments: 8, engagementRate: 0.2 },
      { views: 50, likes: 5, shares: 1, comments: 4, engagementRate: 0.2 },
    ];

    const result = (await new AnalyticsTool().handle(
      { modelId: MODEL_ID, metric: 'views' },
      permission,
    )) as {
      data: {
        metric: string;
        selected: { metric: string; value: number };
        summary: { views: number; likes: number; shares: number; comments: number };
      };
    };

    expect(result.data.metric).toBe('views');
    expect(result.data.selected).toEqual({ metric: 'views', value: 150 });
    expect(result.data.summary).toMatchObject({ views: 150, likes: 15, shares: 3, comments: 12 });

    const where = testState.state.operations.find((op) => op.method === 'where');
    expect(conditions(where?.value)).toEqual(
      expect.arrayContaining([
        { column: testState.schema.contentBundle.orgId, value: 'org-a' },
        { column: testState.schema.contentBundle.modelId, value: MODEL_ID },
      ]),
    );
  });

  it('returns null selection when no metric is requested', async () => {
    const result = (await new AnalyticsTool().handle({ modelId: MODEL_ID }, permission)) as {
      data: { metric: string; selected: unknown };
    };

    expect(result.data.metric).toBe('all');
    expect(result.data.selected).toBeNull();
  });
});
