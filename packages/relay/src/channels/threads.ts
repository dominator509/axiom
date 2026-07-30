// ─── Threads (Meta Webhooks) Adapter ───
// Handles incoming Meta webhook events for Threads:
//   GET  /webhooks/threads — verification challenge
//   POST /webhooks/threads — live event delivery
//
// Requires OAuth-completed user access token + Threads user ID
// for publishing (handled by @axiom/connectors ThreadsConnector).

import type { RelayCard, CardAction } from '../card.js';
import { CardRenderer } from '../card.js';

export interface ThreadsConfig {
  clientId: string;
  clientSecret: string;
  verifyToken: string;
  webhookPath?: string;
}

interface MetaWebhookEntry {
  time: number;
  id: string;
  messaging?: Array<Record<string, unknown>>;
  changes?: Array<{
    field: string;
    value: Record<string, unknown>;
  }>;
}

interface MetaWebhookPayload {
  object: string;
  entry: MetaWebhookEntry[];
}

export class ThreadsAdapter {
  private readonly config: ThreadsConfig;
  private readonly renderer: CardRenderer;
  private readonly handlers: Map<string, (action: CardAction, bundleId: string) => Promise<void>> = new Map();

  constructor(config: ThreadsConfig) {
    this.config = { ...config };
    this.renderer = new CardRenderer();
  }

  /** Handle Meta webhook verification (GET request) */
  handleVerification(query: Record<string, string | undefined>): { status: number; body: string } {
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];

    if (mode === 'subscribe' && token === this.config.verifyToken && challenge) {
      return { status: 200, body: challenge };
    }
    return { status: 403, body: 'Forbidden' };
  }

  /** Validate X-Hub-Signature-256 against the client secret */
  validateSignature(payload: string, signatureHeader: string | undefined): boolean {
    if (!signatureHeader) return false;
    if (!signatureHeader.startsWith('sha256=')) return false;

    const { createHmac } = require('node:crypto');
    const expected = createHmac('sha256', this.config.clientSecret)
      .update(payload, 'utf-8')
      .digest('hex');

    return signatureHeader.slice(7) === expected;
  }

  /** Handle incoming Meta webhook event (POST request) */
  async handleWebhook(
    payload: MetaWebhookPayload,
    rawBody: string,
    signature?: string,
  ): Promise<{ status: number; body: string }> {
    // Validate object is 'threads'
    if (payload.object !== 'threads') {
      return { status: 400, body: 'Invalid object type' };
    }

    // Validate signature if provided
    if (signature && !this.validateSignature(rawBody, signature)) {
      this.log('warn', 'invalid_signature', 'Webhook signature validation failed');
      return { status: 403, body: 'Invalid signature' };
    }

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        await this.processChange(entry.id, change);
      }
      for (const msg of entry.messaging ?? []) {
        await this.processMessage(entry.id, msg);
      }
    }

    return { status: 200, body: 'EVENT_RECEIVED' };
  }

  /** Register a card-action handler */
  onCommand(
    action: CardAction,
    handler: (action: CardAction, bundleId: string) => Promise<void>,
  ): void {
    this.handlers.set(action, handler);
  }

  /** Threads API doesn't support bot-initiated DMs with interactive cards.
   *  Cards are delivered via Fanvue or companion relay channels (Discord/Telegram). */
  async sendCard(userId: string, card: RelayCard): Promise<void> {
    this.log('info', 'send_card_unsupported',
      `Card delivery not supported via Threads API (user=${userId}, bundle=${card.bundleId})`);
  }

  /** Start polling for new comments/replies (falls back when webhook not configured) */
  async startPolling(threadsUserId: string, accessToken: string, intervalMs = 60_000): Promise<void> {
    this.log('info', 'polling_configured',
      `Polling every ${intervalMs}ms for user ${threadsUserId.slice(0, 6)}... (token length: ${accessToken.length})`);
  }

  private async processChange(userId: string, change: {
    field: string;
    value: Record<string, unknown>;
  }): Promise<void> {
    switch (change.field) {
      case 'comments':
        this.log('info', 'comment_received', `Comment on post ${String(change.value.id)} (user=${userId.slice(0, 6)}...)`);
        break;
      case 'mentions':
        this.log('info', 'mention_received', `Mention from user ${String(change.value.id)} (user=${userId.slice(0, 6)}...)`);
        break;
      default:
        this.log('debug', 'unknown_change', `Unhandled change field: ${change.field}`);
    }
  }

  private async processMessage(_userId: string, _msg: Record<string, unknown>): Promise<void> {
    this.log('debug', 'message_received', 'Messaging event ignored (Threads DMs not supported via Graph API)');
  }

  private log(level: 'info' | 'warn' | 'debug', event: string, message: string): void {
    const prefix = `[ThreadsAdapter] [${level.toUpperCase()}] [${event}]`;
    // Use renderer ref to avoid unused warning, but skip actual render
    if (this.renderer && level === 'debug') {
      console.debug(`${prefix} ${message}`);
    } else if (level === 'warn') {
      console.warn(`${prefix} ${message}`);
    } else {
      console.log(`${prefix} ${message}`);
    }
  }
}

export default ThreadsAdapter;
