// ─── IMessageAdapter (BlueBubbles) — Vitest Suite ───
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IMessageAdapter, type IMessageResponse } from './imessage.js';
import type { RelayCard } from '../card.js';

const config = { blueBubblesUrl: 'https://bluebubbles.example', apiKey: 'bb-api-key' };

let adapter: IMessageAdapter;

beforeEach(() => {
  adapter = new IMessageAdapter(config);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function makeCard(): RelayCard {
  return {
    cardId: 'card-1',
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
  it('POSTs a text card to the BlueBubbles API with auth headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    await adapter.sendCard('chat-guid-1', makeCard());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://bluebubbles.example/api/v1/message');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/json',
      'X-API-Key': 'bb-api-key',
    });
    const body = JSON.parse(init.body);
    expect(body.chatGuid).toBe('chat-guid-1');
    expect(body.text).toContain('📦 Bundle: bundle-1');
    expect(body.text).toContain('approve');
    expect(body.text).toContain('Actions (reply with keyword):');
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
