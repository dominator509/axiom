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
  private handlers: Map<string, (action: CardAction, bundleId: string) => Promise<void>> = new Map();

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

    await fetch(`${this.config.blueBubblesUrl}/api/v1/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.config.apiKey,
      },
      body: JSON.stringify(payload),
    });
  }

  parseResponse(response: IMessageResponse): { action: CardAction; bundleId: string } | null {
    const text = response.text.trim().toLowerCase();
    const actionMap: Record<string, CardAction> = {
      '1': 'approve',
      '2': 'approve_all',
      '3': 'reject',
      '4': 'edit_caption',
      '5': 'change_price',
      '6': 'reschedule',
      '7': 'regenerate',
      '8': 'revise',
      '9': 'hold',
      approve: 'approve',
      reject: 'reject',
      edit: 'edit_caption',
      schedule: 'reschedule',
      regenerate: 'regenerate',
      revise: 'revise',
      hold: 'hold',
    };

    const cmd = actionMap[text];
    if (!cmd) return null;

    return { action: cmd, bundleId: '' };
  }
}
