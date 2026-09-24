// Manual Discord bot onboarding for installations that need community actions.
// Bot credentials are verified through the model's egress and encrypted by the
// same key-owning egress plane used by OAuth connections.

import { Hono } from 'hono';
import { z } from 'zod';
import { buildEgressFetch, resolveEgressBinding } from '@axiom/llm-gateway';
import { readBoundedResponseJson } from '@axiom/core';
import { boundedJsonValidator as zValidator } from '../bounded-json-validator.js';
import type { AppBindings } from '../index.js';
import { apiError, modelOrgId, requireOrg, statusTitle, withOrgContext } from './helpers.js';
import { persistOAuthConnection } from './oauth-connection.js';

const DISCORD_API = 'https://discord.com/api/v10';
const SNOWFLAKE = /^\d{16,22}$/;
const manualSchema = z.object({
  modelId: z.string().uuid(),
  botToken: z.string().trim().min(40).max(256).regex(/^[A-Za-z0-9._-]+$/),
  channelId: z.string().trim().regex(SNOWFLAKE),
}).strict();

type DiscordRole = { id?: string; permissions?: string };
type DiscordOverwrite = { id?: string; type?: number | string; allow?: string; deny?: string };
type DiscordChannel = {
  id?: string;
  guild_id?: string;
  type?: number;
  name?: string;
  permission_overwrites?: DiscordOverwrite[];
};
type DiscordMember = { roles?: string[] };
type DiscordBot = { id?: string; username?: string; bot?: boolean };

const router = new Hono<AppBindings>();

function permissionValue(value: string | undefined): bigint {
  if (!value || !/^\d+$/.test(value)) return 0n;
  try { return BigInt(value); } catch { return 0n; }
}

function applyOverwrite(bits: bigint, overwrites: DiscordOverwrite[]): bigint {
  const denied = overwrites.reduce((combined, item) => combined | permissionValue(item.deny), 0n);
  const allowed = overwrites.reduce((combined, item) => combined | permissionValue(item.allow), 0n);
  return (bits & ~denied) | allowed;
}

/** Compute Discord's effective channel permissions for the connected bot. */
export function effectiveDiscordChannelPermissions(input: {
  guildId: string;
  userId: string;
  roleIds: string[];
  roles: DiscordRole[];
  overwrites: DiscordOverwrite[];
}): bigint {
  const roles = new Map(input.roles.filter((role): role is DiscordRole & { id: string } => typeof role.id === 'string').map(role => [role.id, role]));
  const everyone = roles.get(input.guildId);
  if (!everyone) return 0n;
  let permissions = permissionValue(everyone.permissions);
  const memberRoles = new Set([input.guildId, ...input.roleIds]);
  for (const roleId of input.roleIds) permissions |= permissionValue(roles.get(roleId)?.permissions);
  const administrator = 1n << 3n;
  if ((permissions & administrator) !== 0n) return (1n << 53n) - 1n;

  const byRole = input.overwrites.filter(item => String(item.type) === '0');
  const everyoneOverwrite = byRole.filter(item => item.id === input.guildId);
  permissions = applyOverwrite(permissions, everyoneOverwrite);
  permissions = applyOverwrite(permissions, byRole.filter(item => item.id !== input.guildId && typeof item.id === 'string' && memberRoles.has(item.id)));
  permissions = applyOverwrite(permissions, input.overwrites.filter(item => String(item.type) === '1' && item.id === input.userId));
  return permissions;
}

router.post('/manual', zValidator('json', manualSchema), async c => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const { modelId, botToken, channelId } = c.req.valid('json');
  if ((await withOrgContext(orgId, tx => modelOrgId(tx, modelId))) !== orgId) return apiError(c, 404, statusTitle(404), 'model not found');
  const binding = await resolveEgressBinding(modelId);
  if (!binding) return apiError(c, 503, statusTitle(503), 'Discord bot onboarding requires healthy model egress');

  try {
    const egressFetch = buildEgressFetch(binding);
    const call = async <T>(path: string): Promise<T> => {
      const response = await egressFetch(`${DISCORD_API}${path}`, {
        headers: { authorization: `Bot ${botToken}`, 'user-agent': 'AXIOM-FanvueCRM/1.0' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error('Discord bot verification failed');
      return readBoundedResponseJson<T>(response);
    };

    const bot = await call<DiscordBot>('/users/@me');
    if (!bot.bot || !bot.id || !bot.username) return apiError(c, 422, statusTitle(422), 'Discord token did not identify a bot account');
    const channel = await call<DiscordChannel>(`/channels/${channelId}`);
    if (channel.id !== channelId || !channel.guild_id || ![0, 5].includes(channel.type ?? -1)) {
      return apiError(c, 422, statusTitle(422), 'Choose a text or announcement channel accessible to this bot');
    }
    const [member, roles] = await Promise.all([
      call<DiscordMember>(`/guilds/${channel.guild_id}/members/${bot.id}`),
      call<DiscordRole[]>(`/guilds/${channel.guild_id}/roles`),
    ]);
    const permissions = effectiveDiscordChannelPermissions({
      guildId: channel.guild_id,
      userId: bot.id,
      roleIds: member.roles ?? [],
      roles,
      overwrites: channel.permission_overwrites ?? [],
    });
    const viewChannel = (permissions & (1n << 10n)) !== 0n;
    const sendMessages = (permissions & (1n << 11n)) !== 0n;
    const readHistory = (permissions & (1n << 16n)) !== 0n;
    const manageMessages = (permissions & (1n << 13n)) !== 0n;
    const banMembers = (permissions & (1n << 2n)) !== 0n;
    if (!viewChannel || !sendMessages) return apiError(c, 422, statusTitle(422), 'Grant this bot View Channel and Send Messages in the selected channel, then retry');

    const grantedScopes = [
      'messages.send',
      ...(viewChannel && readHistory ? ['messages.read', 'comments.read', 'comments.reply'] : []),
      ...(manageMessages || banMembers ? ['comments.moderate'] : []),
    ];
    const connection = await persistOAuthConnection({
      orgId,
      modelId,
      platform: 'discord',
      displayName: `Discord ${channel.name || `channel ${channelId}`}`,
      credentials: {
        accessToken: botToken,
        externalUserId: channelId,
        extra: {
          discordBot: true,
          discordBotId: bot.id,
          discordBotUsername: bot.username,
          discordGuildId: channel.guild_id,
          discordChannelId: channelId,
          discordCanManageMessages: manageMessages,
          discordCanBanMembers: banMembers,
          grantedScopes,
        },
      },
      actorRef: `manual:discord-bot:${c.get('userId') ?? 'unknown'}`,
    });
    if (!connection) return apiError(c, 404, statusTitle(404), 'model not found');
    return c.json({ status: 'success', platform: 'discord', mode: 'bot', connectionId: connection.id, displayName: channel.name ?? null, botUsername: bot.username, grantedOperations: grantedScopes });
  } catch {
    console.error('Discord bot/channel verification or encrypted persistence failed');
    return apiError(c, 502, statusTitle(502), 'Discord bot/channel verification failed; no connection was stored');
  }
});

export { router as discordAuthRouter };
