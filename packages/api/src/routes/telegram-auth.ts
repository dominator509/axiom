// Telegram has no user OAuth flow for bot/channel publishing. The owner adds
// a BotFather-issued bot token and target channel, which is verified through
// the selected model's egress and encrypted before any database write.

import { Hono } from 'hono';
import { z } from 'zod';
import { boundedJsonValidator as zValidator } from '../bounded-json-validator.js';
import type { AppBindings } from '../index.js';
import { buildEgressFetch, resolveEgressBinding } from '@axiom/llm-gateway';
import { readBoundedResponseJson } from '@axiom/core';
import { apiError, modelOrgId, requireOrg, statusTitle, withOrgContext } from './helpers.js';
import { persistOAuthConnection } from './oauth-connection.js';

const telegramManualSchema = z.object({
  modelId: z.string().uuid(),
  botToken: z.string().trim().min(30).max(256).regex(/^\d{5,15}:[A-Za-z0-9_-]{20,}$/),
  channelId: z.string().trim().min(2).max(64).regex(/^(?:@[A-Za-z0-9_]{5,32}|-?\d{2,20})$/),
}).strict();

type TelegramApiResponse<T> = { ok?: boolean; result?: T; description?: string; error_code?: number };
type TelegramChat = { id?: number; type?: string; title?: string; username?: string };
type TelegramBot = { id?: number; username?: string };
type TelegramMember = { status?: string; can_post_messages?: boolean };
const USER_AGENT = 'AXIOM-FanvueCRM/1.0';
const router = new Hono<AppBindings>();

router.post('/manual', zValidator('json', telegramManualSchema), async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const { modelId, botToken, channelId } = c.req.valid('json');
  if ((await withOrgContext(orgId, (tx) => modelOrgId(tx, modelId))) !== orgId) {
    return apiError(c, 404, statusTitle(404), 'model not found');
  }
  const binding = await resolveEgressBinding(modelId);
  if (!binding) return apiError(c, 503, statusTitle(503), 'Telegram onboarding requires healthy model egress');

  try {
    const egressFetch = buildEgressFetch(binding);
    const call = async <T>(method: string, body?: Record<string, unknown>): Promise<T> => {
      const response = await egressFetch(`https://api.telegram.org/bot${botToken}/${method}`, {
        method: body ? 'POST' : 'GET',
        headers: { 'user-agent': USER_AGENT, ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error('Telegram verification request failed');
      const result = await readBoundedResponseJson<TelegramApiResponse<T>>(response);
      if (result.ok !== true || result.result === undefined) throw new Error('Telegram rejected bot or channel verification');
      return result.result;
    };
    const bot = await call<TelegramBot>('getMe');
    if (!bot.id || !bot.username) return apiError(c, 422, statusTitle(422), 'Telegram token did not identify a valid bot');
    const chat = await call<TelegramChat>('getChat', { chat_id: channelId });
    if (!chat.id || !chat.type) return apiError(c, 422, statusTitle(422), 'Telegram target channel could not be verified');
    const member = await call<TelegramMember>('getChatMember', { chat_id: channelId, user_id: bot.id });
    const canPost = member.status === 'creator' || (member.status === 'administrator' && member.can_post_messages === true);
    if (!canPost) return apiError(c, 422, statusTitle(422), 'Add the bot as a channel administrator with permission to post, then retry');

    const displayName = chat.title || (chat.username ? `@${chat.username}` : `Telegram ${channelId}`);
    const connection = await persistOAuthConnection({
      orgId,
      modelId,
      platform: 'telegram',
      displayName,
      credentials: {
        accessToken: botToken,
        externalUserId: channelId,
        extra: { grantedScopes: ['telegram.sendMessage', 'telegram.sendPhoto', 'telegram.sendVideo'], telegramBotId: String(bot.id), telegramUsername: bot.username },
      },
      actorRef: `manual:telegram:${c.get('userId') ?? 'unknown'}`,
    });
    if (!connection) return apiError(c, 404, statusTitle(404), 'model not found');
    return c.json({ status: 'success', platform: 'telegram', connectionId: connection.id, displayName, botUsername: bot.username });
  } catch {
    console.error('Telegram bot/channel verification or encrypted persistence failed');
    return apiError(c, 502, statusTitle(502), 'Telegram bot/channel verification failed; no connection was stored');
  }
});

export { router as telegramAuthRouter };
