import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';
import { mockDbFactory, mockState } from './test-utils.js';

vi.mock('@axiom/db', () => mockDbFactory({ agentPermission: {}, mcpCapabilityToken: {}, mcpTokenRevocation: {} }));

import { agentPermissionsRouter } from './agent-permissions.js';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const MODEL_ID = '22222222-2222-4222-8222-222222222222';
const PERMISSION_ID = '33333333-3333-4333-8333-333333333333';

function appWithOrg(orgId: string | null) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => { if (orgId) c.set('orgId', orgId); c.set('userId', 'owner-1'); await next(); });
  app.route('/', agentPermissionsRouter);
  return app;
}

beforeEach(() => { mockState.result = []; mockState.results = []; mockState.updates = []; });
afterEach(() => { vi.restoreAllMocks(); });

describe('agent permission administration', () => {
  it('lists durable grants without exposing bearer tokens', async () => {
    mockState.results = [[], [{ id: PERMISSION_ID, orgId: ORG_ID, modelId: MODEL_ID, agentRef: 'hermes', tier: 'operator', canPublish: false, canEdit: true }], [{ tokenId: 'token-1', permissionId: PERMISSION_ID, expiresAt: new Date('2026-09-16T01:00:00Z'), revokedAt: null }]];
    const response = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/agent-permissions`);
    expect(response.status).toBe(200);
    const body = await response.json() as { data: Array<{ agentRef: string; tokens: Array<{ tokenId: string }> }> };
    expect(body.data[0]?.agentRef).toBe('hermes');
    expect(body.data[0]?.tokens[0]?.tokenId).toBe('token-1');
    expect(JSON.stringify(body)).not.toContain('Bearer ');
  });

  it('issues a one-time token only for an existing model-scoped grant', async () => {
    mockState.results = [[], [{ id: PERMISSION_ID, orgId: ORG_ID, modelId: MODEL_ID, agentRef: 'hermes', tier: 'operator', canPublish: false, canEdit: true }]];
    const response = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/agent-permissions/${PERMISSION_ID}/tokens`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ttlSeconds: 600 }),
    });
    expect(response.status).toBe(201);
    const body = await response.json() as { data: { token: string; agentRef: string; tier: string; expiresAt: string }; warning: string };
    expect(body.data.token).toMatch(/^v1\./);
    expect(body.data.agentRef).toBe('hermes');
    expect(body.data.tier).toBe('operator');
    expect(body.warning).toContain('not stored');
  });

  it('rejects unauthenticated and malformed grant requests', async () => {
    expect((await appWithOrg(null).request(`/models/${MODEL_ID}/agent-permissions`)).status).toBe(401);
    const response = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/agent-permissions`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tier: 'autonomous' }),
    });
    expect(response.status).toBe(400);
  });
});
