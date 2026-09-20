import { describe, expect, it, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { UserRole } from '@axiom/core';
import type { AppBindings } from '../index.js';
import { mockDbFactory, mockState } from './test-utils.js';

vi.mock('@axiom/db', () => mockDbFactory({ relayCard: {}, contentBundle: {}, modelProfile: {} }));
import { relayCardsRouter } from './relay-cards.js';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const MODEL_ID = '22222222-2222-4222-8222-222222222222';

function app(role: UserRole = 'owner', userId = 'user-1') {
  const instance = new Hono<AppBindings>();
  instance.use('*', async (c, next) => {
    c.set('orgId', ORG_ID);
    c.set('userId', userId);
    c.set('role', role);
    await next();
  });
  instance.route('/', relayCardsRouter);
  return instance;
}

beforeEach(() => {
  mockState.result = [];
  mockState.results = [];
  mockState.updates = [];
  mockState.conflictUpdates = [];
  mockState.insertValues = [];
});

describe('model relay-card history', () => {
  it('returns model-scoped history without provider references or config', async () => {
    const createdAt = new Date('2026-01-02T03:04:05.000Z');
    mockState.results = [
      [],
      [{ orgId: ORG_ID }],
      [],
      [{
        id: 'card-1',
        bundleId: 'bundle-1',
        channel: 'telegram',
        state: 'sent',
        title: 'Approval ready',
        description: 'Review this bundle',
        icon: 'check',
        enabled: true,
        priority: 1,
        createdAt,
        externalRef: 'private-chat-reference',
        config: { providerToken: 'must-not-leak' },
      }],
    ];

    const response = await app().request(`/models/${MODEL_ID}/relay-cards?limit=1`);
    expect(response.status).toBe(200);
    const json = await response.json() as { data: Record<string, unknown>[]; meta: { next_cursor: string | null } };
    expect(json.data[0]).toEqual({
      id: 'card-1',
      bundleId: 'bundle-1',
      channel: 'telegram',
      state: 'sent',
      title: 'Approval ready',
      description: 'Review this bundle',
      icon: 'check',
      enabled: true,
      priority: 1,
      createdAt: createdAt.toISOString(),
    });
    expect(json.data[0]).not.toHaveProperty('externalRef');
    expect(json.data[0]).not.toHaveProperty('config');
    expect(json.meta.next_cursor).not.toBeNull();
  });

  it('returns not found for a model outside the session organization', async () => {
    mockState.results = [[], []];
    const response = await app().request(`/models/${MODEL_ID}/relay-cards`);
    expect(response.status).toBe(404);
  });
});

describe('relay-card operator reconciliation', () => {
  const pendingCard = {
    id: 'card-pending',
    bundleId: 'bundle-1',
    channel: 'telegram',
    state: 'pending',
    title: 'Approval ready',
    description: 'Review this bundle',
    icon: 'check',
    enabled: true,
    priority: 1,
    createdAt: new Date('2026-01-02T03:04:05.000Z'),
  };

  it.each<UserRole>(['owner', 'manager', 'operator'])('allows %s to record a delivered observation without provider I/O', async role => {
    const updated = { ...pendingCard, state: 'sent' };
    mockState.results = [[], [{ card: pendingCard, modelId: MODEL_ID }], [updated], [], [], []];
    const response = await app(role).request(`/models/${MODEL_ID}/relay-cards/${pendingCard.id}/reconcile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outcome: 'delivered' }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: { ...updated, createdAt: updated.createdAt.toISOString() },
      meta: { idempotent: false, outcome: 'delivered' },
    });
    expect(mockState.updates).toContainEqual({ state: 'sent' });
    const audit = mockState.insertValues.find(value => typeof value === 'object' && value !== null && 'action' in value) as Record<string, unknown> | undefined;
    expect(audit?.action).toBe('relay.card.reconcile');
    expect(audit?.detail).toEqual({ modelId: MODEL_ID, priorState: 'pending', outcome: 'delivered', nextState: 'sent' });
  });

  it('maps an uncertain card to failed and keeps the audit detail redacted', async () => {
    const current = { ...pendingCard, id: 'card-unknown', state: 'unknown', externalRef: 'private-ref', config: { token: 'secret' } };
    const updated = { ...pendingCard, id: 'card-unknown', state: 'failed' };
    mockState.results = [[], [{ card: current, modelId: MODEL_ID }], [updated], [], [], []];
    const response = await app('manager').request(`/models/${MODEL_ID}/relay-cards/${current.id}/reconcile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outcome: 'not_delivered' }),
    });
    expect(response.status).toBe(200);
    const json = await response.json() as { data: Record<string, unknown> };
    expect(json.data.state).toBe('failed');
    expect(json.data).not.toHaveProperty('externalRef');
    expect(json.data).not.toHaveProperty('config');
    expect(mockState.updates).toContainEqual({ state: 'failed' });
  });

  it('treats the same terminal observation as idempotent', async () => {
    const sent = { ...pendingCard, state: 'sent' };
    mockState.results = [[], [{ card: sent, modelId: MODEL_ID }]];
    const response = await app().request(`/models/${MODEL_ID}/relay-cards/${sent.id}/reconcile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outcome: 'delivered' }),
    });
    expect(response.status).toBe(200);
    expect((await response.json() as { meta: { idempotent: boolean } }).meta.idempotent).toBe(true);
    expect(mockState.updates).toEqual([]);
    expect(mockState.insertValues).toEqual([]);
  });

  it('rejects terminal state changes and compare-and-set races', async () => {
    mockState.results = [[], [{ card: { ...pendingCard, state: 'sent' }, modelId: MODEL_ID }]];
    const terminal = await app().request(`/models/${MODEL_ID}/relay-cards/${pendingCard.id}/reconcile`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ outcome: 'not_delivered' }),
    });
    expect(terminal.status).toBe(409);

    mockState.results = [[], [{ card: pendingCard, modelId: MODEL_ID }], []];
    const race = await app().request(`/models/${MODEL_ID}/relay-cards/${pendingCard.id}/reconcile`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ outcome: 'delivered' }),
    });
    expect(race.status).toBe(409);
  });

  it('denies non-operator roles before touching the database', async () => {
    const response = await app('model').request(`/models/${MODEL_ID}/relay-cards/${pendingCard.id}/reconcile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outcome: 'delivered' }),
    });
    expect(response.status).toBe(403);
    expect(mockState.results).toEqual([]);
  });
});
