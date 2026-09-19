import { describe, expect, it, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';
import { mockDbFactory, mockState } from './test-utils.js';

vi.mock('@axiom/db', () => mockDbFactory({ relayCard: {}, contentBundle: {}, modelProfile: {} }));
import { relayCardsRouter } from './relay-cards.js';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const MODEL_ID = '22222222-2222-4222-8222-222222222222';

function app() {
  const instance = new Hono<AppBindings>();
  instance.use('*', async (c, next) => {
    c.set('orgId', ORG_ID);
    c.set('userId', 'user-1');
    c.set('role', 'owner');
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
