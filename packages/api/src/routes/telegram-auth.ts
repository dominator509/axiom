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

class TelegramSetupError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

router.post('/manual', zValidator('json', telegramManualSchema), async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const { modelId, botToken, channelId } = c.req.valid('json');
  if ((await withOrgContext(orgId, (tx) => modelOrgId(tx, modelId))) !== orgId) {
    return apiError(c, 404, statusTitle(404), 'model not found');
  }
  const binding = await resolveEgressBinding(modelId);
  if (!binding) {
    return apiError(c, 503, statusTitle(503), 'Telegram setup requires healthy model egress', {
      code: 'TELEGRAM_EGRESS_UNAVAILABLE',
    });
  }

  try {
    const egressFetch = buildEgressFetch(binding);
    const call = async <T>(method: string, body?: Record<string, unknown>): Promise<T> => {
      const response = await egressFetch(`https://api.telegram.org/bot${botToken}/${method}`, {
        method: body ? 'POST' : 'GET',
        headers: { 'user-agent': USER_AGENT, ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        if (method === 'getMe' && response.status === 401) {
          throw new TelegramSetupError(422, 'TELEGRAM_BOT_TOKEN_INVALID', 'Telegram rejected this bot token');
        }
        if (method === 'getChat' && [400, 404].includes(response.status)) {
          throw new TelegramSetupError(422, 'TELEGRAM_TARGET_INVALID', 'Telegram could not find this channel or the bot cannot access it');
        }
        if (method === 'getChatMember' && [400, 403].includes(response.status)) {
          throw new TelegramSetupError(422, 'TELEGRAM_BOT_CANNOT_POST', 'Add the bot as a channel administrator with permission to post, then try again');
        }
        throw new TelegramSetupError(503, 'TELEGRAM_PROVIDER_UNAVAILABLE', 'Telegram could not be reached; try again shortly');
      }
      let result: TelegramApiResponse<T>;
      try {
        result = await readBoundedResponseJson<TelegramApiResponse<T>>(response);
      } catch {
        throw new TelegramSetupError(503, 'TELEGRAM_PROVIDER_UNAVAILABLE', 'Telegram returned an unreadable verification response');
      }
      if (result.ok !== true || result.result === undefined) {
        if (method === 'getMe') {
          throw new TelegramSetupError(422, 'TELEGRAM_BOT_TOKEN_INVALID', 'Telegram rejected this bot token');
        }
        if (method === 'getChat') {
          throw new TelegramSetupError(422, 'TELEGRAM_TARGET_INVALID', 'Telegram could not find this channel or the bot cannot access it');
        }
        throw new TelegramSetupError(422, 'TELEGRAM_BOT_CANNOT_POST', 'Add the bot as a channel administrator with permission to post, then try again');
      }
      return result.result;
    };
    const bot = await call<TelegramBot>('getMe');
    if (!bot.id || !bot.username) {
      throw new TelegramSetupError(422, 'TELEGRAM_BOT_TOKEN_INVALID', 'Telegram token did not identify a valid bot');
    }
    if (channelId.replace(/^@/, '').toLowerCase() === bot.username.toLowerCase()) {
      throw new TelegramSetupError(
        422,
        'TELEGRAM_TARGET_IS_BOT',
        'This is the bot username. Enter the destination channel username or numeric channel ID instead',
      );
    }
    const chat = await call<TelegramChat>('getChat', { chat_id: channelId });
    if (typeof chat.id !== 'number' || !chat.type) {
      throw new TelegramSetupError(422, 'TELEGRAM_TARGET_INVALID', 'Telegram could not verify this destination');
    }
    if (chat.type !== 'channel') {
      throw new TelegramSetupError(422, 'TELEGRAM_TARGET_NOT_CHANNEL', 'Choose a Telegram channel as the destination');
    }
    const member = await call<TelegramMember>('getChatMember', { chat_id: channelId, user_id: bot.id });
    const canPost = member.status === 'creator' || (member.status === 'administrator' && member.can_post_messages === true);
    if (!canPost) {
      throw new TelegramSetupError(422, 'TELEGRAM_BOT_CANNOT_POST', 'Add the bot as a channel administrator with permission to post, then try again');
    }

    const displayName = chat.title || (chat.username ? `@${chat.username}` : `Telegram ${channelId}`);
    const connection = await persistOAuthConnection({
      orgId,
      modelId,
      platform: 'telegram',
      displayName,
      credentials: {
        accessToken: botToken,
        externalUserId: String(chat.id),
        extra: {
          grantedScopes: ['telegram.sendMessage', 'telegram.sendPhoto', 'telegram.sendVideo'],
          telegramBotId: String(bot.id),
          telegramUsername: bot.username,
          telegramChatId: String(chat.id),
          telegramInputRef: channelId,
          ...(chat.username ? { telegramChannelUsername: `@${chat.username}` } : {}),
        },
      },
      actorRef: `manual:telegram:${c.get('userId') ?? 'unknown'}`,
    });
    if (!connection) return apiError(c, 404, statusTitle(404), 'model not found');
    return c.json({ status: 'success', platform: 'telegram', connectionId: connection.id, displayName, botUsername: bot.username, channelId: String(chat.id) });
  } catch (error) {
    if (error instanceof TelegramSetupError) {
      return apiError(c, error.status, statusTitle(error.status), error.message, { code: error.code });
    }
    console.error('Telegram bot/channel verification or encrypted persistence failed');
    return apiError(c, 502, statusTitle(502), 'Telegram setup failed; check the bot, destination, and egress configuration', {
      code: 'TELEGRAM_SETUP_FAILED',
    });
  }
});

export { router as telegramAuthRouter };
