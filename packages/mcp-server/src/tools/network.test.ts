import { describe, expect, it } from 'vitest';
import { Tier, type AgentPermission } from '../auth.js';
import { NetworkTool } from './network.js';

const MODEL_ID = '11111111-1111-4111-8111-111111111111';
const permission: AgentPermission = {
  agentId: 'agent-1',
  modelId: MODEL_ID,
  tier: Tier.Autonomous,
  scopes: [],
  expiresAt: null,
};

describe('NetworkTool', () => {
  it('rejects before touching the database when approval is not wired', async () => {
    await expect(
      new NetworkTool().handle({ modelId: MODEL_ID, config: { crossPosting: true } }, permission),
    ).rejects.toThrow(
      'Network configuration is unavailable: no durable dashboard/Relay approval executor is configured',
    );
  });
});
