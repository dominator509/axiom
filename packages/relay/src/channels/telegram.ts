import { Bot, Context, InlineKeyboard } from 'grammy';
import type { RelayCard, CardAction } from '../card.js';
import { CardRenderer } from '../card.js';
import { CommandRouter, type CommandContext } from '../commands.js';

const TELEGRAM_API_TIMEOUT_SECONDS = 60;

export interface TelegramConfig {
  token: string;
  webhookUrl?: string;
  webhookSecret?: string;
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
  private webhookSecret?: string;
  private callbackHandlerRegistered = false;

  constructor(config: TelegramConfig, commandRouter?: CommandRouter) {
    this.bot = new Bot(config.token, {
      client: { timeoutSeconds: TELEGRAM_API_TIMEOUT_SECONDS },
    });
    this.renderer = new CardRenderer();
    this.commandRouter = commandRouter;
    this.webhookSecret = config.webhookSecret;
  }

  getBot(): Bot {
    return this.bot;
  }

  onCommand(action: CardAction, handler: CommandHandler): void {
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
    const callbackId = typeof callbackQuery?.id === 'string' ? callbackQuery.id : '';
    if (!callbackId) return;

    const token = typeof callbackQuery?.data === 'string' ? callbackQuery.data : '';
    const sourceId = callbackQuery?.message?.chat?.id;
    const pending = this.commandRouter?.peekCommandToken(token);
    if (
      pending &&
      isParameterizedAction(pending.action) &&
      sourceId !== undefined &&
      sourceId !== null
    ) {
      await this.bot.api.answerCallbackQuery(callbackQuery.id, {
        text: 'Send the requested value with the command below.',
      });
      await this.bot.api.sendMessage(String(sourceId), parameterPrompt(pending.action, token));
      return;
    }

    // Telegram keeps showing a client-side progress indicator until the
    // callback is acknowledged. A command handler can perform DB and
    // provider work, so acknowledge a valid command before entering it.
    const handler = pending ? this.handlers.get(pending.action) : undefined;
    if (!handler || sourceId === undefined || sourceId === null) {
      await this.bot.api.answerCallbackQuery(callbackId);
      return;
    }
    await this.bot.api.answerCallbackQuery(callbackId, { text: 'Action received' });

    await this.dispatchToken(
      token,
      undefined,
      sourceId === undefined || sourceId === null ? undefined : String(sourceId),
    );
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
      ['publish_now', 'publish_now'],
    ];
    for (const [name, action] of commands) {
      this.bot.command(name, async (ctx: Context) => {
        const input = String(ctx.match ?? '').trim();
        const token = input.split(/\s+/, 1)[0] ?? '';
        const remainder = input.slice(token.length).trim();
        const sourceId = ctx.chat?.id;
        await this.dispatchToken(
          token,
          action,
          sourceId === undefined || sourceId === null ? undefined : String(sourceId),
          commandParams(action, remainder),
        );
      });
    }
  }

  async startPolling(): Promise<void> {
    this.setupCommands();
    this.registerCallbackHandler();

    // grammY's start promise intentionally stays pending for the lifetime of
    // long polling. Wait only for its onStart callback so initializeRuntime
    // can fail closed on invalid credentials or a failed deleteWebhook call
    // without blocking API startup on the polling loop itself.
    let resolveStartup!: () => void;
    let rejectStartup!: (reason?: unknown) => void;
    let startupComplete = false;
    const startup = new Promise<void>((resolve, reject) => {
      resolveStartup = resolve;
      rejectStartup = reject;
    });

    let polling: Promise<void>;
    try {
      polling = this.bot.start({
        onStart: () => {
          startupComplete = true;
          resolveStartup();
        },
      });
    } catch (error) {
      rejectStartup(error);
      await startup;
      return;
    }

    void polling.catch((error) => {
      if (!startupComplete) {
        rejectStartup(error);
        return;
      }
      console.error('Telegram long polling stopped', error);
    });

    await startup;
  }

  async setWebhook(url: string): Promise<void> {
    // Webhook delivery calls bot.handleUpdate, which requires botInfo. Polling
    // initializes grammY as part of bot.start(), but webhook mode has no such
    // implicit initialization step.
    await this.bot.init();
    if (this.webhookSecret) {
      await this.bot.api.setWebhook(url, { secret_token: this.webhookSecret });
    } else {
      await this.bot.api.setWebhook(url);
    }
    this.setupCommands();
    this.registerCallbackHandler();
  }

  /** Process one provider-delivered webhook update after the API verifies it. */
  async handleWebhook(update: Parameters<Bot['handleUpdate']>[0]): Promise<void> {
    await this.bot.handleUpdate(update);
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
    params: Record<string, unknown> = {},
  ): Promise<boolean> {
    if (!this.commandRouter || !token || !sourceId) return false;
    const command = this.commandRouter.verifyCommandToken(token, expectedAction);
    if (!command) return false;
    const handler = this.handlers.get(command.action);
    if (!handler) return false;
    const context: CommandContext = {
      channel: 'telegram',
      sourceId,
      ...(Object.keys(params).length > 0 ? { params } : {}),
    };
    await handler(command.action, command.cardId, context);
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
      publish_now: '🚀 Publish Now',
    };
    return labels[action];
  }
}

function isParameterizedAction(action: CardAction): action is 'edit_caption' | 'reschedule' {
  return action === 'edit_caption' || action === 'reschedule';
}

function commandParams(action: CardAction, remainder: string): Record<string, unknown> {
  if (!remainder) return {};
  if (action === 'edit_caption') return { caption: remainder };
  if (action === 'reschedule') return { scheduledFor: remainder };
  if (action === 'approve' || action === 'approve_all') return { slot: remainder };
  return {};
}

function parameterPrompt(action: 'edit_caption' | 'reschedule', token: string): string {
  return action === 'edit_caption'
    ? `Edit this caption with:\n/edit ${token} <new caption>`
    : `Reschedule this bundle with:\n/reschedule ${token} <future ISO-8601 timestamp>`;
}
