import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';

const state = vi.hoisted(() => ({ persist: vi.fn() }));
vi.mock('@axiom/llm-gateway', () => ({
  resolveEgressBinding: vi.fn(async () => ({ mode: 'model-egress' })),
  buildEgressFetch: vi.fn(() => globalThis.fetch),
}));
vi.mock('./helpers.js', () => ({
  apiError: (c: { json: (body: unknown, status: number) => Response }, status: number, title: string, message: string) => c.json({ title, message }, status),
  modelOrgId: vi.fn(async () => '11111111-1111-4111-8111-111111111111'),
  requireOrg: vi.fn(() => '11111111-1111-4111-8111-111111111111'),
  statusTitle: (status: number) => `HTTP ${status}`,
  withOrgContext: async (_orgId: string, callback: (tx: object) => unknown) => callback({}),
}));
vi.mock('./oauth-connection.js', () => ({ persistOAuthConnection: state.persist }));

import { discordAuthRouter, effectiveDiscordChannelPermissions } from './discord-auth.js';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const MODEL_ID = '22222222-2222-4222-8222-222222222222';
const CHANNEL_ID = '12345678901234567';
const GUILD_ID = '23456789012345678';
const BOT_ID = '34567890123456789';
const REQUIRED = 1024n + 2048n + 65536n + 8192n + 4n;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function discordFetch(permissionBits = REQUIRED.toString()) {
  return vi.fn(async (input: string | URL) => {
    const url = new URL(String(input));
    if (url.pathname === '/api/v10/users/@me') return json({ id: BOT_ID, username: 'axiom-bot', bot: true });
    if (url.pathname === `/api/v10/channels/${CHANNEL_ID}`) return json({
      id: CHANNEL_ID, guild_id: GUILD_ID, type: 0, name: 'community', permission_overwrites: [],
    });
    if (url.pathname === `/api/v10/guilds/${GUILD_ID}/members/${BOT_ID}`) return json({ roles: ['role-1'] });
    if (url.pathname === `/api/v10/guilds/${GUILD_ID}/roles`) return json([
      { id: GUILD_ID, permissions: permissionBits },
      { id: 'role-1', permissions: '0' },
    ]);
    throw new Error(`unexpected Discord endpoint ${url.pathname}`);
  });
}

describe('Discord permission calculation', () => {
  it('applies everyone, combined role and member overwrites in provider order', () => {
    const result = effectiveDiscordChannelPermissions({
      guildId: GUILD_ID,
      userId: BOT_ID,
      roleIds: ['role-a', 'role-b'],
      roles: [
        { id: GUILD_ID, permissions: '3072' },
        { id: 'role-a', permissions: '0' },
        { id: 'role-b', permissions: '0' },
      ],
      overwrites: [
        { id: GUILD_ID, type: 0, allow: '0', deny: '2048' },
        { id: 'role-a', type: 0, allow: '2048', deny: '0' },
        { id: BOT_ID, type: 1, allow: '0', deny: '1024' },
      ],
    });
    expect((result & 2048n) !== 0n).toBe(true);
    expect((result & 1024n) !== 0n).toBe(false);
  });

  it('treats administrator as a channel-overwrite bypass', () => {
    const result = effectiveDiscordChannelPermissions({
      guildId: GUILD_ID, userId: BOT_ID, roleIds: ['admin'],
      roles: [{ id: GUILD_ID, permissions: '0' }, { id: 'admin', permissions: '8' }],
      overwrites: [{ id: GUILD_ID, type: 0, allow: '0', deny: '3072' }],
    });
    expect((result & 3072n).toString()).toBe('3072');
  });
});

describe('Discord bot onboarding', () => {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => { c.set('orgId', ORG_ID); c.set('userId', 'owner-1'); await next(); });
  app.route('/', discordAuthRouter);

  beforeEach(() => {
    state.persist.mockReset().mockResolvedValue({ id: '44444444-4444-4444-8444-444444444444' });
    vi.unstubAllGlobals();
  });

  it('verifies bot, guild, membership and effective channel permissions before encrypted persistence', async () => {
    const fetchMock = discordFetch();
    vi.stubGlobal('fetch', fetchMock);
    const response = await app.request('/manual', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelId: MODEL_ID, botToken: 'discord-bot-secret-token-that-is-never-returned', channelId: CHANNEL_ID }),
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { grantedOperations: string[]; [key: string]: unknown };
    expect(body).toMatchObject({ status: 'success', platform: 'discord', mode: 'bot', botUsername: 'axiom-bot' });
    expect(body.grantedOperations).toEqual(['messages.send', 'messages.read', 'comments.read', 'comments.reply', 'comments.moderate']);
    expect(JSON.stringify(body)).not.toContain('discord-bot-secret');
    expect(fetchMock.mock.calls.map(call => new URL(String(call[0])).pathname)).toEqual([
      '/api/v10/users/@me', `/api/v10/channels/${CHANNEL_ID}`,
      `/api/v10/guilds/${GUILD_ID}/members/${BOT_ID}`, `/api/v10/guilds/${GUILD_ID}/roles`,
    ]);
    expect(state.persist).toHaveBeenCalledWith(expect.objectContaining({
      modelId: MODEL_ID, platform: 'discord', actorRef: 'manual:discord-bot:owner-1',
      credentials: expect.objectContaining({
        accessToken: 'discord-bot-secret-token-that-is-never-returned',
        externalUserId: CHANNEL_ID,
        extra: expect.objectContaining({ discordBot: true, discordGuildId: GUILD_ID, discordChannelId: CHANNEL_ID }),
      }),
    }));
  });

  it('does not persist bot credentials when the verified channel denies send permission', async () => {
    vi.stubGlobal('fetch', discordFetch((1024n + 65536n).toString()));
    const response = await app.request('/manual', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelId: MODEL_ID, botToken: 'discord-bot-secret-token-that-is-never-returned', channelId: CHANNEL_ID }),
    });
    expect(response.status).toBe(422);
    expect(state.persist).not.toHaveBeenCalled();
  });

  it('rejects malformed bot tokens and channel identifiers before any provider call', async () => {
    const fetchMock = discordFetch();
    vi.stubGlobal('fetch', fetchMock);
    const response = await app.request('/manual', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelId: MODEL_ID, botToken: 'short', channelId: 'not-a-snowflake' }),
    });
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(state.persist).not.toHaveBeenCalled();
  });
});
