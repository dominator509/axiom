// ─── IMessageAdapter (BlueBubbles) — Vitest Suite ───
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  IMessageAdapter,
  parseIMessageWebhook,
  type IMessageResponse,
} from './imessage.js';
import type { RelayCard } from '../card.js';
import { CommandRouter } from '../commands.js';

const config = { blueBubblesUrl: 'https://bluebubbles.example', password: 'bb-password' };

let adapter: IMessageAdapter;

beforeEach(() => {
  adapter = new IMessageAdapter(config);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function makeCard(): RelayCard {
  const signer = new CommandRouter('imessage-test-secret');
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
  it('POSTs a text card to the BlueBubbles API with auth headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    await adapter.sendCard('chat-guid-1', makeCard());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url.toString()).toBe(
      'https://bluebubbles.example/api/v1/message/text?password=bb-password',
    );
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(init.body);
    expect(body.chatGuid).toBe('chat-guid-1');
    expect(body.tempGuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.message).toContain('📦 Bundle: bundle-1');
    expect(body.message).toContain('approve');
    expect(body.message).toContain('Actions (reply with the action and its signed token):');
  });

  it('throws when the API returns a non-ok response so the worker can retry', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.stubGlobal('fetch', fetchMock);
    await expect(adapter.sendCard('chat-1', makeCard())).rejects.toThrow(
      'BlueBubbles send failed: HTTP 500',
    );
  });

  it('propagates network failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    await expect(adapter.sendCard('chat-1', makeCard())).rejects.toThrow('ECONNREFUSED');
  });
});

describe('parseResponse', () => {
  it.each(['1', '2', '3', '4', '5', '6', '7', '8', '9'])(
    'rejects ambiguous numeric command "%s"',
    (digit) => {
      expect(adapter.parseResponse({ text: digit, chatId: 'c1' })).toBeNull();
    },
  );

  it('passes edit and schedule arguments as command parameters', () => {
    expect(adapter.parseResponse({ text: 'edit Updated caption', chatId: 'c1' })).toEqual({
      action: 'edit_caption',
      bundleId: '',
      params: { caption: 'Updated caption' },
    });
    expect(adapter.parseResponse({ text: 'schedule 2026-09-08T18:30:00Z', chatId: 'c1' })).toEqual({
      action: 'reschedule',
      bundleId: '',
      params: { scheduledFor: '2026-09-08T18:30:00Z' },
    });
  });

  it('extracts signed tokens from plain commands without changing caption case', () => {
    const router = new CommandRouter('imessage-test-secret');
    const token = router.createCommandToken('edit_caption', 'card-2');
    expect(
      adapter.parseResponse({ text: `edit ${token} Keep This Case`, chatId: 'c1' }),
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
    ['EDIT', 'edit_caption'],
    ['schedule', 'reschedule'],
    ['reschedule', 'reschedule'],
    ['regenerate', 'regenerate'],
    ['revise', 'revise'],
    ['hold', 'hold'],
    ['  hold  ', 'hold'],
    ['go', 'publish_now'],
    ['publish_now', 'publish_now'],
    ['publish now', 'publish_now'],
  ] as const)('maps word "%s" to action %s', (word, action) => {
    const res = adapter.parseResponse({ text: word, chatId: 'c1' } as IMessageResponse);
    expect(res).toEqual({ action, bundleId: '' });
  });

  it.each([
    ['10'],
    ['0'],
    ['change_price'],
    ['hello'],
    [''],
    ['!@#$'],
  ])('returns null for unrecognized text "%s"', (text) => {
    expect(adapter.parseResponse({ text, chatId: 'c1' } as IMessageResponse)).toBeNull();
  });
});

describe('onCommand', () => {
  it('stores action handlers', () => {
    const handler = vi.fn();
    adapter.onCommand('approve', handler);
    // No public invocation path in this adapter; handler is retained for external use
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('BlueBubbles webhook handling', () => {
  it('normalizes a new-message event and ignores self-sent messages', () => {
    expect(
      parseIMessageWebhook({
        type: 'new-message',
        data: {
          message: { text: 'approve token', chatGuid: 'iMessage;-;+15550002222' },
        },
      }),
    ).toEqual({ text: 'approve token', chatId: 'iMessage;-;+15550002222' });
    expect(
      parseIMessageWebhook({
        type: 'new-message',
        data: {
          message: { text: 'approve token', isFromMe: true, chatGuid: 'chat-1' },
        },
      }),
    ).toBeNull();
  });

  it('verifies a signed token before invoking the domain handler', async () => {
    const router = new CommandRouter('imessage-test-secret');
    const routedAdapter = new IMessageAdapter(config, router);
    const handler = vi.fn().mockResolvedValue(undefined);
    routedAdapter.onCommand('approve', handler);
    const token = router.createCommandToken('approve', 'card-3');

    await expect(
      routedAdapter.handleWebhook({
        type: 'new-message',
        data: {
          message: { text: `approve ${token}`, chatGuid: 'chat-3', isFromMe: false },
        },
      }),
    ).resolves.toBe(true);
    expect(handler).toHaveBeenCalledWith('approve', 'card-3', {
      channel: 'imessage',
      sourceId: 'chat-3',
    });
  });
});
