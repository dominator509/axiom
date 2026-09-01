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

const TG_API_BASE = 'https://api.telegram.org/bot';

interface TelegramMessage {
  message_id: number;
  chat: { id: number; type: string };
  text?: string;
}

interface TelegramSendResponse {
  ok: boolean;
  result: TelegramMessage;
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
    const errors = [];

    if (!input.mediaUrls || input.mediaUrls.length === 0) {
      errors.push({
        field: 'mediaUrls',
        message: 'At least one media URL required for link share',
        severity: 'error' as const,
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings: [],
      infos: [],
      tosVerdict: 'pass' as const,
    };
  }

  async publish(input: ConnectorPublishInput): Promise<ConnectorPublishResult> {
    return this.idempotentPublish(input, async () => {
      const channelId = this.auth.externalUserId || '@channel';
      const linkUrl = input.mediaUrls[0];
      const caption = input.caption || '';

      // Post content link with preview to Telegram channel
      const text = `${caption}\n\n${linkUrl}`;
      const hashtags = input.hashtags?.length
        ? `\n\n${input.hashtags.map((h) => `#${h}`).join(' ')}`
        : '';

      const response = await this.apiPost<TelegramSendResponse>(`${this.apiBase}/sendMessage`, {
        chat_id: channelId,
        text: text + hashtags,
        parse_mode: 'HTML',
        disable_web_page_preview: false,
      });

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
    await this.apiPost(`${this.apiBase}/logOut`, {});
    this.log('info', 'revoke', 'Telegram bot logged out');
  }
}
