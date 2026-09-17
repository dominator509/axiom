// ─── Telegram Connector (link_share) ───
// Uses a Telegram bot to post content links with previews

import { BaseConnector } from './base.js';
import type {
  SocialConnector,
  ConnectorAuth,
  ConnectorPublishInput,
  ConnectorPublishResult,
  ConnectorCapability,
  ConnectorMetrics,
  MetricPeriod,
  ValidationReport,
  MediaType,
} from './types.js';
import type { Platform, PublishMode } from '@axiom/core';
import { validatePublish } from './validation.js';

const TG_API_BASE = 'https://api.telegram.org/bot';

interface TelegramMessage {
  message_id: number;
  chat: { id: number; type: string };
  text?: string;
}

interface TelegramSendResponse {
  ok: boolean;
  result?: TelegramMessage;
  description?: string;
  error_code?: number;
}

function escapeTelegramHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export class TelegramConnector extends BaseConnector implements SocialConnector {
  private botToken: string;

  constructor(auth: ConnectorAuth, fetchImpl?: typeof fetch) {
    super('telegram' as Platform, 'Telegram', 'link_share' as PublishMode, auth, fetchImpl);
    this.botToken = auth.accessToken;
  }

  private get apiBase(): string {
    return `${TG_API_BASE}${this.botToken}`;
  }

  capability(): ConnectorCapability {
    return {
      publish: true,
      media: ['image' as MediaType, 'video' as MediaType],
      maxMediaBytes: 50_000_000, // 50 MB
      maxMediaCount: 1,
      caption: true,
      maxCaptionLength: 1024,
      scheduling: 'internal' as const,
      metrics: [],
      refreshMetrics: false,
    };
  }

  async validate(input: ConnectorPublishInput): Promise<ValidationReport> {
    return validatePublish(input, this.capability());
  }

  async publish(input: ConnectorPublishInput): Promise<ConnectorPublishResult> {
    return this.idempotentPublish(input, async () => {
      const channelId = this.auth.externalUserId?.trim();
      if (!channelId) {
        throw new Error('Telegram externalUserId (channel ID or username) is required');
      }
      const linkUrl = input.mediaUrls[0];
      const caption = input.caption || '';
      if (!linkUrl) throw new Error('Telegram requires a media URL for link sharing');

      // Post content link with preview to Telegram channel
      const text = `${escapeTelegramHtml(caption)}\n\n${escapeTelegramHtml(linkUrl)}`;
      const hashtags = input.hashtags?.length
        ? `\n\n${input.hashtags.map((h) => `#${escapeTelegramHtml(h)}`).join(' ')}`
        : '';

      const response = await this.apiPost<TelegramSendResponse>(`${this.apiBase}/sendMessage`, {
        chat_id: channelId,
        text: text + hashtags,
        parse_mode: 'HTML',
        disable_web_page_preview: false,
      });

      if (!response.ok || !response.result || typeof response.result.message_id !== 'number') {
        throw new Error(
          `Telegram sendMessage rejected${response.error_code ? ` (${response.error_code})` : ''}: ${response.description ?? 'unknown provider error'}`,
        );
      }

      this.log(
        'info',
        'publish',
        `Telegram link shared to ${channelId}: msg ${response.result.message_id}`,
      );

      return {
        remoteId: String(response.result.message_id),
        state: 'published',
        postUrl: `https://t.me/${channelId.replace('@', '')}/${response.result.message_id}`,
      };
    });
  }

  async fetchMetrics(_remoteId: string, _period?: MetricPeriod): Promise<ConnectorMetrics> {
    // Telegram Bot API does not expose per-message analytics
    return {
      postId: _remoteId,
      platform: 'telegram' as Platform,
      collectedAt: new Date().toISOString(),
      metrics: {},
    };
  }

  async revoke(): Promise<void> {
    // Revoke bot token via Telegram API
    const response = await this.apiPost<TelegramSendResponse>(`${this.apiBase}/logOut`, {});
    if (!response.ok) {
      throw new Error(
        `Telegram logOut rejected${response.error_code ? ` (${response.error_code})` : ''}: ${response.description ?? 'unknown provider error'}`,
      );
    }
    this.log('info', 'revoke', 'Telegram bot logged out');
  }
}
