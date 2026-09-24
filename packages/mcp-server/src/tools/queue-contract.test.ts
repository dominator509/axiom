import { beforeEach, describe, expect, it, vi } from 'vitest';

const { enqueueJob, withModelOrg, inserted, assetRows } = vi.hoisted(() => ({
  enqueueJob: vi.fn(async () => ({ id: 'job-1' })),
  withModelOrg: vi.fn(),
  inserted: [] as Array<{ table: unknown; values: Record<string, unknown> }>,
  assetRows: [] as Array<{ id: string }>,
}));

vi.mock('@axiom/worker', () => ({ enqueueJob }));
vi.mock('@axiom/db', () => ({
  consentRequirementMessage: vi.fn(),
  getPublishingConsentStatus: vi.fn(async () => ({ ok: true, missing: [] })),
}));
vi.mock('../org-context.js', () => ({
  schema: { asset: {}, contentBundle: {}, postTarget: {} },
  withModelOrg,
}));

import { Tier, type AgentPermission } from '../auth.js';
import { GenerationTool } from './generation.js';
import { PublishingTool } from './publishing.js';

const MODEL_ID = '9283b927-b95d-461c-90d0-729bc2d13852';
const ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TARGET_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ASSET_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function permission(tier: Tier): AgentPermission {
  return { agentId: 'agent-test', modelId: MODEL_ID, tier, scopes: [], expiresAt: null };
}

function makeTx() {
  inserted.length = 0;
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: vi.fn(async () => assetRows) })),
      })),
    })),
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
  assetRows.length = 0;
  withModelOrg.mockReset();
  withModelOrg.mockImplementation(
    async (_modelId: string, fn: (tx: unknown, orgId: string) => unknown) => fn(makeTx(), ORG_ID),
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

  it('stops Autonomous publishing at the generated bundle until approval', async () => {
    const result = await new PublishingTool().handle(
      {
        modelId: MODEL_ID,
        action: 'publish',
        post: { platform: 'x', text: 'hello' },
      },
      permission(Tier.Autonomous),
    );

    expect(result).toMatchObject({ status: 'pending_approval', requiresApproval: true });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.values).toMatchObject({
      state: 'generated',
      modelId: MODEL_ID,
      publishIntent: {
        action: 'publish',
        platform: 'x',
        scheduledAt: null,
      },
    });
    expect(enqueueJob).toHaveBeenCalledTimes(1);
    expect(enqueueJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        queue: 'tos',
        kind: 'tos.scan',
        payload: { bundleId: expect.any(String) },
        dedupeParts: ['tos.scan', expect.any(String)],
      }),
    );
  });

  it('persists one owned mediaId on the content bundle', async () => {
    assetRows.push({ id: ASSET_ID });

    await new PublishingTool().handle(
      {
        modelId: MODEL_ID,
        action: 'publish',
        post: { platform: 'instagram', mediaIds: [ASSET_ID] },
      },
      permission(Tier.Autonomous),
    );

    expect(inserted[0]?.values).toMatchObject({ assetId: ASSET_ID, state: 'generated' });
  });

  it('rejects an unowned mediaId before creating a bundle', async () => {
    await expect(
      new PublishingTool().handle(
        {
          modelId: MODEL_ID,
          action: 'publish',
          post: { platform: 'instagram', mediaIds: [ASSET_ID] },
        },
        permission(Tier.Autonomous),
      ),
    ).rejects.toThrow(`mediaId ${ASSET_ID} is not owned by model ${MODEL_ID}`);
    expect(inserted).toHaveLength(0);
  });

  it('rejects media-only publishing without an asset', async () => {
    await expect(
      new PublishingTool().handle(
        {
          modelId: MODEL_ID,
          action: 'publish',
          post: { platform: 'fanvue', text: 'hello' },
        },
        permission(Tier.Autonomous),
      ),
    ).rejects.toThrow('fanvue requires at least one mediaId');
    expect(inserted).toHaveLength(0);
  });

  it('rejects more media IDs than the persisted bundle can represent', () => {
    expect(
      new PublishingTool().inputSchema.safeParse({
        modelId: MODEL_ID,
        action: 'publish',
        post: { platform: 'instagram', mediaIds: [ASSET_ID, ASSET_ID] },
      }).success,
    ).toBe(false);
  });

  it('does not create a publish target before Manager approval', async () => {
    assetRows.push({ id: ASSET_ID });
    const result = await new PublishingTool().handle(
      {
        modelId: MODEL_ID,
        action: 'schedule',
        post: { platform: 'fanvue', mediaIds: [ASSET_ID], scheduledAt: '2026-08-02T10:00:00Z' },
      },
      permission(Tier.Manager),
    );

    expect(result).toMatchObject({ status: 'pending_approval', requiresApproval: true });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.values).toMatchObject({
      publishIntent: {
        action: 'schedule',
        platform: 'fanvue',
        scheduledAt: '2026-08-02T10:00:00Z',
      },
    });
    expect(enqueueJob).toHaveBeenCalledTimes(1);
    expect(enqueueJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ queue: 'tos', kind: 'tos.scan' }),
    );
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
