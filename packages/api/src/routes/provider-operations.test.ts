import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';
import { mockDbFactory, mockState } from './test-utils.js';

const executeOperation = vi.fn();
const connectorForConnection = vi.fn();
const resolveProviderAssetUrl = vi.fn();
let connectorCapability: { operations: string[]; moderationActions?: string[] };

vi.mock('@axiom/db', () => mockDbFactory({ platformConnection: {}, asset: {} }));
vi.mock('@axiom/worker', () => ({
  connectorForConnection: (...args: unknown[]) => connectorForConnection(...args),
  resolveProviderAssetUrl: (...args: unknown[]) => resolveProviderAssetUrl(...args),
}));

import { providerOperationsRouter } from './provider-operations.js';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const MODEL_ID = '22222222-2222-4222-8222-222222222222';
const CONNECTION_ID = '33333333-3333-4333-8333-333333333333';

function app() {
  const instance = new Hono<AppBindings>();
  instance.use('*', async (c, next) => {
    c.set('orgId', ORG_ID);
    c.set('userId', 'operator-1');
    await next();
  });
  instance.route('/', providerOperationsRouter);
  return instance;
}

beforeEach(() => {
  connectorCapability = { operations: ['comments.read'] };
  mockState.results.length = 0;
  mockState.result = [{ id: CONNECTION_ID, orgId: ORG_ID, modelId: MODEL_ID, platform: 'instagram', status: 'connected' }];
  executeOperation.mockReset().mockResolvedValue({ type: 'comments', items: [{ id: 'c1', postId: 'p1', text: 'Hello' }] });
  resolveProviderAssetUrl.mockReset().mockReturnValue('https://media.example.test/signed/asset');
  connectorForConnection.mockReset().mockResolvedValue({
    connector: { capability: () => connectorCapability, executeOperation },
  });
});

afterEach(() => vi.restoreAllMocks());

describe('model-scoped provider operations', () => {
  it('dispatches only an advertised operation on the selected model connection', async () => {
    const response = await app().request(`/${MODEL_ID}/social-accounts/${CONNECTION_ID}/operations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'comments.read', postId: 'p1' }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { type: 'comments', items: [{ id: 'c1', postId: 'p1', text: 'Hello' }] } });
    expect(connectorForConnection).toHaveBeenCalledWith(expect.objectContaining({ id: CONNECTION_ID, modelId: MODEL_ID, orgId: ORG_ID }));
    expect(executeOperation).toHaveBeenCalledWith({ type: 'comments.read', postId: 'p1' });
  });

  it('refuses an operation that was not granted to the connection', async () => {
    const response = await app().request(`/${MODEL_ID}/social-accounts/${CONNECTION_ID}/operations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'messages.send', recipientId: 'user-1', text: 'hello' }),
    });
    expect(response.status).toBe(403);
    expect(executeOperation).not.toHaveBeenCalled();
  });

  it('refuses a moderation action not explicitly advertised by the connection', async () => {
    connectorCapability = { operations: ['comments.moderate'], moderationActions: ['delete'] };
    const response = await app().request(`/${MODEL_ID}/social-accounts/${CONNECTION_ID}/operations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'comments.moderate', commentId: 'c1', action: 'hide' }),
    });
    expect(response.status).toBe(403);
    expect(executeOperation).not.toHaveBeenCalled();
  });

  it('dispatches an explicitly advertised moderation action', async () => {
    connectorCapability = { operations: ['comments.moderate'], moderationActions: ['delete'] };
    executeOperation.mockResolvedValueOnce({ type: 'mutation', success: true, remoteId: 'c1' });
    const response = await app().request(`/${MODEL_ID}/social-accounts/${CONNECTION_ID}/operations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'comments.moderate', commentId: 'c1', action: 'delete' }),
    });
    expect(response.status).toBe(200);
    expect(executeOperation).toHaveBeenCalledWith({ type: 'comments.moderate', commentId: 'c1', action: 'delete' });
  });

  it('dispatches a scope-advertised Fanvue vault operation through the model connection', async () => {
    connectorCapability = { operations: ['vault.folders.read'] };
    const data = {
      type: 'vault.folders',
      items: [{ name: 'My Photos', createdAt: null, mediaCount: 2 }],
      pagination: { page: 1, size: 15, hasMore: false },
    };
    executeOperation.mockResolvedValueOnce(data);
    mockState.result = [{ id: CONNECTION_ID, orgId: ORG_ID, modelId: MODEL_ID, platform: 'fanvue', status: 'connected' }];
    const response = await app().request(`/${MODEL_ID}/social-accounts/${CONNECTION_ID}/operations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'vault.folders.read', page: 1, size: 15 }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data });
    expect(executeOperation).toHaveBeenCalledWith({ type: 'vault.folders.read', page: 1, size: 15 });
  });

  it('rejects malformed Fanvue vault mutations before dispatch', async () => {
    connectorCapability = { operations: ['vault.media.update'] };
    const response = await app().request(`/${MODEL_ID}/social-accounts/${CONNECTION_ID}/operations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'vault.media.update', folderName: 'My Photos', mediaUuid: 'bad-id' }),
    });
    expect(response.status).toBe(400);
    expect(executeOperation).not.toHaveBeenCalled();
  });

  it('does not use a connection belonging to another model', async () => {
    mockState.result = [];
    const response = await app().request(`/${MODEL_ID}/social-accounts/${CONNECTION_ID}/operations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'comments.read', postId: 'p1' }),
    });
    expect(response.status).toBe(404);
    expect(connectorForConnection).not.toHaveBeenCalled();
  });

  it('resolves YouTube upload assets from the selected model instead of accepting caller URLs', async () => {
    connectorCapability = { operations: ['youtube.thumbnail.set'] };
    mockState.results.push(
      [],
      [{ id: CONNECTION_ID, orgId: ORG_ID, modelId: MODEL_ID, platform: 'youtube', status: 'connected' }],
      [],
      [{ id: '44444444-4444-4444-8444-444444444444', storageKey: 'models/test/thumb.jpg', mimeType: 'image/jpeg', fileSize: 1024 }],
    );
    executeOperation.mockResolvedValueOnce({ type: 'mutation', success: true, remoteId: 'video-1' });

    const response = await app().request(`/${MODEL_ID}/social-accounts/${CONNECTION_ID}/operations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'youtube.thumbnail.set',
        videoId: 'video-1',
        assetId: '44444444-4444-4444-8444-444444444444',
      }),
    });

    expect(response.status, await response.clone().text()).toBe(200);
    expect(resolveProviderAssetUrl).toHaveBeenCalledWith(expect.objectContaining({ storageKey: 'models/test/thumb.jpg' }));
    expect(executeOperation).toHaveBeenCalledWith({
      type: 'youtube.thumbnail.set',
      videoId: 'video-1',
      mediaUrl: 'https://media.example.test/signed/asset',
      mimeType: 'image/jpeg',
    });
  });

  it('rejects caller-supplied media URLs for YouTube operations', async () => {
    connectorCapability = { operations: ['youtube.thumbnail.set'] };
    const response = await app().request(`/${MODEL_ID}/social-accounts/${CONNECTION_ID}/operations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'youtube.thumbnail.set',
        videoId: 'video-1',
        assetId: '44444444-4444-4444-8444-444444444444',
        mediaUrl: 'http://127.0.0.1/admin',
      }),
    });
    expect(response.status).toBe(400);
    expect(resolveProviderAssetUrl).not.toHaveBeenCalled();
    expect(executeOperation).not.toHaveBeenCalled();
  });
});
