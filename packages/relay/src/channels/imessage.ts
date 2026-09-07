import type { RelayCard, CardAction } from '../card.js';
import { CardRenderer } from '../card.js';

export interface IMessageConfig {
  blueBubblesUrl: string;
  apiKey: string;
}

export interface IMessageResponse {
  text: string;
  chatId: string;
}

export class IMessageAdapter {
  private renderer: CardRenderer;
  private config: IMessageConfig;
  private handlers: Map<string, (action: CardAction, bundleId: string) => Promise<void>> =
    new Map();

  constructor(config: IMessageConfig) {
    this.renderer = new CardRenderer();
    this.config = config;
  }

  onCommand(
    action: CardAction,
    handler: (action: CardAction, bundleId: string) => Promise<void>,
  ): void {
    this.handlers.set(action, handler);
  }

  async sendCard(chatId: string, card: RelayCard): Promise<void> {
    const body = this.renderer.toText(card);
    const payload = {
      chatGuid: chatId,
      text: body,
    };

    const response = await fetch(`${this.config.blueBubblesUrl}/api/v1/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.config.apiKey,
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(`BlueBubbles send failed: HTTP ${response.status}`);
    }
  }

  parseResponse(
    response: IMessageResponse,
  ): { action: CardAction; bundleId: string; params?: Record<string, unknown> } | null {
    const rawText = response.text.trim();
    const [rawKeyword, ...rest] = rawText.split(/\s+/);
    const keyword = rawKeyword?.toLowerCase() ?? '';
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
      'publish now': 'publish_now',
    };

    const cmd = normalizedText === 'publish now' ? 'publish_now' : actionMap[keyword];
    if (!cmd) return null;

    const remainder = rest.join(' ').trim();
    return {
      action: cmd,
      bundleId: '',
      ...(cmd === 'edit_caption' && remainder ? { params: { caption: remainder } } : {}),
      ...(cmd === 'reschedule' && remainder ? { params: { scheduledFor: remainder } } : {}),
    };
  }
}
