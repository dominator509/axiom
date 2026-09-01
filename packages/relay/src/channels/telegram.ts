import { Bot, Context, InlineKeyboard } from 'grammy';
import type { RelayCard, CardAction } from '../card.js';
import { CardRenderer } from '../card.js';

export interface TelegramConfig {
  token: string;
  webhookUrl?: string;
}

export class TelegramAdapter {
  private bot: Bot;
  private renderer: CardRenderer;
  private handlers: Map<string, (action: CardAction, bundleId: string) => Promise<void>> =
    new Map();

  constructor(config: TelegramConfig) {
    this.bot = new Bot(config.token);
    this.renderer = new CardRenderer();
  }

  getBot(): Bot {
    return this.bot;
  }

  onCommand(
    action: CardAction,
    handler: (action: CardAction, bundleId: string) => Promise<void>,
  ): void {
    this.handlers.set(action, handler);
  }

  async sendCard(chatId: string, card: RelayCard): Promise<void> {
    if (!card.cardId) throw new Error('relay card missing persistent card id');
    const html = this.renderer.toHtml(card);
    const keyboard = new InlineKeyboard();

    for (const action of card.actions) {
      keyboard.add({
        text: this.actionLabel(action),
        callback_data: `${action}:${card.cardId}`,
      });
    }

    await this.bot.api.sendMessage(chatId, html, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  }

  async handleCallback(callbackQuery: any): Promise<void> {
    if (!callbackQuery.data) return;
    const [action, bundleId] = callbackQuery.data.split(':');
    const handler = this.handlers.get(action as CardAction);
    if (handler) {
      await handler(action as CardAction, bundleId);
      await this.bot.api.answerCallbackQuery(callbackQuery.id, {
        text: `Action "${action}" processed`,
      });
    }
  }

  setupCommands(): void {
    this.bot.command('approve', async (ctx: Context) => {
      const handler = this.handlers.get('approve');
      if (handler) await handler('approve', String(ctx.match ?? ''));
    });
    this.bot.command('approve_all', async (ctx: Context) => {
      const handler = this.handlers.get('approve_all');
      if (handler) await handler('approve_all', String(ctx.match ?? ''));
    });
    this.bot.command('reject', async (ctx: Context) => {
      const handler = this.handlers.get('reject');
      if (handler) await handler('reject', String(ctx.match ?? ''));
    });
    this.bot.command('edit', async (ctx: Context) => {
      const handler = this.handlers.get('edit_caption');
      if (handler) await handler('edit_caption', String(ctx.match ?? ''));
    });
    this.bot.command('reschedule', async (ctx: Context) => {
      const handler = this.handlers.get('reschedule');
      if (handler) await handler('reschedule', String(ctx.match ?? ''));
    });
    this.bot.command('regenerate', async (ctx: Context) => {
      const handler = this.handlers.get('regenerate');
      if (handler) await handler('regenerate', String(ctx.match ?? ''));
    });
    this.bot.command('revise', async (ctx: Context) => {
      const handler = this.handlers.get('revise');
      if (handler) await handler('revise', String(ctx.match ?? ''));
    });
    this.bot.command('hold', async (ctx: Context) => {
      const handler = this.handlers.get('hold');
      if (handler) await handler('hold', String(ctx.match ?? ''));
    });
  }

  async startPolling(): Promise<void> {
    this.setupCommands();
    this.bot.start();
  }

  async setWebhook(url: string): Promise<void> {
    await this.bot.api.setWebhook(url);
    this.setupCommands();
  }

  private actionLabel(action: CardAction): string {
    const labels: Record<CardAction, string> = {
      approve: '✅ Approve',
      approve_all: '✅✅ Approve All',
      reject: '❌ Reject',
      edit_caption: '✏️ Edit',
      change_price: '💰 Change Price',
      reschedule: '📅 Reschedule',
      regenerate: '🔄 Regenerate',
      revise: '🔧 Revise',
      hold: '⏸️ Hold',
    };
    return labels[action];
  }
}
