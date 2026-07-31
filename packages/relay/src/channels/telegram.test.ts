// ─── TelegramAdapter — Vitest Suite ───
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InlineKeyboard } from 'grammy';
import { TelegramAdapter } from './telegram.js';
import type { RelayCard, CardAction } from '../card.js';

const config = { token: '123:test-token', webhookUrl: 'https://relay.example/webhook' };

function makeCard(actions: CardAction[]): RelayCard {
  return {
    bundleId: 'bundle-1',
    mediaPreview: 'https://cdn.example/1.jpg',
    caption: 'Test caption',
    captionVariants: {},
    hashtagSets: {},
    verdicts: [{ platform: 'tiktok', passed: true, score: 0.9, reason: 'ok' }],
    targetPlatforms: ['tiktok'],
    actions,
    timestamp: 1_700_000_000_000,
    format: 'html',
  };
}

let adapter: TelegramAdapter;

beforeEach(() => {
  adapter = new TelegramAdapter(config);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('construction / getBot / onCommand', () => {
  it('constructs a grammy Bot and exposes it', () => {
    const bot = adapter.getBot();
    expect(bot).toBeDefined();
  });

  it('stores action handlers for callback queries', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    adapter.onCommand('approve', handler);
    const answerSpy = vi.spyOn(adapter.getBot().api, 'answerCallbackQuery').mockResolvedValue(true as any);

    await adapter.handleCallback({ id: 'cb-1', data: 'approve:bundle-1' });

    expect(handler).toHaveBeenCalledWith('approve', 'bundle-1');
    expect(answerSpy).toHaveBeenCalledWith('cb-1', { text: 'Action "approve" processed' });
  });
});

describe('sendCard', () => {
  it('sends an HTML card with an inline keyboard of action buttons', async () => {
    const sendSpy = vi.spyOn(adapter.getBot().api, 'sendMessage').mockResolvedValue({ message_id: 1 } as any);

    await adapter.sendCard('chat-1', makeCard(['approve', 'reject', 'hold']));

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const [chatId, html, opts] = sendSpy.mock.calls[0] as unknown as [string, string, any];
    expect(chatId).toBe('chat-1');
    expect(html).toContain('📦 Bundle: bundle-1');
    expect(html).toContain('<b>Caption:</b> Test caption');
    expect(opts.parse_mode).toBe('HTML');

    const keyboard = opts.reply_markup as InlineKeyboard;
    expect(keyboard).toBeInstanceOf(InlineKeyboard);
    expect(keyboard.inline_keyboard).toEqual([
      [
        { text: '✅ Approve', callback_data: 'approve:bundle-1' },
        { text: '❌ Reject', callback_data: 'reject:bundle-1' },
        { text: '⏸️ Hold', callback_data: 'hold:bundle-1' },
      ],
    ]);
  });

  it('builds a button per action for large action sets', async () => {
    const sendSpy = vi.spyOn(adapter.getBot().api, 'sendMessage').mockResolvedValue({ message_id: 1 } as any);
    const actions: CardAction[] = ['approve', 'approve_all', 'edit_caption', 'change_price', 'reschedule', 'regenerate', 'revise', 'hold', 'reject'];
    await adapter.sendCard('chat-1', makeCard(actions));
    const [, , opts] = sendSpy.mock.calls[0] as unknown as [string, string, any];
    const keyboard = opts.reply_markup as InlineKeyboard;
    expect(keyboard.inline_keyboard[0]).toHaveLength(9);
    expect(keyboard.inline_keyboard[0][1]).toEqual({ text: '✅✅ Approve All', callback_data: 'approve_all:bundle-1' });
  });

  it('propagates API errors', async () => {
    vi.spyOn(adapter.getBot().api, 'sendMessage').mockRejectedValue(new Error('bot blocked'));
    await expect(adapter.sendCard('chat-1', makeCard(['approve']))).rejects.toThrow('bot blocked');
  });
});

describe('handleCallback', () => {
  it('ignores callbacks without data', async () => {
    const handler = vi.fn();
    adapter.onCommand('approve', handler);
    await adapter.handleCallback({ id: 'cb-1', data: undefined });
    expect(handler).not.toHaveBeenCalled();
  });

  it('ignores callbacks with no registered handler', async () => {
    const answerSpy = vi.spyOn(adapter.getBot().api, 'answerCallbackQuery').mockResolvedValue(true as any);
    await adapter.handleCallback({ id: 'cb-1', data: 'approve:bundle-1' });
    expect(answerSpy).not.toHaveBeenCalled();
  });

  it('handles malformed callback data without crashing', async () => {
    const handler = vi.fn();
    adapter.onCommand('approve', handler);
    await adapter.handleCallback({ id: 'cb-1', data: 'garbage' });
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('setupCommands', () => {
  it('registers all eight slash commands', () => {
    const commandSpy = vi.spyOn(adapter.getBot(), 'command').mockImplementation(() => adapter.getBot() as any);
    adapter.setupCommands();
    const names = commandSpy.mock.calls.map((c) => c[0]);
    expect(names).toEqual(['approve', 'approve_all', 'reject', 'edit', 'reschedule', 'regenerate', 'revise', 'hold']);
  });

  it('wires command handlers to the registered action handlers', async () => {
    const captured = new Map<string, (ctx: any) => Promise<void>>();
    vi.spyOn(adapter.getBot(), 'command').mockImplementation(((
      name: string,
      fn: (ctx: any) => Promise<void>,
    ) => {
      captured.set(name, fn);
      return adapter.getBot() as any;
    }) as any);

    const approveHandler = vi.fn().mockResolvedValue(undefined);
    const holdHandler = vi.fn().mockResolvedValue(undefined);
    adapter.onCommand('approve', approveHandler);
    adapter.onCommand('hold', holdHandler);

    adapter.setupCommands();

    await captured.get('approve')!({ match: 'bundle-42' });
    expect(approveHandler).toHaveBeenCalledWith('approve', 'bundle-42');

    await captured.get('edit')!({ match: 'bundle-43' });
    // 'edit' maps to edit_caption; no handler registered → nothing
    await captured.get('hold')!({ match: 'bundle-44' });
    expect(holdHandler).toHaveBeenCalledWith('hold', 'bundle-44');
  });
});

describe('startPolling / setWebhook', () => {
  it('startPolling registers commands and starts the bot', async () => {
    const commandSpy = vi.spyOn(adapter.getBot(), 'command').mockImplementation(() => adapter.getBot() as any);
    const startSpy = vi.spyOn(adapter.getBot(), 'start').mockResolvedValue();
    await adapter.startPolling();
    expect(commandSpy).toHaveBeenCalled();
    expect(startSpy).toHaveBeenCalledTimes(1);
  });

  it('setWebhook calls the API and registers commands', async () => {
    const commandSpy = vi.spyOn(adapter.getBot(), 'command').mockImplementation(() => adapter.getBot() as any);
    const webhookSpy = vi.spyOn(adapter.getBot().api, 'setWebhook').mockResolvedValue(true as any);
    await adapter.setWebhook('https://relay.example/hook');
    expect(webhookSpy).toHaveBeenCalledWith('https://relay.example/hook');
    expect(commandSpy).toHaveBeenCalled();
  });
});
