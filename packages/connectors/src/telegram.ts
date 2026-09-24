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
  SocialOperationInput,
  SocialOperationResult,
} from './types.js';
import type { Platform, PublishMode } from '@axiom/core';
import { validatePublish } from './validation.js';

const TG_API_BASE = 'https://api.telegram.org/bot';

interface TelegramMessage {
  message_id: number;
  chat: { id: number; type: string; username?: string };
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
    const canSendMessage = this.hasGrantedScope('telegram.sendMessage');
    const canSendPhoto = this.hasGrantedScope('telegram.sendPhoto');
    const canSendVideo = this.hasGrantedScope('telegram.sendVideo');
    return {
      publish: canSendMessage || canSendPhoto || canSendVideo,
      media: [
        ...(canSendPhoto ? ['image' as MediaType] : []),
        ...(canSendVideo ? ['video' as MediaType] : []),
      ],
      maxMediaBytes: 50_000_000, // 50 MB
      maxMediaCount: 1,
      caption: true,
      maxCaptionLength: 1024,
      scheduling: 'internal' as const,
      metrics: [],
      refreshMetrics: false,
      operations: this.hasGrantedScope('telegram.sendMessage') ? ['messages.send'] : [],
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
      if (input.mediaUrls.length > 1) throw new Error('Telegram supports one media item per publish request');
      const mediaUrl = input.mediaUrls[0];
      const explicitMediaType = input.options?.mediaType;
      const mediaType = explicitMediaType === 'image' || explicitMediaType === 'video' ? explicitMediaType : null;
      if (mediaType && !mediaUrl) throw new Error('Telegram media publishing requires one media URL');
      const linkUrl = typeof input.options?.linkUrl === 'string' ? input.options.linkUrl : (!mediaType ? mediaUrl : undefined);
      const captionParts = [input.caption || '', linkUrl || ''].filter(Boolean);
      const caption = captionParts.map(escapeTelegramHtml).join('\n\n');
      const hashtags = input.hashtags?.length
        ? `\n\n${input.hashtags.map((h) => `#${escapeTelegramHtml(h)}`).join(' ')}`
        : '';
      const messageBody = `${caption}${hashtags}`;
      if (messageBody.length > 1024) throw new Error('Telegram message or media caption exceeds 1024 characters');
      let response: TelegramSendResponse;
      if (mediaType && mediaUrl) {
        this.assertGrantedScope(mediaType === 'video' ? 'video publish' : 'photo publish', mediaType === 'video' ? 'telegram.sendVideo' : 'telegram.sendPhoto');
        response = await this.apiPost<TelegramSendResponse>(`${this.apiBase}/${mediaType === 'video' ? 'sendVideo' : 'sendPhoto'}`, {
          chat_id: channelId,
          [mediaType === 'video' ? 'video' : 'photo']: mediaUrl,
          caption: messageBody,
          parse_mode: 'HTML',
        });
      } else {
        this.assertGrantedScope('text publish', 'telegram.sendMessage');
        const text = messageBody;
        if (!text.trim()) throw new Error('Telegram link sharing requires a caption or content URL');
        response = await this.apiPost<TelegramSendResponse>(`${this.apiBase}/sendMessage`, {
          chat_id: channelId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: false,
        });
      }

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
        ...(response.result.chat.username ? { postUrl: `https://t.me/${response.result.chat.username}/${response.result.message_id}` } : {}),
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

  async executeOperation(operation: SocialOperationInput): Promise<SocialOperationResult> {
    if (!this.capability().operations?.includes(operation.type)) {
      throw new Error(`Telegram ${operation.type} is unavailable: required permission was not granted`);
    }
    if (operation.type !== 'messages.send') return super.executeOperation(operation);

    const recipientId = operation.recipientId.trim();
    if (!/^(?:-?\d{2,20}|@[A-Za-z0-9_]{5,32})$/.test(recipientId)) {
      throw new Error('Telegram recipient must be a chat ID or public channel username');
    }
    const text = operation.text.trim();
    if (!text || text.length > 4096) throw new Error('Telegram messages must contain 1–4096 characters');
    this.assertGrantedScope('message send', 'telegram.sendMessage');
    const response = await this.apiPost<TelegramSendResponse>(`${this.apiBase}/sendMessage`, {
      chat_id: recipientId,
      text,
      disable_web_page_preview: false,
    });
    if (!response.ok || !response.result || typeof response.result.message_id !== 'number') {
      throw new Error(`Telegram sendMessage rejected${response.error_code ? ` (${response.error_code})` : ''}: ${response.description ?? 'unknown provider error'}`);
    }
    return { type: 'mutation', success: true, remoteId: String(response.result.message_id) };
  }

  async revoke(): Promise<void> {
    // Telegram's logOut is only for moving a bot off the cloud Bot API server;
    // it is not token revocation and can disrupt other bot consumers. Disconnect
    // this model locally. Owners must rotate the bot token with BotFather to
    // invalidate it globally.
    this.botToken = '';
    this.auth.accessToken = '';
    this.auth.externalUserId = undefined;
    this.log('info', 'revoke', 'Telegram connection removed locally; remote token remains active');
  }
}
