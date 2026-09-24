import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';

const state = vi.hoisted(() => ({ persist: vi.fn(), resolveEgressBinding: vi.fn(), buildEgressFetch: vi.fn() }));
vi.mock('@axiom/llm-gateway', () => ({
  resolveEgressBinding: state.resolveEgressBinding,
  buildEgressFetch: state.buildEgressFetch,
}));
vi.mock('./helpers.js', () => ({
  apiError: (c: { json: (body: unknown, status: number) => Response }, status: number, title: string, message: string) => c.json({ title, message }, status),
  modelOrgId: vi.fn(async () => '11111111-1111-4111-8111-111111111111'),
  requireOrg: vi.fn(() => '11111111-1111-4111-8111-111111111111'),
  statusTitle: (status: number) => `HTTP ${status}`,
  withOrgContext: async (_orgId: string, callback: (tx: object) => unknown) => callback({}),
}));
vi.mock('./oauth-connection.js', () => ({ persistOAuthConnection: state.persist }));

import { telegramAuthRouter } from './telegram-auth.js';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const MODEL_ID = '22222222-2222-4222-8222-222222222222';
const CHANNEL_ID = '@creator_channel';
const BOT_ID = 345678;
const BOT_TOKEN = `${BOT_ID}:abcdefghijklmnopqrstuvwxyz_1234567890`;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function telegramFetch(canPost = true) {
  return vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === `/bot${BOT_TOKEN}/getMe`) return json({ ok: true, result: { id: BOT_ID, username: 'axiom_creator_bot' } });
    if (url.pathname === `/bot${BOT_TOKEN}/getChat`) {
      expect(init?.method).toBe('POST');
      expect(JSON.parse(String(init?.body))).toEqual({ chat_id: CHANNEL_ID });
      return json({ ok: true, result: { id: -1001234567890, type: 'channel', title: 'Creator updates' } });
    }
    if (url.pathname === `/bot${BOT_TOKEN}/getChatMember`) {
      expect(JSON.parse(String(init?.body))).toEqual({ chat_id: CHANNEL_ID, user_id: BOT_ID });
      return json({ ok: true, result: { status: 'administrator', can_post_messages: canPost } });
    }
    throw new Error(`unexpected Telegram endpoint ${url.pathname}`);
  });
}

describe('Telegram bot/channel onboarding', () => {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => { c.set('orgId', ORG_ID); c.set('userId', 'owner-1'); await next(); });
  app.route('/', telegramAuthRouter);

  beforeEach(() => {
    state.persist.mockReset().mockResolvedValue({ id: '44444444-4444-4444-8444-444444444444' });
    state.resolveEgressBinding.mockReset().mockResolvedValue({ mode: 'model-egress' });
    state.buildEgressFetch.mockReset().mockImplementation(() => globalThis.fetch);
    vi.unstubAllGlobals();
  });

  it('verifies the bot, target channel and posting permission through model egress before encrypted persistence', async () => {
    const fetchMock = telegramFetch();
    vi.stubGlobal('fetch', fetchMock);

    const response = await app.request('/manual', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelId: MODEL_ID, botToken: BOT_TOKEN, channelId: CHANNEL_ID }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ status: 'success', platform: 'telegram', displayName: 'Creator updates', botUsername: 'axiom_creator_bot' });
    expect(JSON.stringify(body)).not.toContain(BOT_TOKEN);
    expect(state.resolveEgressBinding).toHaveBeenCalledWith(MODEL_ID);
    expect(state.buildEgressFetch).toHaveBeenCalledWith({ mode: 'model-egress' });
    expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
      `/bot${BOT_TOKEN}/getMe`, `/bot${BOT_TOKEN}/getChat`, `/bot${BOT_TOKEN}/getChatMember`,
    ]);
    expect(state.persist).toHaveBeenCalledWith(expect.objectContaining({
      orgId: ORG_ID, modelId: MODEL_ID, platform: 'telegram', actorRef: 'manual:telegram:owner-1',
      credentials: expect.objectContaining({
        accessToken: BOT_TOKEN,
        externalUserId: CHANNEL_ID,
        extra: expect.objectContaining({
          grantedScopes: ['telegram.sendMessage', 'telegram.sendPhoto', 'telegram.sendVideo'],
          telegramBotId: String(BOT_ID), telegramUsername: 'axiom_creator_bot',
        }),
      }),
    }));
  });

  it('does not persist credentials when the bot is not allowed to post', async () => {
    const fetchMock = telegramFetch(false);
    vi.stubGlobal('fetch', fetchMock);

    const response = await app.request('/manual', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelId: MODEL_ID, botToken: BOT_TOKEN, channelId: CHANNEL_ID }),
    });

    expect(response.status).toBe(422);
    expect(state.persist).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('fails closed without model egress and makes no provider request', async () => {
    state.resolveEgressBinding.mockResolvedValue(null);
    const fetchMock = telegramFetch();
    vi.stubGlobal('fetch', fetchMock);

    const response = await app.request('/manual', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelId: MODEL_ID, botToken: BOT_TOKEN, channelId: CHANNEL_ID }),
    });

    expect(response.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(state.persist).not.toHaveBeenCalled();
  });

  it('rejects malformed bot tokens and channel identifiers before egress or provider calls', async () => {
    const fetchMock = telegramFetch();
    vi.stubGlobal('fetch', fetchMock);

    const response = await app.request('/manual', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelId: MODEL_ID, botToken: 'not-a-bot-token', channelId: 'invalid' }),
    });

    expect(response.status).toBe(400);
    expect(state.resolveEgressBinding).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(state.persist).not.toHaveBeenCalled();
  });
});
