import { randomUUID } from 'node:crypto';
import type { RelayCard, CardAction } from '../card.js';
import { CardRenderer } from '../card.js';
import { CommandRouter, type CommandContext } from '../commands.js';

const IMESSAGE_SEND_TIMEOUT_MS = 30_000;

export interface IMessageConfig {
  blueBubblesUrl: string;
  /** BlueBubbles server password used as the documented `password` query parameter. */
  password?: string;
  /** Legacy config name retained for callers; it is sent using the password contract. */
  apiKey?: string;
}

export interface IMessageResponse {
  text: string;
  chatId: string;
}

export interface ParsedIMessageCommand {
  action: CardAction;
  /** Kept for parser compatibility; authenticated commands use commandToken. */
  bundleId: string;
  commandToken?: string;
  params?: Record<string, unknown>;
}

type CommandHandler = (
  action: CardAction,
  cardId: string,
  context?: CommandContext,
) => Promise<void>;

export class IMessageAdapter {
  private renderer: CardRenderer;
  private config: IMessageConfig;
  private commandRouter?: CommandRouter;
  private handlers: Map<string, CommandHandler> = new Map();

  constructor(config: IMessageConfig, commandRouter?: CommandRouter) {
    this.renderer = new CardRenderer();
    this.config = config;
    this.commandRouter = commandRouter;
  }

  onCommand(action: CardAction, handler: CommandHandler): void {
    this.handlers.set(action, handler);
  }

  async sendCard(chatId: string, card: RelayCard): Promise<void> {
    if (!card.cardId) throw new Error('relay card missing persistent card id');
    for (const action of card.actions) {
      if (!card.commandTokens?.[action]) {
        throw new Error(`relay card missing signed command token for ${action}`);
      }
    }
    const body = this.renderer.toText(card);
    const password = this.config.password ?? this.config.apiKey;
    if (!password) throw new Error('BlueBubbles password is required');
    const url = new URL('/api/v1/message/text', this.config.blueBubblesUrl);
    url.searchParams.set('password', password);
    const payload = {
      chatGuid: chatId,
      tempGuid: randomUUID(),
      message: body,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(IMESSAGE_SEND_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`BlueBubbles send failed: HTTP ${response.status}`);
    }
  }

  parseResponse(response: IMessageResponse): ParsedIMessageCommand | null {
    const rawText = response.text.trim();
    const words = rawText.split(/\s+/);
    const rawKeyword = words.shift()?.toLowerCase() ?? '';
    const normalizedText = rawText.toLowerCase();
    const actionMap: Record<string, CardAction> = {
      approve: 'approve',
      approve_all: 'approve_all',
      reject: 'reject',
      edit: 'edit_caption',
      schedule: 'reschedule',
      reschedule: 'reschedule',
      regenerate: 'regenerate',
      revise: 'revise',
      hold: 'hold',
      go: 'publish_now',
      publish_now: 'publish_now',
    };

    let action: CardAction | undefined;
    if (rawKeyword === 'publish' && words.shift()?.toLowerCase() === 'now') {
      action = 'publish_now';
    } else if (normalizedText === 'publish now') {
      action = 'publish_now';
    } else {
      action = actionMap[rawKeyword];
    }
    if (!action) return null;

    const commandToken = isCompactCommandToken(words[0]) ? words.shift() : undefined;
    const remainder = words.join(' ').trim();
    return {
      action,
      bundleId: '',
      ...(commandToken ? { commandToken } : {}),
      ...(action === 'edit_caption' && remainder ? { params: { caption: remainder } } : {}),
      ...(action === 'reschedule' && remainder ? { params: { scheduledFor: remainder } } : {}),
    };
  }

  /** Parse and execute a BlueBubbles new-message webhook. */
  async handleWebhook(payload: unknown): Promise<boolean> {
    const message = parseIMessageWebhook(payload);
    if (!message) return false;
    const parsed = this.parseResponse(message);
    if (!parsed?.commandToken || !this.commandRouter) return false;
    const command = this.commandRouter.verifyCommandToken(parsed.commandToken, parsed.action);
    if (!command) return false;
    const handler = this.handlers.get(command.action);
    if (!handler) return false;

    await handler(command.action, command.cardId, {
      channel: 'imessage',
      sourceId: message.chatId,
      ...(parsed.params ? { params: parsed.params } : {}),
    });
    return true;
  }
}

export function parseIMessageWebhook(value: unknown): IMessageResponse | null {
  const root = asRecord(value);
  const eventType =
    typeof root?.type === 'string'
      ? root.type
      : typeof root?.event === 'string'
        ? root.event
        : undefined;
  if (eventType && eventType !== 'new-message') return null;

  const data = asRecord(root?.data) ?? root;
  const message = asRecord(data?.message) ?? data;
  const isFromMe = message?.isFromMe === true || message?.is_from_me === true;
  if (isFromMe) return null;

  const attributedBody = asRecord(message?.attributedBody);
  const textCandidates = [
    message?.text,
    message?.message,
    attributedBody?.string,
    data?.text,
  ];
  const text = textCandidates.find((candidate): candidate is string => typeof candidate === 'string')?.trim();
  const chatIdCandidates = [
    message?.chatGuid,
    message?.chatId,
    asRecord(message?.chat)?.guid,
    data?.chatGuid,
    data?.chatId,
  ];
  const chatId = chatIdCandidates.find(
    (candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0,
  );
  if (!text || !chatId) return null;
  return { text, chatId };
}

function isCompactCommandToken(value: string | undefined): value is string {
  return Boolean(
    value && /^[a-z0-9]\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value),
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}
