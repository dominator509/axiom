// ─── SignalAdapter — Vitest Suite ───
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SignalAdapter, type SignalMessage } from './signal.js';
import type { RelayCard } from '../card.js';

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
  return {
    bundleId: 'bundle-1',
    mediaPreview: 'https://cdn.example/1.jpg',
    caption: 'Test caption',
    captionVariants: {},
    hashtagSets: {},
    verdicts: [{ platform: 'tiktok', passed: true, score: 0.9, reason: 'ok' }],
    targetPlatforms: ['tiktok'],
    actions: ['approve', 'reject'],
    timestamp: 1_700_000_000_000,
    format: 'html',
  };
}

describe('sendCard', () => {
  it('invokes the signal CLI with send args and the rendered text', async () => {
    mockedExeca.mockResolvedValue({ stdout: '', stderr: '' } as any);

    await adapter.sendCard('+15559998888', makeCard());

    expect(mockedExeca).toHaveBeenCalledTimes(1);
    const [cliPath, args] = mockedExeca.mock.calls[0] as unknown as [string, string[]];
    expect(cliPath).toBe('/usr/bin/signal-cli');
    expect(args).toEqual([
      'send',
      '-a',
      '+15550001111',
      '+15559998888',
      expect.stringContaining('📦 Bundle: bundle-1'),
    ]);
    expect(args[4]).toContain('1. approve');
  });

  it('propagates CLI failures', async () => {
    mockedExeca.mockRejectedValue(new Error('signal-cli exited with code 1'));
    await expect(adapter.sendCard('+15559998888', makeCard())).rejects.toThrow(
      'signal-cli exited with code 1',
    );
  });
});

describe('parseResponse', () => {
  it.each([
    ['1', 'approve'],
    ['2', 'approve_all'],
    ['3', 'reject'],
    ['4', 'edit_caption'],
    ['5', 'change_price'],
    ['6', 'reschedule'],
    ['7', 'regenerate'],
    ['8', 'revise'],
    ['9', 'hold'],
  ] as const)('maps digit "%s" to action %s', (digit, action) => {
    const res = adapter.parseResponse({ text: digit, source: 'x', timestamp: 1 } as SignalMessage);
    expect(res).toEqual({ action, bundleId: '' });
  });

  it.each([
    ['approve', 'approve'],
    ['reject', 'reject'],
    ['edit', 'edit_caption'],
    ['Schedule', 'reschedule'],
    ['regenerate', 'regenerate'],
    ['revise', 'revise'],
    ['hold', 'hold'],
  ] as const)('maps word "%s" to action %s', (word, action) => {
    const res = adapter.parseResponse({ text: word, source: 'x', timestamp: 1 } as SignalMessage);
    expect(res).toEqual({ action, bundleId: '' });
  });

  it.each([['10'], ['0'], ['approve_all'], ['change_price'], ['reschedule'], ['banana'], ['']])(
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
