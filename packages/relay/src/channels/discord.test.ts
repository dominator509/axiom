// ─── DiscordAdapter — Vitest Suite ───
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TextChannel, ButtonStyle, type ActionRowBuilder, type ButtonBuilder } from 'discord.js';
import { DiscordAdapter } from './discord.js';
import type { RelayCard, CardAction } from '../card.js';

const config = { token: 'discord-token', clientId: 'client-1' };

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

const FULL_ACTIONS: CardAction[] = [
  'approve', 'approve_all', 'edit_caption', 'change_price', 'reschedule',
  'regenerate', 'revise', 'hold', 'reject', 'approve', 'hold', 'reject',
];

let adapter: DiscordAdapter;

beforeEach(() => {
  adapter = new DiscordAdapter(config);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('construction / getClient / onCommand', () => {
  it('constructs a discord Client with the configured intents', () => {
    const client = adapter.getClient();
    expect(client).toBeDefined();
    expect(client.options.intents).toBeDefined();
  });

  it('stores action handlers', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    adapter.onCommand('approve', handler);
    const interaction = {
      isButton: () => true,
      customId: 'approve:bundle-1',
      reply: vi.fn().mockResolvedValue(undefined),
    };
    await adapter.handleInteraction(interaction as any);
    expect(handler).toHaveBeenCalledWith('approve', 'bundle-1');
    expect(interaction.reply).toHaveBeenCalledWith({ content: 'Action "approve" processed', ephemeral: true });
  });
});

describe('sendCard', () => {
  it('sends a card with an embed and button rows to a TextChannel', async () => {
    const mockSend = vi.fn().mockResolvedValue({});
    const channel = Object.create(TextChannel.prototype) as TextChannel;
    (channel as any).send = mockSend;

    const fetchSpy = vi.spyOn(adapter.getClient().channels, 'fetch').mockResolvedValue(channel);

    await adapter.sendCard('channel-1', makeCard(FULL_ACTIONS));

    expect(fetchSpy).toHaveBeenCalledWith('channel-1');
    expect(mockSend).toHaveBeenCalledTimes(1);
    const [payload] = mockSend.mock.calls[0];
    expect(payload.embeds).toHaveLength(1);
    // 12 actions → 3 rows of ≤5 buttons
    expect(payload.components).toHaveLength(3);
    const row0 = payload.components[0] as ActionRowBuilder<ButtonBuilder>;
    expect(row0.components).toHaveLength(5);
    const row2 = payload.components[2] as ActionRowBuilder<ButtonBuilder>;
    expect(row2.components).toHaveLength(2);
  });

  it('renders correct button labels, custom ids and styles', async () => {
    const mockSend = vi.fn().mockResolvedValue({});
    const channel = Object.create(TextChannel.prototype) as TextChannel;
    (channel as any).send = mockSend;
    vi.spyOn(adapter.getClient().channels, 'fetch').mockResolvedValue(channel);

    await adapter.sendCard('channel-1', makeCard(['approve', 'reject', 'hold', 'edit_caption', 'change_price']));

    const [payload] = mockSend.mock.calls[0];
    const row = payload.components[0] as ActionRowBuilder<ButtonBuilder>;
    const buttons = row.components.map((b) => b.data);
    expect(buttons[0]).toMatchObject({ custom_id: 'approve:bundle-1', label: '✅ Approve', style: ButtonStyle.Success });
    expect(buttons[1]).toMatchObject({ custom_id: 'reject:bundle-1', label: '❌ Reject', style: ButtonStyle.Danger });
    expect(buttons[2]).toMatchObject({ custom_id: 'hold:bundle-1', label: '⏸️ Hold', style: ButtonStyle.Secondary });
    expect(buttons[3]).toMatchObject({ custom_id: 'edit_caption:bundle-1', label: '✏️ Edit', style: ButtonStyle.Primary });
    expect(buttons[4]).toMatchObject({ custom_id: 'change_price:bundle-1', label: '💰 Price', style: ButtonStyle.Primary });
  });

  it('does not send when the resolved channel is not a TextChannel', async () => {
    const mockSend = vi.fn();
    // A DM channel is not a TextChannel — must not trigger a send
    const dmChannel = { send: mockSend } as unknown as TextChannel;
    (dmChannel as any).send = mockSend;
    vi.spyOn(adapter.getClient().channels, 'fetch').mockResolvedValue(dmChannel);

    await adapter.sendCard('channel-1', makeCard(['approve']));
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('does not send when fetch resolves to undefined', async () => {
    const fetchSpy = vi.spyOn(adapter.getClient().channels, 'fetch').mockResolvedValue(undefined as any);
    await adapter.sendCard('missing', makeCard(['approve']));
    expect(fetchSpy).toHaveBeenCalledWith('missing');
  });

  it('propagates fetch failures', async () => {
    vi.spyOn(adapter.getClient().channels, 'fetch').mockRejectedValue(new Error('rate limited'));
    await expect(adapter.sendCard('channel-1', makeCard(['approve']))).rejects.toThrow('rate limited');
  });

  it('builds a single row for 5 or fewer actions', async () => {
    const mockSend = vi.fn().mockResolvedValue({});
    const channel = Object.create(TextChannel.prototype) as TextChannel;
    (channel as any).send = mockSend;
    vi.spyOn(adapter.getClient().channels, 'fetch').mockResolvedValue(channel);

    await adapter.sendCard('channel-1', makeCard(['approve', 'reject', 'hold']));
    const [payload] = mockSend.mock.calls[0];
    expect(payload.components).toHaveLength(1);
    expect(payload.components[0].components).toHaveLength(3);
  });
});

describe('handleInteraction', () => {
  it('ignores non-button interactions', async () => {
    const interaction = { isButton: () => false, customId: 'approve:bundle-1' };
    await expect(adapter.handleInteraction(interaction as any)).resolves.toBeUndefined();
  });

  it('ignores button interactions with no registered handler', async () => {
    const interaction = {
      isButton: () => true,
      customId: 'approve:bundle-1',
      reply: vi.fn(),
    };
    await adapter.handleInteraction(interaction as any);
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it('handles malformed custom ids gracefully', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    adapter.onCommand('approve', handler);
    const interaction = {
      isButton: () => true,
      customId: 'no-colon-here',
      reply: vi.fn().mockResolvedValue(undefined),
    };
    await adapter.handleInteraction(interaction as any);
    // action 'no-colon-here' is not a registered handler → no reply, no crash
    expect(handler).not.toHaveBeenCalled();
    expect(interaction.reply).not.toHaveBeenCalled();
  });
});

describe('login', () => {
  it('logs in with the configured token', async () => {
    const loginSpy = vi.spyOn(adapter.getClient(), 'login').mockResolvedValue('token-string' as any);
    await adapter.login();
    expect(loginSpy).toHaveBeenCalledWith('discord-token');
  });
});
