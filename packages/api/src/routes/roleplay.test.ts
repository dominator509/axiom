import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { UserRole } from '@axiom/core';
import type { AppBindings } from '../index.js';
import { mockDbFactory, mockState } from './test-utils.js';

vi.mock('@axiom/db', () => mockDbFactory({
  modelProfile: {},
  teamShift: {},
  agentPermission: {},
  roleplayPersonaRevision: {},
  roleplayMemoryTurn: {},
  roleplayHandoff: {},
}));
vi.mock('./helpers.js', async original => ({
  ...await original<typeof import('./helpers.js')>(),
  writeAudit: vi.fn(),
}));

import { roleplayRouter } from './roleplay.js';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const MODEL_ID = '22222222-2222-4222-8222-222222222222';

function appWithAuth(role: UserRole = 'operator', orgId: string | null = ORG_ID) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    if (orgId) c.set('orgId', orgId);
    c.set('userId', 'user-1');
    c.set('role', role);
    await next();
  });
  app.route('/', roleplayRouter);
  return app;
}

beforeEach(() => {
  mockState.result = [];
  mockState.results = [];
  mockState.insertValues = [];
  mockState.updates = [];
});

describe('roleplay persistence contract', () => {
  it('requires authenticated workspace context', async () => {
    const response = await appWithAuth('operator', null).request(`/models/${MODEL_ID}/roleplay`);
    expect(response.status).toBe(401);
  });

  it('rejects oversized soul.md content before any database write', async () => {
    const response = await appWithAuth().request(`/models/${MODEL_ID}/roleplay/persona`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 0, sourceRef: 'soul.md', content: 'x'.repeat(8_001) }),
    });
    expect(response.status).toBe(400);
    expect(mockState.insertValues).toHaveLength(0);
  });

  it('rejects path traversal in persona source references', async () => {
    const response = await appWithAuth().request(`/models/${MODEL_ID}/roleplay/persona`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 0, sourceRef: '../soul.md', content: 'Bounded guidance' }),
    });
    expect(response.status).toBe(400);
    expect(mockState.insertValues).toHaveLength(0);
  });

  it('persists a new immutable soul.md revision with the authenticated author', async () => {
    mockState.results = [[], [{ id: MODEL_ID }], [], [{ id: 'persona-1', revision: 1, source: 'soul.md', sourceRef: 'soul.md', content: 'Warm and playful' }]];
    const response = await appWithAuth().request(`/models/${MODEL_ID}/roleplay/persona`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 0, sourceRef: 'soul.md', content: 'Warm and playful' }),
    });
    expect(response.status).toBe(201);
    expect(mockState.insertValues).toContainEqual(expect.objectContaining({
      orgId: ORG_ID,
      modelId: MODEL_ID,
      source: 'soul.md',
      revision: 1,
      createdByUserId: 'user-1',
    }));
  });

  it('does not allow a chatter to write LLM-owned memory', async () => {
    const response = await appWithAuth('chatter').request(`/models/${MODEL_ID}/roleplay/memory`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        conversationKey: 'default',
        sequence: 1,
        role: 'assistant',
        speaker: { type: 'llm', ref: 'grok-roleplayer' },
        content: 'A bounded response',
      }),
    });
    expect(response.status).toBe(403);
    expect(mockState.insertValues).toHaveLength(0);
  });

  it('rejects malformed handoff envelopes before persistence', async () => {
    const response = await appWithAuth().request(`/models/${MODEL_ID}/roleplay/handoff`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 0, conversationKey: 'default', handoff: { schema: 'wrong' } }),
    });
    expect(response.status).toBe(400);
    expect(mockState.insertValues).toHaveLength(0);
  });
});
