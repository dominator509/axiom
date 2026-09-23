// ─── Discord Connector ───
// Uses Discord webhooks for link-sharing posts. Discord does not expose
// post-level metrics via webhooks, so fetchMetrics returns an empty set.

import {
  BaseConnector,
  CONNECTOR_MAX_ERROR_RESPONSE_BYTES,
  CONNECTOR_MAX_JSON_RESPONSE_BYTES,
  readResponseText,
  redactProviderText,
} from './base.js';
import type {
  SocialConnector,
  ConnectorAuth,
  ConnectorPublishInput,
  ConnectorPublishResult,
  ConnectorCapability,
  ConnectorMetrics,
  MetricPeriod,
  SocialOperationInput,
  SocialOperationResult,
  SocialOperationName,
  ValidationReport,
  MediaType,
} from './types.js';
import type { Platform, PublishMode } from '@axiom/core';
import { mediaTypeHint, validatePublish } from './validation.js';

const DISCORD_API_BASE = 'https://discord.com/api';

interface DiscordWebhookPayload {
  embeds: Array<{
    title?: string;
    description?: string;
    url?: string;
    color?: number;
    image?: { url: string };
    video?: { url: string };
    footer?: { text: string };
    timestamp?: string;
  }>;
}

interface DiscordWebhookResponse {
  id: string;
  type: number;
  channel_id: string;
  guild_id?: string;
}

export class DiscordConnector extends BaseConnector implements SocialConnector {
  constructor(auth: ConnectorAuth, fetchImpl?: typeof fetch) {
    super('discord' as Platform, 'Discord', 'link_share' as PublishMode, auth, fetchImpl);
  }

  capability(): ConnectorCapability {
    const botMode = this.auth.extra?.discordBot === true;
    const operations: SocialOperationName[] = botMode
      ? (['comments.read', 'comments.reply', 'comments.moderate', 'messages.read', 'messages.send'] as const)
        .filter(operation => this.hasGrantedScope(operation))
      : this.auth.extra?.webhookUrl && this.auth.extra?.discordChannelId ? ['messages.send'] : [];
    return {
      publish: botMode
        ? this.hasGrantedScope('messages.send')
        : typeof this.auth.extra?.webhookUrl === 'string' && typeof this.auth.extra?.discordChannelId === 'string',
      media: ['image' as MediaType, 'video' as MediaType],
      maxMediaBytes: 26_214_400, // 25 MB
      // This connector sends one embed and therefore one media item. Do not
      // advertise a larger count and silently discard the remaining URLs.
      maxMediaCount: 1,
      caption: true,
      maxCaptionLength: 2_000,
      scheduling: 'internal' as const,
      // Webhooks do not expose post-level analytics. Do not advertise metrics
      // that this connector cannot collect.
      metrics: [],
      refreshMetrics: false,
      operations: [...operations],
      moderationActions: botMode && this.hasGrantedScope('comments.moderate')
        ? [
          ...(this.auth.extra?.discordCanManageMessages === true ? ['delete' as const] : []),
          ...(this.auth.extra?.discordCanBanMembers === true ? ['block' as const] : []),
        ]
        : [],
    };
  }

  async validate(input: ConnectorPublishInput): Promise<ValidationReport> {
    return validatePublish(input, this.capability());
  }

  async publish(input: ConnectorPublishInput): Promise<ConnectorPublishResult> {
    return this.idempotentPublish(input, async () => {
      const botMode = this.auth.extra?.discordBot === true;
      const webhookUrl = typeof this.auth.extra?.webhookUrl === 'string' ? this.auth.extra.webhookUrl : undefined;
      if (!botMode && !webhookUrl) {
        throw new Error('Discord requires a webhook URL in auth.extra.webhookUrl');
      }

      const caption = input.caption || '';
      const mediaUrls = input.mediaUrls;
      const linkUrl = input.options?.linkUrl as string | undefined;

      // Build embed
      const embed: DiscordWebhookPayload['embeds'][0] = {
        title: caption.length > 256 ? caption.slice(0, 253) + '...' : caption,
        color: 0x5865f2, // Discord blurple
        timestamp: new Date().toISOString(),
        footer: { text: 'Posted via FanThynks' },
      };

      // Set the description with the full caption if it was truncated in title
      if (caption.length > 256) {
        embed.description = caption;
      }

      // Set the link URL
      if (linkUrl) {
        embed.url = linkUrl;
        embed.description = caption;
        // If title was the truncated caption, re-set it to something meaningful
        if (caption.length > 256) {
          embed.title = 'Shared via FanThynks';
        }
      }

      // Attach the first media as thumbnail/image
      if (mediaUrls.length > 0) {
        const firstMedia = mediaUrls[0];
        const mediaType = this.detectMediaType(firstMedia, mediaTypeHint(input));

        if (mediaType === 'video') {
          embed.video = { url: firstMedia };
          // Also include as image thumbnail if possible
          embed.image = { url: firstMedia };
        } else {
          embed.image = { url: firstMedia };
        }
      }

      const payload: DiscordWebhookPayload = {
        embeds: [embed],
      };

      if (botMode) {
        const channelId = String(this.auth.extra?.discordChannelId ?? '');
        if (!/^\d{16,22}$/.test(channelId) || !this.capability().publish) {
          throw new Error('Discord bot publishing is unavailable for the connected channel');
        }
        const result = await this.botRequest<{ id?: string; channel_id?: string }>(`/channels/${channelId}/messages`, 'POST', payload);
        if (!result.id || result.channel_id !== channelId) throw new Error('Discord bot returned a message for an unexpected channel');
        return { remoteId: result.id, state: 'published', postUrl: linkUrl };
      }

      // wait=true makes Discord return the created message. Even with it set,
      // handle 204 defensively because a successful webhook must never be
      // retried merely because there is no JSON response body.
      if (!webhookUrl) {
        throw new Error('Discord publish requires a webhook URL in auth.extra.webhookUrl');
      }
      const executeUrl = new URL(webhookUrl);
      executeUrl.searchParams.set('wait', 'true');
      const response = await this.fetchImpl(executeUrl.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = await readResponseText(
          response,
          CONNECTOR_MAX_ERROR_RESPONSE_BYTES,
          'provider error response',
        ).catch(() => '');
        throw new Error(
          `Discord webhook failed: HTTP ${response.status} — ${redactProviderText(body)}`,
        );
      }

      const responseBody = await readResponseText(
        response,
        CONNECTOR_MAX_JSON_RESPONSE_BYTES,
        'provider JSON response',
      ).catch(() => '');
      let result: Partial<DiscordWebhookResponse> = {};
      if (responseBody.trim().length > 0) {
        result = JSON.parse(responseBody) as DiscordWebhookResponse;
      }

      this.log('info', 'publish', `Discord webhook sent`, {
        messageId: result.id ?? null,
        channelId: result.channel_id ?? null,
        guildId: result.guild_id ?? null,
      });

      return {
        remoteId: result.id ?? null,
        state: 'published',
        postUrl: linkUrl,
      };
    });
  }

  async fetchMetrics(_remoteId: string, _period?: MetricPeriod): Promise<ConnectorMetrics> {
    // Discord webhooks do not expose post-level metrics (views, likes, comments, shares).
    // This connector uses link_share mode where analytics are handled externally.
    this.log(
      'info',
      'fetchMetrics',
      'Discord does not expose post metrics via webhooks; returning empty',
    );

    return {
      postId: _remoteId,
      platform: this.platform,
      collectedAt: new Date().toISOString(),
      metrics: {},
    };
  }

  async executeOperation(operation: SocialOperationInput): Promise<SocialOperationResult> {
    if (!this.capability().operations?.includes(operation.type)) {
      throw new Error(`Discord ${operation.type} is unavailable for this connection`);
    }

    const boundChannelId = String(this.auth.extra?.discordChannelId ?? '');
    const guildId = String(this.auth.extra?.discordGuildId ?? '');
    const botMode = this.auth.extra?.discordBot === true;
    if (operation.type === 'messages.send') {
      const text = operation.text.trim();
      if (!text || text.length > 2_000) throw new Error('Discord messages must contain 1–2000 characters');
      if (!botMode) {
        if (operation.recipientId !== boundChannelId) throw new Error('Discord webhook sends are restricted to the connected channel');
        const webhookUrl = String(this.auth.extra?.webhookUrl ?? '');
        const url = this.validatedWebhookUrl(webhookUrl);
        url.searchParams.set('wait', 'true');
        const response = await this.fetchImpl(url.toString(), {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ content: text, allowed_mentions: { parse: [] } }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new Error(`Discord webhook message failed: HTTP ${response.status}`);
        const body = await readResponseText(response, CONNECTOR_MAX_JSON_RESPONSE_BYTES, 'provider JSON response').catch(() => '');
        const id = body.trim() ? (JSON.parse(body) as { id?: string }).id : undefined;
        return { type: 'mutation', success: true, ...(id ? { remoteId: id } : {}) };
      }
      let channelId = operation.recipientId;
      if (operation.recipientId.startsWith('user:')) {
        const userId = operation.recipientId.slice('user:'.length);
        if (!/^\d{16,22}$/.test(userId)) throw new Error('Discord DM recipient must be a valid user ID');
        const dm = await this.botRequest<{ id?: string }>('/users/@me/channels', 'POST', { recipient_id: userId });
        if (!dm.id || !/^\d{16,22}$/.test(dm.id)) throw new Error('Discord did not return a valid DM channel');
        channelId = dm.id;
      } else if (channelId !== boundChannelId || !/^\d{16,22}$/.test(channelId)) {
        throw new Error('Discord bot channel sends are restricted to the connected channel; use user:<id> for a DM');
      }
      const result = await this.botRequest<{ id?: string; channel_id?: string }>(`/channels/${channelId}/messages`, 'POST', {
        content: text,
        allowed_mentions: { parse: [] },
      });
      if (!result.id || result.channel_id !== channelId) throw new Error('Discord bot returned a message for an unexpected channel');
      return { type: 'mutation', success: true, remoteId: result.id };
    }

    if (!botMode) throw new Error(`Discord webhook connection does not support ${operation.type}`);
    if (!/^\d{16,22}$/.test(boundChannelId)) throw new Error('Discord bot connection has no verified channel');

    if (operation.type === 'comments.read') {
      if (operation.postId !== boundChannelId) throw new Error('Discord comment reads are restricted to the connected channel');
      const limit = operation.limit ?? 50;
      const query = new URLSearchParams({ limit: String(limit), ...(operation.cursor ? { before: operation.cursor } : {}) });
      const rows = await this.botRequest<Array<{ id?: string; content?: string; timestamp?: string; author?: { id?: string; username?: string } }>>(
        `/channels/${boundChannelId}/messages?${query}`,
      );
      const items = rows.filter(row => typeof row.id === 'string' && typeof row.content === 'string').map(row => ({
        id: row.id!, postId: boundChannelId, text: row.content!,
        ...(row.author?.username ? { authorName: row.author.username } : {}),
        ...(row.timestamp ? { createdAt: row.timestamp } : {}),
        permalink: `https://discord.com/channels/${guildId}/${boundChannelId}/${row.id}`,
      }));
      return { type: 'comments', items, ...(rows.length === limit && rows.at(-1)?.id ? { nextCursor: rows.at(-1)!.id } : {}) };
    }

    if (operation.type === 'messages.read') {
      const conversationId = operation.conversationId ?? boundChannelId;
      if (!/^\d{16,22}$/.test(conversationId)) throw new Error('Discord conversation ID is invalid');
      const limit = operation.limit ?? 50;
      const query = new URLSearchParams({ limit: String(limit), ...(operation.cursor ? { before: operation.cursor } : {}) });
      const rows = await this.botRequest<Array<{ id?: string; content?: string; timestamp?: string; author?: { id?: string } }>>(
        `/channels/${conversationId}/messages?${query}`,
      );
      const items = rows.filter(row => typeof row.id === 'string' && typeof row.content === 'string').map(row => ({
        id: row.id!, conversationId, senderId: row.author?.id ?? 'unknown', text: row.content!,
        ...(row.timestamp ? { createdAt: row.timestamp } : {}),
      }));
      return { type: 'messages', items, ...(rows.length === limit && rows.at(-1)?.id ? { nextCursor: rows.at(-1)!.id } : {}) };
    }

    if (operation.type === 'comments.reply') {
      if (!/^\d{16,22}$/.test(operation.commentId)) throw new Error('Discord comment ID is invalid');
      const text = operation.text.trim();
      if (!text || text.length > 2_000) throw new Error('Discord replies must contain 1–2000 characters');
      const result = await this.botRequest<{ id?: string; channel_id?: string }>(`/channels/${boundChannelId}/messages`, 'POST', {
        content: text,
        message_reference: { message_id: operation.commentId, channel_id: boundChannelId, fail_if_not_exists: true },
        allowed_mentions: { parse: [] },
      });
      if (!result.id || result.channel_id !== boundChannelId) throw new Error('Discord bot returned a reply for an unexpected channel');
      return { type: 'mutation', success: true, remoteId: result.id };
    }

    if (operation.type === 'comments.moderate') {
      if (operation.action === 'delete') {
        if (this.auth.extra?.discordCanManageMessages !== true) throw new Error('Discord message deletion requires Manage Messages');
        await this.botRequest(`/channels/${boundChannelId}/messages/${operation.commentId}`, 'DELETE');
        return { type: 'mutation', success: true, remoteId: operation.commentId };
      }
      if (operation.action === 'block') {
        if (this.auth.extra?.discordCanBanMembers !== true) throw new Error('Discord member bans require Ban Members');
        const message = await this.botRequest<{ author?: { id?: string } }>(`/channels/${boundChannelId}/messages/${operation.commentId}`);
        const userId = message.author?.id;
        if (!userId || !/^\d{16,22}$/.test(userId)) throw new Error('Discord message has no valid author to block');
        await this.botRequest(`/guilds/${guildId}/bans/${userId}`, 'PUT', { delete_message_seconds: 0 });
        return { type: 'mutation', success: true, remoteId: userId };
      }
      throw new Error(`Discord does not support the ${operation.action} moderation action`);
    }

    return super.executeOperation(operation);
  }

  private validatedWebhookUrl(value: string): URL {
    let url: URL;
    try { url = new URL(value); } catch { throw new Error('Discord webhook URL is invalid'); }
    if (url.protocol !== 'https:' || url.hostname !== 'discord.com' || url.username || url.password || !/^\/api\/webhooks\/\d+\/[A-Za-z0-9._-]+$/.test(url.pathname)) {
      throw new Error('Discord webhook URL is outside the allowed provider origin');
    }
    url.search = '';
    url.hash = '';
    return url;
  }

  private async botRequest<T>(path: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET', body?: unknown): Promise<T> {
    const response = await this.fetchImpl(`${DISCORD_API_BASE}/v10${path}`, {
      method,
      headers: { authorization: `Bot ${this.auth.accessToken}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      await readResponseText(response, CONNECTOR_MAX_ERROR_RESPONSE_BYTES, 'provider error response').catch(() => '');
      throw new Error(`Discord bot operation failed: HTTP ${response.status}`);
    }
    const text = await readResponseText(response, CONNECTOR_MAX_JSON_RESPONSE_BYTES, 'provider JSON response').catch(() => '');
    if (!text.trim()) return {} as T;
    try { return JSON.parse(text) as T; } catch { throw new Error('Discord bot returned invalid JSON'); }
  }

  async revoke(): Promise<void> {
    if (this.auth.extra?.discordBot === true) {
      // Bot tokens are rotated in Discord's developer portal, not remotely
      // revoked by a channel integration. Disconnect removes only this local
      // encrypted model connection.
      this.auth.accessToken = '';
      this.auth.externalUserId = undefined;
      this.auth.extra = {};
      this.log('info', 'revoke', 'Discord bot connection removed locally; rotate the bot token in Discord to revoke it globally');
      return;
    }
    const webhookUrl = this.auth.extra?.webhookUrl as string | undefined;
    if (!webhookUrl) {
      throw new Error('Discord revoke requires a webhook URL in auth.extra.webhookUrl');
    }

    // Delete Webhook with Token is the unauthenticated endpoint for an
    // incoming webhook. The ID-only endpoint requires MANAGE_WEBHOOKS.
    let webhook: URL;
    try {
      webhook = new URL(webhookUrl);
    } catch {
      throw new Error('Discord revoke requires a valid webhook URL');
    }
    const match = webhook.pathname.match(/\/webhooks\/(\d+)\/([^/]+)$/);
    if (!match) {
      throw new Error('Discord revoke requires a webhook URL containing an ID and token');
    }

    const webhookId = match[1];
    const webhookToken = decodeURIComponent(match[2]);

    // Delete the webhook via Discord API
    const response = await this.fetchImpl(
      `${DISCORD_API_BASE}/webhooks/${webhookId}/${encodeURIComponent(webhookToken)}`,
      {
        method: 'DELETE',
      },
    );

    if (!response.ok) {
      const body = await readResponseText(
        response,
        CONNECTOR_MAX_ERROR_RESPONSE_BYTES,
        'provider error response',
      ).catch(() => '');
      throw new Error(
        `Discord webhook deletion failed: HTTP ${response.status} — ${redactProviderText(body)}`,
      );
    } else {
      this.log('info', 'revoke', `Discord webhook ${webhookId} deleted successfully`);
    }

    // Clear cached auth data
    this.auth.accessToken = '';
    this.auth.refreshToken = undefined;
    this.auth.expiresAt = 0;
  }

  /** Detect media type from URL extension */
  private detectMediaType(url: string, declared?: MediaType): 'image' | 'video' {
    if (declared === 'video') return 'video';
    if (declared === 'image') return 'image';

    try {
      const pathname = new URL(url).pathname;
      const ext = pathname.split('.').pop()?.toLowerCase() ?? '';
      const videoExts = new Set(['mp4', 'mov', 'webm', 'avi', 'mkv', 'm4v']);
      return videoExts.has(ext) ? 'video' : 'image';
    } catch {
      return 'image';
    }
  }
}

export default DiscordConnector;
