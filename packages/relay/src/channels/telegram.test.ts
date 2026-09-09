// ─── TelegramAdapter — Vitest Suite ───
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InlineKeyboard } from 'grammy';
import { TelegramAdapter } from './telegram.js';
import type { RelayCard, CardAction } from '../card.js';
import { CommandRouter } from '../commands.js';

const config = {
  token: '123:test-token',
  webhookUrl: 'https://relay.example/webhook',
  webhookSecret: 'telegram-webhook-secret',
};
const COMMAND_SECRET = 'telegram-test-secret';

function makeCard(actions: CardAction[]): RelayCard {
  const signer = new CommandRouter(COMMAND_SECRET);
  const cardId = 'card-1';
  return {
    cardId,
    bundleId: 'bundle-1',
    mediaPreview: 'https://cdn.example/1.jpg',
    caption: 'Test caption',
    captionVariants: {},
    hashtagSets: {},
    verdicts: [{ platform: 'tiktok', passed: true, score: 0.9, reason: 'ok' }],
    targetPlatforms: ['tiktok'],
    actions,
    commandTokens: Object.fromEntries(
      actions.map((action) => [action, signer.createCommandToken(action, cardId)]),
    ),
    timestamp: 1_700_000_000_000,
    format: 'html',
  };
}

let adapter: TelegramAdapter;

beforeEach(() => {
  adapter = new TelegramAdapter(config, new CommandRouter(COMMAND_SECRET));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('construction / getBot / onCommand', () => {
  it('constructs a grammy Bot and exposes it', () => {
    const bot = adapter.getBot();
    expect(bot).toBeDefined();
    expect(bot.api.options?.timeoutSeconds).toBe(60);
  });

  it('stores action handlers for callback queries', async () => {
    const events: string[] = [];
    const handler = vi.fn().mockImplementation(async () => {
      events.push('handler');
    });
    adapter.onCommand('approve', handler);
    const answerSpy = vi
      .spyOn(adapter.getBot().api, 'answerCallbackQuery')
      .mockImplementation(async () => {
        events.push('ack');
        return true as any;
      });

    const token = new CommandRouter(COMMAND_SECRET).createCommandToken('approve', 'bundle-1');
    await adapter.handleCallback({
      id: 'cb-1',
      data: token,
      message: { chat: { id: 'chat-1' } },
    });

    expect(handler).toHaveBeenCalledWith('approve', 'bundle-1', {
      channel: 'telegram',
      sourceId: 'chat-1',
    });
    expect(answerSpy).toHaveBeenCalledWith('cb-1', { text: 'Action received' });
    expect(events).toEqual(['ack', 'handler']);
  });
});

describe('sendCard', () => {
  it('fails closed when an action has no signed command token', async () => {
    const card = makeCard(['approve']);
    delete card.commandTokens;
    await expect(adapter.sendCard('chat-1', card)).rejects.toThrow(
      'relay card missing signed command token for approve',
    );
  });

  it('sends an HTML card with an inline keyboard of action buttons', async () => {
    const sendSpy = vi
      .spyOn(adapter.getBot().api, 'sendMessage')
      .mockResolvedValue({ message_id: 1 } as any);

    const card = makeCard(['approve', 'reject', 'hold']);
    await adapter.sendCard('chat-1', card);

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
        { text: '✅ Approve', callback_data: card.commandTokens?.approve },
        { text: '❌ Reject', callback_data: card.commandTokens?.reject },
        { text: '⏸️ Hold', callback_data: card.commandTokens?.hold },
      ],
    ]);
  });

  it('builds a button per action for large action sets', async () => {
    const sendSpy = vi
      .spyOn(adapter.getBot().api, 'sendMessage')
      .mockResolvedValue({ message_id: 1 } as any);
    const actions: CardAction[] = [
      'approve',
      'approve_all',
      'edit_caption',
      'change_price',
      'reschedule',
      'regenerate',
      'revise',
      'hold',
      'reject',
    ];
    const card = makeCard(actions);
    await adapter.sendCard('chat-1', card);
    const [, , opts] = sendSpy.mock.calls[0] as unknown as [string, string, any];
    const keyboard = opts.reply_markup as InlineKeyboard;
    expect(keyboard.inline_keyboard[0]).toHaveLength(9);
    expect(keyboard.inline_keyboard[0][1]).toEqual({
      text: '✅✅ Approve All',
      callback_data: card.commandTokens?.approve_all,
    });
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
    const answerSpy = vi
      .spyOn(adapter.getBot().api, 'answerCallbackQuery')
      .mockResolvedValue(true as any);
    await adapter.handleCallback({ id: 'cb-1', data: undefined });
    expect(handler).not.toHaveBeenCalled();
    expect(answerSpy).toHaveBeenCalledWith('cb-1');
  });

  it('ignores callbacks with no registered handler', async () => {
    const answerSpy = vi
      .spyOn(adapter.getBot().api, 'answerCallbackQuery')
      .mockResolvedValue(true as any);
    await adapter.handleCallback({
      id: 'cb-1',
      data: new CommandRouter(COMMAND_SECRET).createCommandToken('approve', 'bundle-1'),
      message: { chat: { id: 'chat-1' } },
    });
    expect(answerSpy).toHaveBeenCalledWith('cb-1');
  });

  it('handles malformed callback data without crashing', async () => {
    const handler = vi.fn();
    adapter.onCommand('approve', handler);
    const answerSpy = vi
      .spyOn(adapter.getBot().api, 'answerCallbackQuery')
      .mockResolvedValue(true as any);
    await adapter.handleCallback({
      id: 'cb-1',
      data: 'garbage',
      message: { chat: { id: 'chat-1' } },
    });
    expect(handler).not.toHaveBeenCalled();
    expect(answerSpy).toHaveBeenCalledWith('cb-1');
  });

  it('rejects a valid token when the provider supplies no source chat', async () => {
    const handler = vi.fn();
    adapter.onCommand('approve', handler);
    const answerSpy = vi
      .spyOn(adapter.getBot().api, 'answerCallbackQuery')
      .mockResolvedValue(true as any);
    await adapter.handleCallback({
      id: 'cb-1',
      data: new CommandRouter(COMMAND_SECRET).createCommandToken('approve', 'bundle-1'),
    });
    expect(handler).not.toHaveBeenCalled();
    expect(answerSpy).toHaveBeenCalledWith('cb-1');
  });
});

describe('setupCommands', () => {
  it('registers all nine slash commands', () => {
    const commandSpy = vi
      .spyOn(adapter.getBot(), 'command')
      .mockImplementation(() => adapter.getBot() as any);
    adapter.setupCommands();
    const names = commandSpy.mock.calls.map((c) => c[0]);
    expect(names).toEqual([
      'approve',
      'approve_all',
      'reject',
      'edit',
      'reschedule',
      'regenerate',
      'revise',
      'hold',
      'publish_now',
    ]);
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

    const signer = new CommandRouter(COMMAND_SECRET);
    await captured.get('approve')!({
      match: signer.createCommandToken('approve', 'bundle-42'),
      chat: { id: 'chat-1' },
    });
    expect(approveHandler).toHaveBeenCalledWith('approve', 'bundle-42', {
      channel: 'telegram',
      sourceId: 'chat-1',
    });

    await captured.get('edit')!({
      match: signer.createCommandToken('edit_caption', 'bundle-43'),
      chat: { id: 'chat-1' },
    });
    // 'edit' maps to edit_caption; no handler registered → nothing
    await captured.get('hold')!({
      match: signer.createCommandToken('hold', 'bundle-44'),
      chat: { id: 'chat-1' },
    });
    expect(holdHandler).toHaveBeenCalledWith('hold', 'bundle-44', {
      channel: 'telegram',
      sourceId: 'chat-1',
    });
  });

  it('passes caption and schedule arguments through slash commands', async () => {
    const captured = new Map<string, (ctx: any) => Promise<void>>();
    vi.spyOn(adapter.getBot(), 'command').mockImplementation(((
      name: string,
      fn: (ctx: any) => Promise<void>,
    ) => {
      captured.set(name, fn);
      return adapter.getBot() as any;
    }) as any);
    const editHandler = vi.fn().mockResolvedValue(undefined);
    const scheduleHandler = vi.fn().mockResolvedValue(undefined);
    adapter.onCommand('edit_caption', editHandler);
    adapter.onCommand('reschedule', scheduleHandler);
    adapter.setupCommands();

    const signer = new CommandRouter(COMMAND_SECRET);
    const editToken = signer.createCommandToken('edit_caption', 'bundle-45');
    await captured.get('edit')!({
      match: `${editToken} Updated caption with spaces`,
      chat: { id: 'chat-1' },
    });
    expect(editHandler).toHaveBeenCalledWith('edit_caption', 'bundle-45', {
      channel: 'telegram',
      sourceId: 'chat-1',
      params: { caption: 'Updated caption with spaces' },
    });

    const scheduleToken = signer.createCommandToken('reschedule', 'bundle-46');
    await captured.get('reschedule')!({
      match: `${scheduleToken} 2026-09-08T18:30:00.000Z`,
      chat: { id: 'chat-1' },
    });
    expect(scheduleHandler).toHaveBeenCalledWith('reschedule', 'bundle-46', {
      channel: 'telegram',
      sourceId: 'chat-1',
      params: { scheduledFor: '2026-09-08T18:30:00.000Z' },
    });
  });

  it('prompts for required values without consuming parameterised callback tokens', async () => {
    const router = new CommandRouter(COMMAND_SECRET);
    const promptedAdapter = new TelegramAdapter(config, router);
    const token = router.createCommandToken('edit_caption', 'bundle-47');
    const answerSpy = vi
      .spyOn(promptedAdapter.getBot().api, 'answerCallbackQuery')
      .mockResolvedValue(true as any);
    const sendSpy = vi
      .spyOn(promptedAdapter.getBot().api, 'sendMessage')
      .mockResolvedValue({ message_id: 2 } as any);

    await promptedAdapter.handleCallback({
      id: 'cb-edit',
      data: token,
      message: { chat: { id: 'chat-1' } },
    });

    expect(answerSpy).toHaveBeenCalledWith('cb-edit', {
      text: 'Send the requested value with the command below.',
    });
    expect(sendSpy).toHaveBeenCalledWith(
      'chat-1',
      `Edit this caption with:\n/edit ${token} <new caption>`,
    );
    expect(router.verifyCommandToken(token)).toEqual({
      action: 'edit_caption',
      cardId: 'bundle-47',
    });
  });
});

describe('startPolling / setWebhook', () => {
  it('startPolling registers commands and starts the bot', async () => {
    const commandSpy = vi
      .spyOn(adapter.getBot(), 'command')
      .mockImplementation(() => adapter.getBot() as any);
    const startSpy = vi.spyOn(adapter.getBot(), 'start').mockResolvedValue();
    await adapter.startPolling();
    expect(commandSpy).toHaveBeenCalled();
    expect(startSpy).toHaveBeenCalledTimes(1);
  });

  it('setWebhook calls the API and registers commands', async () => {
    const commandSpy = vi
      .spyOn(adapter.getBot(), 'command')
      .mockImplementation(() => adapter.getBot() as any);
    const webhookSpy = vi.spyOn(adapter.getBot().api, 'setWebhook').mockResolvedValue(true as any);
    const initSpy = vi.spyOn(adapter.getBot(), 'init').mockResolvedValue();
    await adapter.setWebhook('https://relay.example/hook');
    expect(initSpy).toHaveBeenCalledTimes(1);
    expect(webhookSpy).toHaveBeenCalledWith('https://relay.example/hook', {
      secret_token: 'telegram-webhook-secret',
    });
    expect(commandSpy).toHaveBeenCalled();
  });

  it('forwards provider updates to grammy after the API verifies the webhook secret', async () => {
    const update = { update_id: 1 } as any;
    const handleUpdateSpy = vi.spyOn(adapter.getBot(), 'handleUpdate').mockResolvedValue(undefined);

    await adapter.handleWebhook(update);

    expect(handleUpdateSpy).toHaveBeenCalledWith(update);
  });
});
