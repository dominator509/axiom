import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';
import { mockDbFactory, mockState } from './test-utils.js';

const executeOperation = vi.fn();
const connectorForConnection = vi.fn();
const enqueueJob = vi.fn();
const chat = vi.fn();

vi.mock('@axiom/db', () => mockDbFactory({ modelProfile: {}, platformConnection: {}, auditLog: {}, job: {} }));
vi.mock('@axiom/worker', () => ({
  asPlatform: (value: string) => {
    if (!['x', 'instagram', 'reddit', 'tiktok'].includes(value)) throw new Error('unsupported');
    return value;
  },
  connectorForConnection: (...args: unknown[]) => connectorForConnection(...args),
  enqueueJob: (...args: unknown[]) => enqueueJob(...args),
}));
vi.mock('../roleplay-runtime.js', () => ({
  roleplayGateway: { chat: (...args: unknown[]) => chat(...args) },
  ROLEPLAY_PROVIDER_MODEL: 'grok-roleplayer',
}));

import { publicSfwFunnelRouter } from './public-sfw-funnel.js';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const MODEL_ID = '22222222-2222-4222-8222-222222222222';
const CONNECTION_ID = '33333333-3333-4333-8333-333333333333';
const INVITE_URL = 'https://discord.gg/Invite-Code';

function app(role = 'operator') {
  const instance = new Hono<AppBindings>();
  instance.use('*', async (c, next) => {
    c.set('orgId', ORG_ID);
    c.set('userId', 'operator-1');
    c.set('role', role as any);
    await next();
  });
  instance.route('/', publicSfwFunnelRouter);
  return instance;
}

function readResults(platform = 'x') {
  mockState.results.length = 0;
  mockState.results.push(
    [],
    [{ id: MODEL_ID, publicCommunityInviteUrl: INVITE_URL }],
    [{ id: CONNECTION_ID, orgId: ORG_ID, modelId: MODEL_ID, platform, status: 'connected' }],
    [], [], [], [],
  );
}

beforeEach(() => {
  mockState.result = [];
  mockState.results.length = 0;
  mockState.insertValues.length = 0;
  executeOperation.mockReset().mockResolvedValue({ type: 'comments', items: [{ id: 'comment-1', postId: 'post-1', text: 'Where can I join?' }] });
  connectorForConnection.mockReset().mockResolvedValue({
    connector: { capability: () => ({ operations: ['comments.read', 'comments.reply'] }), executeOperation },
  });
  enqueueJob.mockReset().mockResolvedValue({ id: 'job-1' });
  chat.mockReset().mockResolvedValue({ content: '{"reply":"Happy to share!","includeInvite":true}' });
});

afterEach(() => vi.restoreAllMocks());

describe('public SFW reply flow', () => {
  it('reads the selected public comment, injects the owner invite only on explicit interest and queues with human jitter', async () => {
    readResults();
    const start = Date.now();
    const response = await app().request(`/${MODEL_ID}/social-accounts/${CONNECTION_ID}/public-sfw-replies`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ postId: 'post-1', commentId: 'comment-1' }),
    });
    const body = await response.json() as { data: { jobId: string; status: string; scheduledFor: string; text: string } };
    expect(response.status, JSON.stringify(body)).toBe(202);
    expect(body.data.status).toBe('queued');
    expect(body.data.text).toContain(INVITE_URL);
    const delay = new Date(body.data.scheduledFor).getTime() - start;
    expect(delay).toBeGreaterThanOrEqual(120_000);
    expect(delay).toBeLessThanOrEqual(480_000);
    expect(executeOperation).toHaveBeenCalledWith({ type: 'comments.read', postId: 'post-1', limit: 100 });
    expect(chat.mock.calls[0]?.[0][0].content).toContain('SFW-only');
    expect(chat.mock.calls[0]?.[0][1].content).toContain('Where can I join?');
    expect(enqueueJob).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      orgId: ORG_ID, queue: 'social', kind: 'public.sfw.reply', maxAttempts: 3,
      payload: expect.objectContaining({ modelId: MODEL_ID, connectionId: CONNECTION_ID, commentId: 'comment-1', text: expect.stringContaining(INVITE_URL) }),
      dedupeParts: ['public.sfw.reply', MODEL_ID, CONNECTION_ID, 'comment-1'],
    }));
    expect(JSON.stringify(enqueueJob.mock.calls[0])).not.toContain('Where can I join?');
  });

  it('does not inject the private invite without direct community interest', async () => {
    readResults();
    chat.mockResolvedValueOnce({ content: '{"reply":"Thanks for the kind words!","includeInvite":false}' });
    const response = await app().request(`/${MODEL_ID}/social-accounts/${CONNECTION_ID}/public-sfw-replies`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ postId: 'post-1', commentId: 'comment-1' }),
    });
    expect(response.status).toBe(202);
    expect(enqueueJob.mock.calls[0]?.[1].payload.text).toBe('Thanks for the kind words!');
  });

  it('reads and saves the model-scoped invite, with owner/manager-only writes', async () => {
    mockState.results.push([], [{ id: MODEL_ID, privateInviteUrl: INVITE_URL }]);
    let response = await app().request(`/${MODEL_ID}/public-sfw-reply-settings`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { privateInviteUrl: INVITE_URL } });

    mockState.results.push([], [{ id: MODEL_ID }], [], [], []);
    response = await app('owner').request(`/${MODEL_ID}/public-sfw-reply-settings`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ privateInviteUrl: 'https://t.me/+abcDEF_123456' }),
    });
    expect(response.status).toBe(200);
    expect(mockState.updates.at(-1)).toMatchObject({ publicCommunityInviteUrl: 'https://t.me/+abcDEF_123456' });
  });

  it('rejects unsupported platforms before connector dispatch', async () => {
    readResults('tiktok');
    const response = await app().request(`/${MODEL_ID}/social-accounts/${CONNECTION_ID}/public-sfw-replies`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ postId: 'post-1', commentId: 'comment-1' }),
    });
    expect(response.status).toBe(422);
    expect(connectorForConnection).not.toHaveBeenCalled();
  });

  it('rejects denied settings changes and unsafe invite destinations before dispatch', async () => {
    let response = await app('viewer').request(`/${MODEL_ID}/public-sfw-reply-settings`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ privateInviteUrl: INVITE_URL }),
    });
    expect(response.status).toBe(403);
    response = await app('owner').request(`/${MODEL_ID}/public-sfw-reply-settings`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ privateInviteUrl: 'https://example.com' }),
    });
    expect(response.status).toBe(400);
    expect(connectorForConnection).not.toHaveBeenCalled();
    expect(chat).not.toHaveBeenCalled();
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('refuses invalid generated text and dedupe hits instead of dispatching or retrying', async () => {
    readResults();
    chat.mockResolvedValueOnce({ content: '{"reply":"This is erotic","includeInvite":false}' });
    let response = await app().request(`/${MODEL_ID}/social-accounts/${CONNECTION_ID}/public-sfw-replies`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ postId: 'post-1', commentId: 'comment-1' }),
    });
    expect(response.status).toBe(422);
    expect(enqueueJob).not.toHaveBeenCalled();
    readResults();
    enqueueJob.mockResolvedValueOnce(null);
    response = await app().request(`/${MODEL_ID}/social-accounts/${CONNECTION_ID}/public-sfw-replies`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ postId: 'post-1', commentId: 'comment-1' }),
    });
    expect(response.status).toBe(409);
  });
});
