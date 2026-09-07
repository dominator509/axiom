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

  parseResponse(
    message: SignalMessage,
  ): { action: CardAction; bundleId: string; params?: Record<string, unknown> } | null {
    const rawText = message.text.trim();
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
