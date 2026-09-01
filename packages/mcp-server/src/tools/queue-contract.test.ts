import { beforeEach, describe, expect, it, vi } from 'vitest';

const { enqueueJob, withModelOrg, inserted } = vi.hoisted(() => ({
  enqueueJob: vi.fn(async () => ({ id: 'job-1' })),
  withModelOrg: vi.fn(),
  inserted: [] as Array<{ table: unknown; values: Record<string, unknown> }>,
}));

vi.mock('@axiom/worker', () => ({ enqueueJob }));
vi.mock('../org-context.js', () => ({
  schema: { contentBundle: {}, postTarget: {} },
  withModelOrg,
}));

import { Tier, type AgentPermission } from '../auth.js';
import { GenerationTool } from './generation.js';
import { PublishingTool } from './publishing.js';

const MODEL_ID = '9283b927-b95d-461c-90d0-729bc2d13852';
const ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TARGET_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function permission(tier: Tier): AgentPermission {
  return { agentId: 'agent-test', modelId: MODEL_ID, tier, scopes: [], expiresAt: null };
}

function makeTx() {
  inserted.length = 0;
  return {
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((values: Record<string, unknown>) => {
        inserted.push({ table, values });
        return {
          returning: vi.fn(async () => [{ id: TARGET_ID }]),
        };
      }),
    })),
  };
}

beforeEach(() => {
  enqueueJob.mockClear();
  withModelOrg.mockReset();
  withModelOrg.mockImplementation(
    async (_modelId: string, fn: (tx: unknown, orgId: string) => unknown) =>
      fn(makeTx(), ORG_ID),
  );
});

describe('MCP queue contracts', () => {
  it('passes the model and preallocated bundle to content.generate', async () => {
    const result = await new GenerationTool().handle(
      { modelId: MODEL_ID, prompt: 'beach editorial', style: 'editorial', count: 4 },
      permission(Tier.Operator),
    );

    expect(result).toMatchObject({ status: 'pending_approval', requiresApproval: true });
    expect(inserted[0]?.values).toMatchObject({ state: 'generated', modelId: MODEL_ID });
    expect(enqueueJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        queue: 'content',
        kind: 'content.generate',
        payload: expect.objectContaining({ modelId: MODEL_ID, prompt: 'beach editorial' }),
        dedupeParts: ['content.generate', expect.any(String)],
      }),
    );
  });

  it('enqueues publish.target with the returned target ID for Autonomous calls', async () => {
    const result = await new PublishingTool().handle(
      {
        modelId: MODEL_ID,
        action: 'publish',
        post: { platform: 'x', text: 'hello' },
      },
      permission(Tier.Autonomous),
    );

    expect(result).toMatchObject({ status: 'queued', requiresApproval: false });
    expect(inserted).toHaveLength(2);
    expect(enqueueJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        queue: 'publish',
        kind: 'publish.target',
        payload: { targetId: TARGET_ID },
        dedupeParts: ['publish.target', TARGET_ID],
      }),
    );
  });

  it('does not create a publish target or enqueue a job before Manager approval', async () => {
    const result = await new PublishingTool().handle(
      {
        modelId: MODEL_ID,
        action: 'schedule',
        post: { platform: 'fanvue', scheduledAt: '2026-08-02T10:00:00Z' },
      },
      permission(Tier.Manager),
    );

    expect(result).toMatchObject({ status: 'pending_approval', requiresApproval: true });
    expect(inserted).toHaveLength(1);
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('does not advertise an unsupported OnlyFans connector', () => {
    expect(
      new PublishingTool().inputSchema.safeParse({
        modelId: MODEL_ID,
        action: 'publish',
        post: { platform: 'onlyfans' },
      }).success,
    ).toBe(false);
  });
});
