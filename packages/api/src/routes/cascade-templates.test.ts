import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';
import { mockDbFactory, mockState } from './test-utils.js';

vi.mock('@axiom/db', () => ({
  ...mockDbFactory({ cascadeTemplate: {}, modelProfile: {}, auditLog: {}, contentBundle: {}, asset: {}, postTarget: {}, platformConnection: {} }),
  getPublishingConsentStatus: vi.fn(async () => ({ ok: true, missing: [] })),
  consentRequirementMessage: vi.fn(() => 'consent required'),
}));
vi.mock('@axiom/worker', () => ({
  asPlatform: (value: string) => {
    if (!['instagram', 'threads', 'x', 'telegram', 'discord', 'fanvue'].includes(value)) throw new Error('unsupported');
    return value;
  },
  resolveCapabilities: () => ({ media: ['text', 'image', 'video'] }),
  enqueueJob: vi.fn(async () => undefined),
}));

import { cascadeTemplatesRouter } from './cascade-templates.js';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const MODEL_ID = '22222222-2222-4222-8222-222222222222';
const TEMPLATE_ID = '33333333-3333-4333-8333-333333333333';

function appWithOrg(orgId: string | null) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    if (orgId) c.set('orgId', orgId);
    c.set('userId', 'owner-1');
    await next();
  });
  app.route('/', cascadeTemplatesRouter);
  return app;
}

beforeEach(() => {
  mockState.result = [];
  mockState.results = [];
  mockState.updates = [];
  vi.clearAllMocks();
});

describe('cascade template routes', () => {
  it('requires an authenticated organization', async () => {
    const response = await appWithOrg(null).request(`/models/${MODEL_ID}/cascade-templates`);
    expect(response.status).toBe(401);
  });

  it('rejects unsupported platforms and non-ascending offsets before persistence', async () => {
    const response = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/cascade-templates`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Launch sequence',
        steps: [{ platform: 'not-a-provider', offsetMinutes: 0 }, { platform: 'x', offsetMinutes: 10 }],
      }),
    });
    expect(response.status).toBe(400);
    expect(mockState.results).toEqual([]);
  });

  it('persists a valid model-scoped template with ordered steps', async () => {
    mockState.results = [[], [{ id: MODEL_ID }], [{
      id: TEMPLATE_ID,
      orgId: ORG_ID,
      modelId: MODEL_ID,
      name: 'Launch sequence',
      steps: [{ platform: 'x', offsetMinutes: 0 }, { platform: 'threads', offsetMinutes: 120 }],
      enabled: true,
    }]];
    const response = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/cascade-templates`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Launch sequence',
        steps: [{ platform: 'x', offsetMinutes: 0 }, { platform: 'threads', offsetMinutes: 120 }],
      }),
    });
    expect(response.status).toBe(201);
    expect((await response.json() as { data: { id: string; modelId: string } }).data).toMatchObject({ id: TEMPLATE_ID, modelId: MODEL_ID });
  });

  it('requires a future base time before attempting expansion', async () => {
    const response = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/cascade-templates/${TEMPLATE_ID}/expand`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bundleId: '44444444-4444-4444-8444-444444444444', baseScheduledFor: '2020-01-01T00:00:00.000Z' }),
    });
    expect(response.status).toBe(400);
    expect(mockState.results).toEqual([]);
  });
});
