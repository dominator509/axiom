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
  roleplayTurn: {},
}));
vi.mock('./helpers.js', async original => ({
  ...await original<typeof import('./helpers.js')>(),
  writeAudit: vi.fn(),
}));

import { roleplayGateway, roleplayRouter } from './roleplay.js';

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

  it('returns persisted provider receipts in the reloadable roleplay context', async () => {
    mockState.results = [
      [],
      [{ id: MODEL_ID }],
      [{ id: 'shift-1', queue: 'chatter', actorType: 'human', actorRef: 'user-1' }],
      [{ id: 'assigned-1' }],
      [],
      [],
      [],
      [{ id: 'turn-1', state: 'uncertain', provider: 'grok', providerModel: 'grok-roleplayer', input: 'Continue safely.', providerRequestId: null, errorCode: 'provider-uncertain', createdAt: new Date('2026-01-01T00:00:00Z'), finalizedAt: new Date('2026-01-01T00:00:01Z') }],
    ];
    const response = await appWithAuth().request(`/models/${MODEL_ID}/roleplay?actorType=human&actorRef=user-1`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.turns).toEqual([expect.objectContaining({ turnId: 'turn-1', state: 'uncertain', provider: 'grok', errorCode: 'provider-uncertain', content: null })]);
  });

  it('generates one bounded Grok turn and records the provider receipt plus memory', async () => {
    const handoff = {
      currentOwner: { type: 'llm', ref: 'grok-roleplayer' },
      actor: { type: 'llm', ref: 'grok-roleplayer' },
      orgId: ORG_ID,
      modelId: MODEL_ID,
      shiftId: '33333333-3333-4333-8333-333333333333',
      queue: 'chatter',
      conversationCursor: null,
      lastSafeSummary: 'Continue the bounded conversation.',
      pendingIntentId: null,
      memoryPolicy: { maxTurns: 20, maxCharacters: 8_000 },
      personaSource: null,
      allowedNextAction: 'Generate one bounded roleplay turn',
      terminal: false,
      unresolvedUncertainty: null,
      evidenceReferences: [],
    };
    mockState.results = [
      [],
      [{ id: MODEL_ID }],
      [{ id: handoff.shiftId, queue: 'chatter', actorType: 'llm', actorRef: 'grok-roleplayer' }],
      [{ id: 'permission-1' }],
      [],
      [{ payload: handoff }],
      [],
      [],
      [{ id: 'turn-1', orgId: ORG_ID, modelId: MODEL_ID, conversationKey: 'default', intentKey: '44444444-4444-4444-8444-444444444444', actorType: 'llm', actorRef: 'grok-roleplayer', shiftId: handoff.shiftId, provider: 'grok', providerModel: 'grok-roleplayer', state: 'pending', input: 'Say hello safely.' }],
      [],
      [{ id: 'turn-1', state: 'pending', conversationKey: 'default', input: 'Say hello safely.', actorRef: 'grok-roleplayer' }],
      [{ maxSequence: 0 }],
      [],
      [],
      [{ id: 'turn-1', state: 'completed', provider: 'grok', providerModel: 'grok-roleplayer', output: 'Hello, safely and warmly.', providerRequestId: 'provider-receipt-1', errorCode: null }],
    ];
    const chat = vi.spyOn(roleplayGateway, 'chat').mockResolvedValue({
      id: 'provider-receipt-1', content: 'Hello, safely and warmly.', model: 'grok-roleplayer', provider: 'grok', cost: 0,
      tokens: { prompt: 10, completion: 5, total: 15 }, latency: 12, cached: false,
    });
    const response = await appWithAuth().request(`/models/${MODEL_ID}/roleplay/turn`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversationKey: 'default', intentKey: '44444444-4444-4444-8444-444444444444', actor: { type: 'llm', ref: 'grok-roleplayer' }, content: 'Say hello safely.', confirm: true }),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ data: expect.objectContaining({ turnId: 'turn-1', state: 'completed', provider: 'grok', content: 'Hello, safely and warmly.', providerRequestId: 'provider-receipt-1' }) });
    expect(chat).toHaveBeenCalledOnce();
    expect(mockState.insertValues).toContainEqual(expect.objectContaining({ intentKey: '44444444-4444-4444-8444-444444444444', actorType: 'llm', provider: 'grok', state: 'pending' }));
    expect(mockState.insertValues).toContainEqual(expect.arrayContaining([expect.objectContaining({ role: 'user', content: 'Say hello safely.' }), expect.objectContaining({ role: 'assistant', content: 'Hello, safely and warmly.' })]));
  });

  it('does not call Grok again for a pending idempotent turn', async () => {
    mockState.results = [
      [],
      [{ id: MODEL_ID }],
      [{ id: 'shift-1', queue: 'chatter', actorType: 'llm', actorRef: 'grok-roleplayer' }],
      [{ id: 'permission-1' }],
      [{ id: 'turn-1', state: 'pending', conversationKey: 'default', actorType: 'llm', actorRef: 'grok-roleplayer', input: 'Already claimed.' }],
    ];
    const chat = vi.spyOn(roleplayGateway, 'chat');
    const response = await appWithAuth().request(`/models/${MODEL_ID}/roleplay/turn`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversationKey: 'default', intentKey: '44444444-4444-4444-8444-444444444444', actor: { type: 'llm', ref: 'grok-roleplayer' }, content: 'Already claimed.', confirm: true }),
    });
    expect(response.status).toBe(409);
    expect(chat).not.toHaveBeenCalled();
  });
});
