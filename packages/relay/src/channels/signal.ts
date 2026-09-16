import { execa, type ResultPromise } from 'execa';
import type { RelayCard, CardAction } from '../card.js';
import { CardRenderer } from '../card.js';
import { CommandRouter, type CommandContext } from '../commands.js';

const SIGNAL_SEND_TIMEOUT_MS = 30_000;
const SIGNAL_NOTIFICATION_MAX_BYTES = 256 * 1024;

export interface SignalConfig {
  cliPath: string;
  account: string;
}

export interface SignalMessage {
  source: string;
  /** Group id when the message came from a group; otherwise the source. */
  chatId?: string;
  text: string;
  timestamp: number;
}

export interface ParsedSignalCommand {
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

export class SignalAdapter {
  private renderer: CardRenderer;
  private config: SignalConfig;
  private commandRouter?: CommandRouter;
  private handlers: Map<string, CommandHandler> = new Map();
  private receiveProcess?: ResultPromise;
  private receiveRestartTimer?: NodeJS.Timeout;
  private receiving = false;

  constructor(config: SignalConfig, commandRouter?: CommandRouter) {
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

    await execa(this.config.cliPath, ['send', '-a', this.config.account, chatId, body], {
      timeout: SIGNAL_SEND_TIMEOUT_MS,
    });
  }

  /**
   * Start signal-cli's documented JSON-RPC receive stream. The process is
   * supervised and restarted after an unexpected exit so a transient Signal
   * disconnect does not silently disable operator controls.
   */
  startReceiving(): void {
    if (this.receiving) return;
    this.receiving = true;
    void this.spawnReceiveProcess();
  }

  stopReceiving(): void {
    this.receiving = false;
    if (this.receiveRestartTimer) {
      clearTimeout(this.receiveRestartTimer);
      this.receiveRestartTimer = undefined;
    }
    this.receiveProcess?.kill();
    this.receiveProcess = undefined;
  }

  parseResponse(message: SignalMessage): ParsedSignalCommand | null {
    const rawText = message.text.trim();
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

  /** Verify a token and execute one inbound Signal message through the API handler. */
  async handleMessage(message: SignalMessage): Promise<boolean> {
    const parsed = this.parseResponse(message);
    if (!parsed?.commandToken || !this.commandRouter) return false;
    const command = this.commandRouter.verifyCommandToken(parsed.commandToken, parsed.action);
    if (!command) return false;
    const handler = this.handlers.get(command.action);
    if (!handler) return false;

    const sourceId = message.chatId ?? message.source;
    await handler(command.action, command.cardId, {
      channel: 'signal',
      sourceId,
      ...(parsed.params ? { params: parsed.params } : {}),
    });
    return true;
  }

  private async spawnReceiveProcess(): Promise<void> {
    if (!this.receiving) return;

    try {
      const child = execa(this.config.cliPath, ['-a', this.config.account, 'jsonRpc'], {
        reject: false,
      });
      this.receiveProcess = child;
      for await (const line of child) {
        const message = parseSignalNotification(line);
        if (!message) continue;
        try {
          await this.handleMessage(message);
        } catch (error) {
          console.error('Signal relay command failed', error);
        }
      }
    } catch (error) {
      console.error('Signal receive process failed', error);
    } finally {
      this.receiveProcess = undefined;
      if (this.receiving) {
        this.receiveRestartTimer = setTimeout(() => {
          this.receiveRestartTimer = undefined;
          void this.spawnReceiveProcess();
        }, 5_000);
      }
    }
  }
}

export function parseSignalNotification(value: unknown): SignalMessage | null {
  const parsedValue =
    typeof value === 'string'
      ? (() => {
          if (Buffer.byteLength(value, 'utf8') > SIGNAL_NOTIFICATION_MAX_BYTES) return null;
          try {
            return JSON.parse(value);
          } catch {
            return null;
          }
        })()
      : value;
  const root = asRecord(parsedValue);
  const params = asRecord(root?.params);
  const envelope =
    asRecord(params?.envelope) ??
    asRecord(asRecord(params?.result)?.envelope) ??
    asRecord(root?.envelope);
  const dataMessage = asRecord(envelope?.dataMessage);
  const source = typeof envelope?.source === 'string' ? envelope.source : '';
  const text = typeof dataMessage?.message === 'string' ? dataMessage.message.trim() : '';
  if (!source || !text) return null;

  const groupInfo = asRecord(dataMessage?.groupInfo);
  const chatId = typeof groupInfo?.groupId === 'string' ? groupInfo.groupId : source;
  const rawTimestamp = envelope?.timestamp ?? dataMessage?.timestamp;
  const timestamp = Number(
    typeof rawTimestamp === 'number' || typeof rawTimestamp === 'string'
      ? rawTimestamp
      : Date.now(),
  );
  return {
    source,
    chatId,
    text,
    timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
  };
}

function isCompactCommandToken(value: string | undefined): value is string {
  return Boolean(
    value && /^[a-z0-9]\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value),
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}
