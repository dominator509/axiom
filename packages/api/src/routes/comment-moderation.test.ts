import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';
import { mockDbFactory, mockState } from './test-utils.js';

vi.mock('@axiom/db', () => mockDbFactory({
  commentModerationRule: {}, commentModerationAction: {}, platformConnection: {},
}));
vi.mock('@axiom/worker', () => ({ asPlatform: vi.fn(value => value), connectorForConnection: vi.fn() }));

import { connectorForConnection } from '@axiom/worker';
import { commentModerationRouter } from './comment-moderation.js';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const MODEL_ID = '22222222-2222-4222-8222-222222222222';
const CONNECTION_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = 'operator-1';
const connection = { id: CONNECTION_ID, orgId: ORG_ID, modelId: MODEL_ID, platform: 'instagram', status: 'connected' };
const rule = { id: 'rule-1', orgId: ORG_ID, modelId: MODEL_ID, platform: 'instagram', action: 'hide', keywords: ['spam'], enabled: true };
const action = { id: 'action-1', ruleId: 'rule-1', providerCommentId: 'comment-1', matchedKeywordCount: 1 };

function app(role = 'owner') {
  const server = new Hono<AppBindings>();
  server.use('*', async (c, next) => {
    c.set('orgId', ORG_ID);
    c.set('userId', USER_ID);
    c.set('role', role as never);
    await next();
  });
  server.route('/', commentModerationRouter);
  return server;
}

function connector(moderationActions = ['hide', 'block'], mutationFails = false, nextCursor?: string) {
  return {
    capability: () => ({ operations: ['comments.read', 'comments.moderate'], moderationActions }),
    executeOperation: vi.fn(async (operation: { type: string; action?: string }) => {
      if (operation.type === 'comments.read') return { type: 'comments', items: [{ id: 'comment-1', text: 'This is SPAM' }], ...(nextCursor ? { nextCursor } : {}) };
      if (mutationFails) throw new Error('provider response is uncertain');
      return { type: 'mutation', success: true, remoteId: 'comment-1' };
    }),
  };
}

beforeEach(() => {
  mockState.result = [];
  mockState.results = [];
  mockState.insertValues = [];
  mockState.updates = [];
  mockState.conflictUpdates = [];
  vi.mocked(connectorForConnection).mockReset();
});

afterEach(() => vi.restoreAllMocks());

describe('keyword comment moderation flow', () => {
  it('reads provider comments, matches literal keywords, applies supported actions and stores no comment text', async () => {
    const provider = connector();
    vi.mocked(connectorForConnection).mockResolvedValue({ connector: provider } as never);
    mockState.results = [[], [{ orgId: ORG_ID }], [connection], [rule], [], [action], [], [], []];

    const response = await app().request(`/models/${MODEL_ID}/moderation/scan`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ connectionId: CONNECTION_ID, postId: 'post-1' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { scanned: 1, matched: 1, moderated: 1, partial: 0, unknown: 0 } });
    expect(provider.executeOperation).toHaveBeenNthCalledWith(1, { type: 'comments.read', postId: 'post-1', cursor: undefined, limit: 100 });
    expect(provider.executeOperation).toHaveBeenNthCalledWith(2, { type: 'comments.moderate', commentId: 'comment-1', action: 'hide' });
    expect(mockState.insertValues[0]).toEqual([expect.objectContaining({
      orgId: ORG_ID, modelId: MODEL_ID, connectionId: CONNECTION_ID, providerCommentId: 'comment-1', matchedKeywordCount: 1,
    })]);
    expect(JSON.stringify(mockState.insertValues)).not.toContain('This is SPAM');
    expect(mockState.updates[0]).toMatchObject({ status: 'applied' });
  });

  it('records uncertain provider results without retrying the same comment automatically', async () => {
    const provider = connector(['hide'], true);
    vi.mocked(connectorForConnection).mockResolvedValue({ connector: provider } as never);
    mockState.results = [[], [{ orgId: ORG_ID }], [connection], [rule], [], [action], [], [], []];

    const response = await app().request(`/models/${MODEL_ID}/moderation/scan`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ connectionId: CONNECTION_ID, postId: 'post-1' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { moderated: 0, unknown: 1 } });
    expect(mockState.updates[0]).toMatchObject({ status: 'unknown' });
    expect(provider.executeOperation).toHaveBeenCalledTimes(2);
  });

  it('forwards the provider cursor and returns the next page cursor for continuation', async () => {
    const provider = connector(['hide'], false, 'provider-cursor-page-3');
    vi.mocked(connectorForConnection).mockResolvedValue({ connector: provider } as never);
    mockState.results = [[], [{ orgId: ORG_ID }], [connection], [rule], [], []];

    const response = await app().request(`/models/${MODEL_ID}/moderation/scan`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ connectionId: CONNECTION_ID, postId: 'post-1', cursor: 'provider-cursor-page-2' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { scanned: 1, nextCursor: 'provider-cursor-page-3' } });
    expect(provider.executeOperation).toHaveBeenNthCalledWith(1, {
      type: 'comments.read', postId: 'post-1', cursor: 'provider-cursor-page-2', limit: 100,
    });
  });

  it('does not start hide-and-block when the connector only grants hide', async () => {
    const provider = connector(['hide']);
    vi.mocked(connectorForConnection).mockResolvedValue({ connector: provider } as never);
    mockState.results = [[], [{ orgId: ORG_ID }], [connection], [{ ...rule, action: 'hide_and_block' }]];

    const response = await app().request(`/models/${MODEL_ID}/moderation/scan`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ connectionId: CONNECTION_ID, postId: 'post-1' }),
    });

    expect(response.status).toBe(422);
    expect(provider.executeOperation).not.toHaveBeenCalled();
  });

  it('keeps moderation mutation owner/operator gated', async () => {
    const response = await app('model').request(`/models/${MODEL_ID}/moderation/scan`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ connectionId: CONNECTION_ID, postId: 'post-1' }),
    });
    expect(response.status).toBe(403);
    expect(mockState.results).toEqual([]);
  });
});
