import { Bot, Context, InlineKeyboard } from 'grammy';
import type { RelayCard, CardAction } from '../card.js';
import { CardRenderer } from '../card.js';
import { CommandRouter, type CommandContext } from '../commands.js';

export interface TelegramConfig {
  token: string;
  webhookUrl?: string;
}

type CommandHandler = (
  action: CardAction,
  cardId: string,
  context?: CommandContext,
) => Promise<void>;

export class TelegramAdapter {
  private bot: Bot;
  private renderer: CardRenderer;
  private handlers: Map<string, CommandHandler> = new Map();
  private commandRouter?: CommandRouter;
  private callbackHandlerRegistered = false;

  constructor(config: TelegramConfig, commandRouter?: CommandRouter) {
    this.bot = new Bot(config.token);
    this.renderer = new CardRenderer();
    this.commandRouter = commandRouter;
  }

  getBot(): Bot {
    return this.bot;
  }

  onCommand(
    action: CardAction,
    handler: CommandHandler,
  ): void {
    this.handlers.set(action, handler);
  }

  async sendCard(chatId: string, card: RelayCard): Promise<void> {
    if (!card.cardId) throw new Error('relay card missing persistent card id');
    const html = this.renderer.toHtml(card);
    const keyboard = new InlineKeyboard();

    for (const action of card.actions) {
      const commandToken = card.commandTokens?.[action];
      if (!commandToken) {
        throw new Error(`relay card missing signed command token for ${action}`);
      }
      keyboard.add({
        text: this.actionLabel(action),
        callback_data: commandToken,
      });
    }

    await this.bot.api.sendMessage(chatId, html, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  }

  async handleCallback(callbackQuery: any): Promise<void> {
    const token = typeof callbackQuery?.data === 'string' ? callbackQuery.data : '';
    const sourceId = callbackQuery?.message?.chat?.id;
    const processed = await this.dispatchToken(
      token,
      undefined,
      sourceId === undefined || sourceId === null ? undefined : String(sourceId),
    );
    if (processed) {
      await this.bot.api.answerCallbackQuery(callbackQuery.id, {
        text: `Action processed`,
      });
    }
  }

  setupCommands(): void {
    const commands: Array<[string, CardAction]> = [
      ['approve', 'approve'],
      ['approve_all', 'approve_all'],
      ['reject', 'reject'],
      ['edit', 'edit_caption'],
      ['reschedule', 'reschedule'],
      ['regenerate', 'regenerate'],
      ['revise', 'revise'],
      ['hold', 'hold'],
    ];
    for (const [name, action] of commands) {
      this.bot.command(name, async (ctx: Context) => {
        const token = String(ctx.match ?? '').trim();
        const sourceId = ctx.chat?.id;
        await this.dispatchToken(
          token,
          action,
          sourceId === undefined || sourceId === null ? undefined : String(sourceId),
        );
      });
    }
  }

  async startPolling(): Promise<void> {
    this.setupCommands();
    this.registerCallbackHandler();
    this.bot.start();
  }

  async setWebhook(url: string): Promise<void> {
    await this.bot.api.setWebhook(url);
    this.setupCommands();
    this.registerCallbackHandler();
  }

  private registerCallbackHandler(): void {
    if (this.callbackHandlerRegistered) return;
    this.callbackHandlerRegistered = true;
    this.bot.on('callback_query:data', async (ctx) => {
      await this.handleCallback(ctx.callbackQuery);
    });
  }

  private async dispatchToken(
    token: string,
    expectedAction: CardAction | undefined,
    sourceId: string | undefined,
  ): Promise<boolean> {
    if (!this.commandRouter || !token || !sourceId) return false;
    const command = this.commandRouter.verifyCommandToken(token, expectedAction);
    if (!command) return false;
    const handler = this.handlers.get(command.action);
    if (!handler) return false;
    await handler(command.action, command.cardId, {
      channel: 'telegram',
      sourceId,
    });
    return true;
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
