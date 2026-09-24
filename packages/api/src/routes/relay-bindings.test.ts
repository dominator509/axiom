import { describe, expect, it, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';
import { mockDbFactory, mockState } from './test-utils.js';

vi.mock('@axiom/db', () => mockDbFactory({ relayBinding: {}, modelProfile: {}, auditLog: {} }));
import { relayBindingsRouter } from './relay-bindings.js';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const MODEL_ID = '22222222-2222-4222-8222-222222222222';

function app() {
  const instance = new Hono<AppBindings>();
  instance.use('*', async (c, next) => { c.set('orgId', ORG_ID); c.set('userId', 'user-1'); await next(); });
  instance.route('/', relayBindingsRouter);
  return instance;
}

beforeEach(() => { mockState.result = []; mockState.results = []; });

describe('relay bindings', () => {
  it('lists only model-scoped bindings', async () => {
    mockState.result = [{ id: 'binding-1', modelId: MODEL_ID, channel: 'telegram', chatRef: 'chat-1', enabled: true, createdAt: new Date() }];
    const response = await app().request(`/models/${MODEL_ID}/relay-bindings`);
    expect(response.status).toBe(200);
    expect(((await response.json()) as any).data[0]).toMatchObject({ modelId: MODEL_ID, channel: 'telegram', chatRef: 'chat-1' });
  });

  it('rejects unsupported channel names and never accepts credentials', async () => {
    const response = await app().request(`/models/${MODEL_ID}/relay-bindings`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ channel: 'smtp', chatRef: 'chat-1', token: 'secret' }),
    });
    expect(response.status).toBe(400);
  });
});
