import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Tier, type AgentPermission } from '../auth.js';

const testState = vi.hoisted(() => {
  const state: {
    results: unknown[];
    operations: Array<{ method: string; value?: unknown }>;
    inserts: Array<Record<string, unknown>>;
  } = { results: [], operations: [], inserts: [] };

  const schema = {
    fanTouchpoint: {
      id: 'fan_touchpoint.id',
      orgId: 'fan_touchpoint.org_id',
      fanId: 'fan_touchpoint.fan_id',
      platform: 'fan_touchpoint.platform',
      kind: 'fan_touchpoint.kind',
      direction: 'fan_touchpoint.direction',
      content: 'fan_touchpoint.content',
      ts: 'fan_touchpoint.ts',
    },
    fanCrmContact: {
      id: 'fan_crm_contact.id',
      orgId: 'fan_crm_contact.org_id',
      modelId: 'fan_crm_contact.model_id',
    },
  };

  type Query = {
    select(...args: unknown[]): Query;
    from(...args: unknown[]): Query;
    innerJoin(...args: unknown[]): Query;
    where(...args: unknown[]): Query;
    orderBy(...args: unknown[]): Query;
    limit(...args: unknown[]): Query;
    insert(...args: unknown[]): Query;
    values(...args: unknown[]): Query;
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
  tx.orderBy = (value: unknown) => {
    state.operations.push({ method: 'orderBy', value });
    return tx;
  };
  tx.limit = (value: unknown) => {
    state.operations.push({ method: 'limit', value });
    return tx;
  };
  tx.insert = () => {
    state.operations.push({ method: 'insert' });
    return tx;
  };
  tx.values = (value: unknown) => {
    state.inserts.push(value as Record<string, unknown>);
    return tx;
  };
  tx.then = (resolve, reject) => {
    const result = state.results.shift() ?? [];
    return Promise.resolve(result).then(resolve ?? undefined, reject ?? undefined);
  };

  return { state, schema, tx };
});

vi.mock('drizzle-orm', () => ({
  and: (...conditions: unknown[]) => ({ op: 'and', conditions }),
  desc: (column: unknown) => ({ op: 'desc', column }),
  eq: (column: unknown, value: unknown) => ({ op: 'eq', column, value }),
}));

vi.mock('../org-context.js', () => ({
  schema: testState.schema,
  withModelOrg: async (_modelId: string, fn: (tx: unknown, orgId: string) => unknown) =>
    fn(testState.tx, 'org-a'),
}));

import { InboxTool } from './inbox.js';

const MODEL_ID = '11111111-1111-4111-8111-111111111111';
const MESSAGE_ID = '22222222-2222-4222-8222-222222222222';
const permission: AgentPermission = {
  agentId: 'agent-1',
  modelId: MODEL_ID,
  tier: Tier.Operator,
  scopes: [],
  expiresAt: null,
};

function conditions(value: unknown): Array<{ column: unknown; value: unknown }> {
  if (!value || typeof value !== 'object') return [];
  const condition = value as { op?: string; column?: unknown; value?: unknown; conditions?: unknown[] };
  if (condition.op === 'eq') return [{ column: condition.column, value: condition.value }];
  return (condition.conditions ?? []).flatMap((nested) => conditions(nested));
}

describe('InboxTool tenant and model scoping', () => {
  beforeEach(() => {
    testState.state.results = [];
    testState.state.operations = [];
    testState.state.inserts = [];
  });

  it('filters inbox reads by the bound model in SQL before applying the limit', async () => {
    testState.state.results = [
      [
        {
          id: MESSAGE_ID,
          fanId: 'fan-a',
          platform: 'telegram',
          kind: 'dm',
          direction: 'inbound',
          content: 'hello',
          ts: new Date('2026-09-02T12:00:00Z'),
        },
      ],
    ];

    const result = (await new InboxTool().handle(
      { modelId: MODEL_ID, action: 'read' },
      permission,
    )) as { messages: Array<{ id: string }> };

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].id).toBe(MESSAGE_ID);
    expect(testState.state.operations.some((op) => op.method === 'innerJoin')).toBe(true);
    const where = testState.state.operations.find((op) => op.method === 'where');
    expect(conditions(where?.value)).toEqual(
      expect.arrayContaining([
        { column: testState.schema.fanTouchpoint.orgId, value: 'org-a' },
        { column: testState.schema.fanCrmContact.orgId, value: 'org-a' },
        { column: testState.schema.fanCrmContact.modelId, value: MODEL_ID },
      ]),
    );
  });

  it('does not reply to a touchpoint belonging to another model in the org', async () => {
    testState.state.results = [[]];

    await expect(
      new InboxTool().handle(
        { modelId: MODEL_ID, action: 'reply', messageId: MESSAGE_ID, content: 'reply' },
        permission,
      ),
    ).rejects.toThrow(`Message ${MESSAGE_ID} not found`);

    expect(testState.state.inserts).toHaveLength(0);
  });

  it('writes a reply with the resolved tenant after model-scoped lookup', async () => {
    testState.state.results = [[{ fanId: 'fan-a', platform: 'telegram' }], []];

    await new InboxTool().handle(
      { modelId: MODEL_ID, action: 'reply', messageId: MESSAGE_ID, content: 'reply' },
      permission,
    );

    expect(testState.state.inserts).toEqual([
      expect.objectContaining({ orgId: 'org-a', fanId: 'fan-a', platform: 'telegram' }),
    ]);
  });
});
