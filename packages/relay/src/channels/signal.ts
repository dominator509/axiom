import type { RelayCard, CardAction } from '../card.js';
import { CardRenderer } from '../card.js';

export interface SignalConfig {
  cliPath: string;
  account: string;
}

export interface SignalMessage {
  source: string;
  text: string;
  timestamp: number;
}

export class SignalAdapter {
  private renderer: CardRenderer;
  private config: SignalConfig;
  private handlers: Map<string, (action: CardAction, bundleId: string) => Promise<void>> =
    new Map();

  constructor(config: SignalConfig) {
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
    const { execa } = await import('execa');

    await execa(this.config.cliPath, ['send', '-a', this.config.account, chatId, body]);
  }

  parseResponse(message: SignalMessage): { action: CardAction; bundleId: string } | null {
    const text = message.text.trim().toLowerCase();
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
