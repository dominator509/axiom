// ─── BaseConnector — Vitest Suite ───
// Covers: constructor, idempotency ledger (published/skipped/failed paths),
// logging with MAX_LOG cap, and the HTTP helpers (apiGet/apiPost/apiUpload/apiDelete).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { BaseConnector } from './base.js';
import type {
  ConnectorAuth,
  ConnectorPublishInput,
  ConnectorCapability,
  ConnectorMetrics,
  ValidationReport,
} from './types.js';
import type { Platform, PublishMode } from '@axiom/core';

class TestConnector extends BaseConnector {
  constructor(auth: ConnectorAuth = { accessToken: 'tok' }) {
    super('x' as Platform, 'Test', 'api' as PublishMode, auth);
  }

  capability(): ConnectorCapability {
    return {
      publish: true,
      media: ['image'],
      maxMediaBytes: 10 * 1024 * 1024,
      maxMediaCount: 4,
      caption: true,
      maxCaptionLength: 280,
      scheduling: 'internal',
      metrics: ['likes'],
      refreshMetrics: true,
    };
  }

  async validate(): Promise<ValidationReport> {
    return { valid: true, errors: [], warnings: [], infos: [], tosVerdict: 'pass' };
  }

  publish(input: ConnectorPublishInput) {
    return this.idempotentPublish(input, async () => ({
      remoteId: 'r1',
      state: 'published' as const,
    }));
  }

  async fetchMetrics(remoteId: string): Promise<ConnectorMetrics> {
    return {
      postId: remoteId,
      platform: this.platform,
      collectedAt: new Date().toISOString(),
      metrics: {},
    };
  }

  async revoke(): Promise<void> {}

  // ── Expose protected members for testing ──
  checkIdem(key: string) {
    return this.checkIdempotency(key);
  }
  recordIdem(key: string, remoteId: string | null, state: 'published' | 'failed' | 'skipped') {
    this.recordIdempotency(key, remoteId, state);
  }
  get<T>(url: string, headers?: Record<string, string>) {
    return this.apiGet<T>(url, headers);
  }
  post<T>(url: string, body: unknown, headers?: Record<string, string>) {
    return this.apiPost<T>(url, body, headers);
  }
  upload<T>(url: string, fd: FormData, headers?: Record<string, string>) {
    return this.apiUpload<T>(url, fd, headers);
  }
  del<T>(url: string, headers?: Record<string, string>) {
    return this.apiDelete<T>(url, headers);
  }
  writeLog(level: 'info' | 'warn' | 'error' | 'debug', action: string, message: string) {
    this.log(level, action, message);
  }
}

class ThrowingConnector extends TestConnector {
  publish(input: ConnectorPublishInput) {
    return this.idempotentPublish(input, async () => {
      throw new Error('boom');
    });
  }
}

function input(overrides: Partial<ConnectorPublishInput> = {}): ConnectorPublishInput {
  return {
    idempotencyKey: `key-${Math.random().toString(36).slice(2)}`,
    caption: 'hello',
    mediaUrls: ['https://cdn.example.com/a.jpg'],
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('BaseConnector constructor', () => {
  it('stores platform, displayName, publishMode, and auth', () => {
    const c = new TestConnector({ accessToken: 'abc', refreshToken: 'r', externalUserId: 'uid' });
    expect(c.platform).toBe('x');
    expect(c.displayName).toBe('Test');
    expect(c.publishMode).toBe('api');
    expect(c.auth.accessToken).toBe('abc');
    expect(c.auth.refreshToken).toBe('r');
    expect(c.auth.externalUserId).toBe('uid');
  });
});

describe('idempotency', () => {
  it('returns a fresh result and records it in the ledger on first publish', async () => {
    const c = new TestConnector();
    const result = await c.publish(input({ idempotencyKey: 'key-1' }));
    expect(result).toEqual({ remoteId: 'r1', state: 'published', latencyMs: expect.any(Number) });
    expect(c.checkIdem('key-1')).toMatchObject({
      idempotencyKey: 'key-1',
      remoteId: 'r1',
      state: 'published',
    });
  });

  it('skips and returns the previous remoteId when already published', async () => {
    const c = new TestConnector();
    const i = input({ idempotencyKey: 'key-1' });
    await c.publish(i);
    const second = await c.publish(i);
    expect(second.state).toBe('skipped');
    expect(second.remoteId).toBe('r1');
    expect(second.error).toBeUndefined();
  });

  it('skips with a "Previously skipped" error when the ledger entry is skipped', async () => {
    const c = new TestConnector();
    c.recordIdem('key-1', null, 'skipped');
    const result = await c.publish(input({ idempotencyKey: 'key-1' }));
    expect(result).toEqual({ remoteId: null, state: 'skipped', error: 'Previously skipped' });
  });

  it('retries a previously failed publish', async () => {
    const c = new TestConnector();
    c.recordIdem('key-1', null, 'failed');
    const result = await c.publish(input({ idempotencyKey: 'key-1' }));
    expect(result.state).toBe('published');
    expect(result.remoteId).toBe('r1');
  });

  it('records a failed entry and returns a failed result when doPublish throws', async () => {
    const c = new ThrowingConnector();
    const result = await c.publish(input({ idempotencyKey: 'key-fail-1' }));
    expect(result.state).toBe('failed');
    expect(result.error).toBe('boom');
    expect(result.latencyMs).toEqual(expect.any(Number));
    expect(c.checkIdem('key-fail-1')).toMatchObject({ state: 'failed', remoteId: null });
  });
});

describe('logging', () => {
  it('records structured log entries and returns copies via getLogs', () => {
    const c = new TestConnector();
    c.writeLog('info', 'publish', 'hello world');
    const logs = c.getLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      level: 'info',
      action: 'publish',
      message: 'hello world',
      platform: 'x',
    });
    expect(logs[0].timestamp).toBeTruthy();
  });

  it('caps log history at MAX_LOG (100) entries', () => {
    const c = new TestConnector();
    for (let i = 0; i < 150; i++) {
      c.writeLog('debug', 'loop', `entry ${i}`);
    }
    expect(c.getLogs()).toHaveLength(100);
    expect(c.getLogs()[0].message).toBe('entry 50');
  });
});

describe('apiGet', () => {
  it('performs an authenticated GET and parses JSON', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const c = new TestConnector({ accessToken: 'tok' });
    const result = await c.get<{ ok: boolean }>('https://api.example.com/v1/things');

    expect(result).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/things');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('throws with status details and logs an error on non-ok responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('nope', { status: 500, statusText: 'Internal Server Error' }),
        ),
    );
    const c = new TestConnector();
    await expect(c.get('https://api.example.com/v1/things')).rejects.toThrow(
      'API GET https://api.example.com/v1/things failed: 500 Internal Server Error',
    );
    const errorLogs = c.getLogs().filter((l) => l.level === 'error' && l.action === 'apiGet');
    expect(errorLogs).toHaveLength(1);
  });

  it('propagates network errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network down')));
    const c = new TestConnector();
    await expect(c.get('https://api.example.com/v1/things')).rejects.toThrow('network down');
  });
});

describe('apiPost', () => {
  it('POSTs a JSON-serialized body with auth header', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: 7 }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    const c = new TestConnector({ accessToken: 'tok' });
    const result = await c.post<{ id: number }>('https://api.example.com/v1/create', { name: 'x' });

    expect(result).toEqual({ id: 7 });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ name: 'x' });
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('throws on non-ok responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('bad', { status: 400, statusText: 'Bad Request' })),
    );
    const c = new TestConnector();
    await expect(c.post('https://api.example.com/v1/create', {})).rejects.toThrow(
      'API POST https://api.example.com/v1/create failed: 400 Bad Request',
    );
  });

  it('propagates network errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('boom')));
    const c = new TestConnector();
    await expect(c.post('https://api.example.com/v1/create', {})).rejects.toThrow('boom');
  });
});

describe('apiUpload', () => {
  it('uploads FormData with Bearer auth and no JSON content-type', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ uploaded: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const c = new TestConnector({ accessToken: 'tok' });
    const fd = new FormData();
    fd.append('file', new Blob(['data']), 'a.bin');

    const result = await c.upload<{ uploaded: boolean }>('https://api.example.com/v1/upload', fd);
    expect(result).toEqual({ uploaded: true });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/upload');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(fd);
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok');
    expect(headers['Content-Type']).toBeUndefined();
  });

  it('throws on non-ok responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('x', { status: 503, statusText: 'Unavailable' })),
    );
    const c = new TestConnector();
    const fd = new FormData();
    await expect(c.upload('https://api.example.com/v1/upload', fd)).rejects.toThrow(
      'API Upload to https://api.example.com/v1/upload failed: 503 Unavailable',
    );
  });
});

describe('apiDelete', () => {
  it('sends a DELETE request and parses JSON', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const c = new TestConnector({ accessToken: 'tok' });
    const result = await c.del<{ success: boolean }>('https://api.example.com/v1/things/1');
    expect(result).toEqual({ success: true });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/things/1');
    expect(init.method).toBe('DELETE');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('throws on non-ok responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('nope', { status: 404, statusText: 'Not Found' })),
    );
    const c = new TestConnector();
    await expect(c.del('https://api.example.com/v1/things/1')).rejects.toThrow(
      'API DELETE https://api.example.com/v1/things/1 failed: 404 Not Found',
    );
  });
});
