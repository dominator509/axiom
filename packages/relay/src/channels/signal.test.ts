// ─── SignalAdapter — Vitest Suite ───
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SignalAdapter, parseSignalNotification, type SignalMessage } from './signal.js';
import type { RelayCard } from '../card.js';
import { CommandRouter } from '../commands.js';

vi.mock('execa', () => ({
  execa: vi.fn(),
}));

import { execa } from 'execa';

const mockedExeca = vi.mocked(execa);

const config = { cliPath: '/usr/bin/signal-cli', account: '+15550001111' };

let adapter: SignalAdapter;

beforeEach(() => {
  adapter = new SignalAdapter(config);
  mockedExeca.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeCard(): RelayCard {
  const signer = new CommandRouter('signal-test-secret');
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
    actions: ['approve', 'reject'],
    commandTokens: {
      approve: signer.createCommandToken('approve', cardId),
      reject: signer.createCommandToken('reject', cardId),
    },
    timestamp: 1_700_000_000_000,
    format: 'html',
  };
}

describe('sendCard', () => {
  it('invokes the signal CLI with send args and the rendered text', async () => {
    mockedExeca.mockResolvedValue({ stdout: '', stderr: '' } as any);

    await adapter.sendCard('+15559998888', makeCard());

    expect(mockedExeca).toHaveBeenCalledTimes(1);
    const [cliPath, args, options] = mockedExeca.mock.calls[0] as unknown as [
      string,
      string[],
      { timeout?: number },
    ];
    expect(cliPath).toBe('/usr/bin/signal-cli');
    expect(args).toEqual([
      'send',
      '-a',
      '+15550001111',
      '+15559998888',
      expect.stringContaining('📦 Bundle: bundle-1'),
    ]);
    expect(args[4]).toContain('approve');
    expect(args[4]).toContain('Actions (reply with the action and its signed token):');
    expect(options).toEqual({ timeout: 30_000 });
  });

  it('propagates CLI failures', async () => {
    mockedExeca.mockRejectedValue(new Error('signal-cli exited with code 1'));
    await expect(adapter.sendCard('+15559998888', makeCard())).rejects.toThrow(
      'signal-cli exited with code 1',
    );
  });
});

describe('parseResponse', () => {
  it.each(['1', '2', '3', '4', '5', '6', '7', '8', '9'])(
    'rejects ambiguous numeric command "%s"',
    (digit) => {
      expect(adapter.parseResponse({ text: digit, source: 'x', timestamp: 1 })).toBeNull();
    },
  );

  it('passes edit and schedule arguments as command parameters', () => {
    expect(
      adapter.parseResponse({ text: 'edit Updated caption', source: 'x', timestamp: 1 }),
    ).toEqual({ action: 'edit_caption', bundleId: '', params: { caption: 'Updated caption' } });
    expect(
      adapter.parseResponse({ text: 'schedule 2026-09-08T18:30:00Z', source: 'x', timestamp: 1 }),
    ).toEqual({
      action: 'reschedule',
      bundleId: '',
      params: { scheduledFor: '2026-09-08T18:30:00Z' },
    });
  });

  it('extracts signed tokens from plain commands without changing caption case', () => {
    const router = new CommandRouter('signal-test-secret');
    const token = router.createCommandToken('edit_caption', 'card-2');
    expect(
      adapter.parseResponse({ text: `edit ${token} Keep This Case`, source: 'x', timestamp: 1 }),
    ).toEqual({
      action: 'edit_caption',
      bundleId: '',
      commandToken: token,
      params: { caption: 'Keep This Case' },
    });
  });

  it.each([
    ['approve', 'approve'],
    ['approve_all', 'approve_all'],
    ['reject', 'reject'],
    ['edit', 'edit_caption'],
    ['Schedule', 'reschedule'],
    ['reschedule', 'reschedule'],
    ['regenerate', 'regenerate'],
    ['revise', 'revise'],
    ['hold', 'hold'],
    ['go', 'publish_now'],
    ['publish_now', 'publish_now'],
    ['publish now', 'publish_now'],
  ] as const)('maps word "%s" to action %s', (word, action) => {
    const res = adapter.parseResponse({ text: word, source: 'x', timestamp: 1 } as SignalMessage);
    expect(res).toEqual({ action, bundleId: '' });
  });

  it.each([['10'], ['0'], ['change_price'], ['banana'], ['']])(
    'returns null for unrecognized text "%s"',
    (text) => {
      expect(
        adapter.parseResponse({ text, source: 'x', timestamp: 1 } as SignalMessage),
      ).toBeNull();
    },
  );
});

describe('onCommand', () => {
  it('stores action handlers', () => {
    const handler = vi.fn();
    adapter.onCommand('approve', handler);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('inbound JSON-RPC receive handling', () => {
  it('normalizes a Signal receive notification, including group chat identity', () => {
    expect(
      parseSignalNotification({
        method: 'receive',
        params: {
          envelope: {
            source: '+15550002222',
            timestamp: 123,
            dataMessage: {
              message: 'approve token',
              groupInfo: { groupId: 'group-1' },
            },
          },
        },
      }),
    ).toEqual({
      source: '+15550002222',
      chatId: 'group-1',
      text: 'approve token',
      timestamp: 123,
    });
    expect(
      parseSignalNotification(
        JSON.stringify({
          params: {
            envelope: {
              source: '+15550002222',
              dataMessage: { message: 'approve token' },
            },
          },
        }),
      ),
    ).toMatchObject({ source: '+15550002222', text: 'approve token' });
  });

  it('rejects oversized JSON-RPC notifications before parsing', () => {
    const oversized = JSON.stringify({
      params: {
        envelope: {
          source: '+15550002222',
          dataMessage: { message: 'x'.repeat(256 * 1024) },
        },
      },
    });

    expect(Buffer.byteLength(oversized, 'utf8')).toBeGreaterThan(256 * 1024);
    expect(parseSignalNotification(oversized)).toBeNull();
  });

  it('verifies a signed token before invoking the domain handler', async () => {
    const router = new CommandRouter('signal-test-secret');
    const routedAdapter = new SignalAdapter(config, router);
    const handler = vi.fn().mockResolvedValue(undefined);
    routedAdapter.onCommand('approve', handler);
    const token = router.createCommandToken('approve', 'card-3');

    await expect(
      routedAdapter.handleMessage({
        source: '+15550002222',
        text: `approve ${token}`,
        timestamp: 1,
      }),
    ).resolves.toBe(true);
    expect(handler).toHaveBeenCalledWith('approve', 'card-3', {
      channel: 'signal',
      sourceId: '+15550002222',
    });
    await expect(
      routedAdapter.handleMessage({
        source: '+15550002222',
        text: `approve ${token}`,
        timestamp: 2,
      }),
    ).resolves.toBe(false);
  });
});
