import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';
import { mockDbFactory, mockState } from './test-utils.js';

vi.mock('@axiom/db', () => ({
  ...mockDbFactory({ triggerRule: {}, modelProfile: {}, auditLog: {} }),
}));
vi.mock('@axiom/worker', () => ({
  asPlatform: (value: string) => {
    if (!['instagram', 'threads', 'x', 'telegram', 'discord', 'fanvue'].includes(value)) throw new Error('unsupported');
    return value;
  },
}));

import { triggerRulesRouter } from './trigger-rules.js';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const MODEL_ID = '22222222-2222-4222-8222-222222222222';
const RULE_ID = '33333333-3333-4333-8333-333333333333';

function appWithOrg(orgId: string | null) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    if (orgId) c.set('orgId', orgId);
    c.set('userId', 'owner-1');
    await next();
  });
  app.route('/', triggerRulesRouter);
  return app;
}

beforeEach(() => {
  mockState.result = [];
  mockState.results = [];
  mockState.updates = [];
  vi.clearAllMocks();
});

describe('trigger rule routes', () => {
  it('requires an authenticated organization', async () => {
    const response = await appWithOrg(null).request(`/models/${MODEL_ID}/trigger-rules`);
    expect(response.status).toBe(401);
  });

  it('rejects unsupported platforms and malformed action configuration', async () => {
    const response = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/trigger-rules`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Viral follow-up',
        platform: 'not-a-provider',
        condition: { metric: 'likes', threshold: 100 },
        action: { type: 'unknown' },
      }),
    });
    expect(response.status).toBe(400);
    expect(mockState.results).toEqual([]);
  });

  it('persists a valid model-scoped rule without claiming it fired', async () => {
    mockState.results = [[], [{ id: MODEL_ID }], [{
      id: RULE_ID,
      orgId: ORG_ID,
      modelId: MODEL_ID,
      name: 'Viral follow-up',
      platform: 'instagram',
      condition: { metric: 'likes', threshold: 100 },
      action: { type: 'content.generate', style: 'follow-up', cooldownMinutes: 120 },
      enabled: true,
      lastFiredAt: null,
    }]];
    const response = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/trigger-rules`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Viral follow-up',
        platform: 'instagram',
        condition: { metric: 'likes', threshold: 100 },
        action: { type: 'content.generate', style: 'follow-up', cooldownMinutes: 120 },
      }),
    });
    expect(response.status).toBe(201);
    expect((await response.json() as { data: { id: string; enabled: boolean } }).data).toMatchObject({ id: RULE_ID, enabled: true });
  });

  it('accepts a learned p90 rule without accepting a client-supplied threshold', async () => {
    mockState.results = [[], [{ id: MODEL_ID }], [{
      id: RULE_ID,
      orgId: ORG_ID,
      modelId: MODEL_ID,
      name: 'Adaptive follow-up',
      platform: 'instagram',
      condition: { metric: 'likes', thresholdMode: 'learned_p90', minimumSamples: 4, windowMinutes: 1_440 },
      action: { type: 'content.generate', style: 'follow-up', cooldownMinutes: 120 },
      enabled: true,
      lastFiredAt: null,
    }]];
    const response = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/trigger-rules`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Adaptive follow-up',
        platform: 'instagram',
        condition: { metric: 'likes', thresholdMode: 'learned_p90', minimumSamples: 4, windowMinutes: 1_440 },
        action: { type: 'content.generate', style: 'follow-up', cooldownMinutes: 120 },
      }),
    });
    expect(response.status).toBe(201);
    expect((await response.json() as { data: { condition: Record<string, unknown> } }).data.condition).toMatchObject({
      thresholdMode: 'learned_p90',
      minimumSamples: 4,
      windowMinutes: 1_440,
    });
  });

  it('rejects a fixed rule without a threshold and a learned rule with one', async () => {
    const fixed = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/trigger-rules`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Missing threshold', platform: 'instagram',
        condition: { metric: 'likes', thresholdMode: 'fixed' },
        action: { type: 'content.generate' },
      }),
    });
    const learned = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/trigger-rules`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Client threshold', platform: 'instagram',
        condition: { metric: 'likes', thresholdMode: 'learned_p90', threshold: 100, minimumSamples: 4 },
        action: { type: 'content.generate' },
      }),
    });
    expect(fixed.status).toBe(400);
    expect(learned.status).toBe(400);
    expect(mockState.results).toEqual([]);
  });

  it('lists rules in the model scope and supports deletion', async () => {
    mockState.result = [{ id: RULE_ID, modelId: MODEL_ID, name: 'Viral follow-up' }];
    const listed = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/trigger-rules`);
    expect(listed.status).toBe(200);
    expect((await listed.json() as { data: Array<{ id: string }> }).data[0]?.id).toBe(RULE_ID);

    mockState.result = [{ id: RULE_ID }];
    const deleted = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/trigger-rules/${RULE_ID}`, { method: 'DELETE' });
    expect(deleted.status).toBe(200);
  });
});
