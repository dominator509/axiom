// ─── ThreadsAdapter (Meta Webhooks) — Vitest Suite ───
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { ThreadsAdapter } from './threads.js';
import type { RelayCard, CardAction } from '../card.js';

const config = {
  clientId: 'threads-client',
  clientSecret: 'threads-secret',
  verifyToken: 'verify-me',
};

function signPayload(payload: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(payload, 'utf-8').digest('hex');
}

let adapter: ThreadsAdapter;

beforeEach(() => {
  adapter = new ThreadsAdapter(config);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('handleVerification', () => {
  it('accepts a valid subscribe challenge', () => {
    const res = adapter.handleVerification({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'verify-me',
      'hub.challenge': 'challenge-abc',
    });
    expect(res).toEqual({ status: 200, body: 'challenge-abc' });
  });

  it('rejects a wrong verify token', () => {
    const res = adapter.handleVerification({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'wrong',
      'hub.challenge': 'challenge-abc',
    });
    expect(res).toEqual({ status: 403, body: 'Forbidden' });
  });

  it('rejects a non-subscribe mode', () => {
    const res = adapter.handleVerification({
      'hub.mode': 'unsubscribe',
      'hub.verify_token': 'verify-me',
      'hub.challenge': 'challenge-abc',
    });
    expect(res).toEqual({ status: 403, body: 'Forbidden' });
  });

  it('rejects a missing challenge', () => {
    const res = adapter.handleVerification({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'verify-me',
    });
    expect(res).toEqual({ status: 403, body: 'Forbidden' });
  });

  it('rejects an empty query', () => {
    expect(adapter.handleVerification({})).toEqual({ status: 403, body: 'Forbidden' });
  });
});

describe('validateSignature', () => {
  it('accepts a correctly signed payload', () => {
    expect(adapter.validateSignature('raw-body', signPayload('raw-body', 'threads-secret'))).toBe(
      true,
    );
  });

  it('rejects a tampered payload', () => {
    expect(adapter.validateSignature('raw-body', signPayload('tampered', 'threads-secret'))).toBe(
      false,
    );
  });

  it('rejects a signature produced with a different secret', () => {
    expect(adapter.validateSignature('raw-body', signPayload('raw-body', 'other-secret'))).toBe(
      false,
    );
  });

  it('rejects missing or malformed signature headers', () => {
    expect(adapter.validateSignature('raw-body', undefined)).toBe(false);
    expect(adapter.validateSignature('raw-body', '')).toBe(false);
    expect(adapter.validateSignature('raw-body', 'sha1=deadbeef')).toBe(false);
    expect(adapter.validateSignature('raw-body', 'not-a-signature')).toBe(false);
  });
});

describe('handleWebhook', () => {
  it('rejects non-threads objects', async () => {
    const res = await adapter.handleWebhook({ object: 'instagram', entry: [] }, '{}');
    expect(res).toEqual({ status: 400, body: 'Invalid object type' });
  });

  it('rejects an invalid signature with 403', async () => {
    const payload = { object: 'threads', entry: [{ time: 1, id: 'u1', changes: [] }] };
    const res = await adapter.handleWebhook(payload, JSON.stringify(payload), 'sha256=bad');
    expect(res).toEqual({ status: 403, body: 'Invalid signature' });
  });

  it('accepts a valid signature and processes changes', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const payload = {
      object: 'threads',
      entry: [
        {
          time: 1,
          id: 'user-123456',
          changes: [
            { field: 'comments', value: { id: 'post-1', text: 'nice' } },
            { field: 'mentions', value: { id: 'user-2' } },
            { field: 'unknown-field', value: {} },
          ],
        },
      ],
    };
    const raw = JSON.stringify(payload);
    const res = await adapter.handleWebhook(payload, raw, signPayload(raw, 'threads-secret'));
    expect(res).toEqual({ status: 200, body: 'EVENT_RECEIVED' });
    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('[comment_received]'));
    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('[mention_received]'));
    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('[unknown_change]'));
    expect(warnSpy).not.toHaveBeenCalled();
    infoSpy.mockRestore();
    warnSpy.mockRestore();
    debugSpy.mockRestore();
  });

  it('accepts unsigned webhooks when no signature header is provided', async () => {
    const payload = { object: 'threads', entry: [] };
    const res = await adapter.handleWebhook(payload, JSON.stringify(payload));
    expect(res).toEqual({ status: 200, body: 'EVENT_RECEIVED' });
  });

  it('ignores messaging events without error', async () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const payload = {
      object: 'threads',
      entry: [{ time: 1, id: 'u1', messaging: [{ sender: { id: 'x' }, message: { text: 'hi' } }] }],
    };
    const res = await adapter.handleWebhook(payload, JSON.stringify(payload));
    expect(res).toEqual({ status: 200, body: 'EVENT_RECEIVED' });
    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('[message_received]'));
    debugSpy.mockRestore();
  });

  it('handles entries with no changes and no messaging', async () => {
    const payload = { object: 'threads', entry: [{ time: 1, id: 'u1' }] };
    const res = await adapter.handleWebhook(payload, JSON.stringify(payload));
    expect(res).toEqual({ status: 200, body: 'EVENT_RECEIVED' });
  });
});

describe('onCommand / sendCard / startPolling', () => {
  it('stores handlers and logs unsupported card delivery', async () => {
    const handler = vi.fn();
    adapter.onCommand('approve', handler);
    expect(handler).not.toHaveBeenCalled(); // handler only invoked externally

    const infoSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const card: RelayCard = {
      bundleId: 'bundle-1',
      mediaPreview: '',
      caption: 'c',
      captionVariants: {},
      hashtagSets: {},
      verdicts: [],
      targetPlatforms: ['threads'],
      actions: ['approve' as CardAction],
      timestamp: 1,
      format: 'html',
    };
    await adapter.sendCard('user-1', card);
    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('[send_card_unsupported]'));
    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('bundle-1'));
    infoSpy.mockRestore();
  });

  it('logs polling configuration', async () => {
    const infoSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await adapter.startPolling('user-123456', 'access-token-123', 30_000);
    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('[polling_configured]'));
    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('30000ms'));
    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('token length: 16'));
    infoSpy.mockRestore();
  });
});
