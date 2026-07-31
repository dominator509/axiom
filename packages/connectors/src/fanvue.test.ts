// ─── Fanvue Connector — Vitest Suite ───
// Covers: capability(), validate() (media + caption rules), publish() upload→post flow
// with mocked fetch, idempotency, failure paths, fetchMetrics(), and revoke().

import { describe, it, expect, vi, afterEach } from 'vitest';
import { FanvueConnector } from './fanvue.js';
import type { ConnectorAuth, ConnectorPublishInput } from './types.js';

const AUTH: ConnectorAuth = {
  accessToken: 'fanvue-token',
  externalUserId: 'model-42',
};

function input(overrides: Partial<ConnectorPublishInput> = {}): ConnectorPublishInput {
  return {
    idempotencyKey: `fk-${Math.random().toString(36).slice(2)}`,
    caption: 'Check out my new post!',
    mediaUrls: ['https://cdn.example.com/photo.jpg'],
    hashtags: ['summer', 'model'],
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('FanvueConnector', () => {
  it('declares fanvue capabilities', () => {
    const c = new FanvueConnector(AUTH);
    const cap = c.capability();
    expect(cap.publish).toBe(true);
    expect(cap.media).toEqual(['image', 'video']);
    expect(cap.maxMediaBytes).toBe(200_000_000);
    expect(cap.maxMediaCount).toBe(10);
    expect(cap.maxCaptionLength).toBe(2200);
    expect(cap.scheduling).toBe('internal');
    expect(cap.metrics).toEqual(['views', 'likes', 'comments']);
  });

  it('exposes platform, displayName, publishMode and stores modelId from externalUserId', () => {
    const c = new FanvueConnector(AUTH);
    expect(c.platform).toBe('fanvue');
    expect(c.displayName).toBe('Fanvue');
    expect(c.publishMode).toBe('api');
  });
});

describe('validate', () => {
  it('passes a valid input', async () => {
    const c = new FanvueConnector(AUTH);
    const report = await c.validate(input());
    expect(report.valid).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.tosVerdict).toBe('pass');
  });

  it('errors when mediaUrls is empty', async () => {
    const c = new FanvueConnector(AUTH);
    const report = await c.validate(input({ mediaUrls: [] }));
    expect(report.valid).toBe(false);
    expect(report.errors).toContainEqual({
      field: 'mediaUrls',
      message: 'Fanvue requires at least one media file',
      severity: 'error',
    });
  });

  it('errors when the caption is an empty string', async () => {
    const c = new FanvueConnector(AUTH);
    const report = await c.validate(input({ caption: '' }));
    expect(report.valid).toBe(false);
    expect(report.errors).toContainEqual({
      field: 'caption',
      message: 'Fanvue posts require a caption',
      severity: 'error',
    });
  });

  it('errors when the caption is missing (regression: previously passed)', async () => {
    const c = new FanvueConnector(AUTH);
    const report = await c.validate(input({ caption: undefined as unknown as string }));
    expect(report.valid).toBe(false);
    expect(report.errors.some((e) => e.field === 'caption')).toBe(true);
  });

  it('accumulates multiple errors', async () => {
    const c = new FanvueConnector(AUTH);
    const report = await c.validate(input({ caption: '', mediaUrls: [] }));
    expect(report.errors).toHaveLength(2);
  });
});

describe('publish', () => {
  it('uploads media then creates the post, returning remoteId and postUrl', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'asset-1', url: 'https://cdn.fanvue.com/asset-1' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'post-1', url: 'https://fanvue.com/post-1', status: 'published' }));
    vi.stubGlobal('fetch', fetchMock);

    const c = new FanvueConnector(AUTH);
    const result = await c.publish(input());

    expect(result.state).toBe('published');
    expect(result.remoteId).toBe('post-1');
    expect(result.postUrl).toBe('https://fanvue.com/post-1');
    expect(result.latencyMs).toEqual(expect.any(Number));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [uploadUrl, uploadInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(uploadUrl).toBe('https://mcp.fanvue.com/v1/upload');
    expect(JSON.parse(uploadInit.body as string)).toEqual({
      url: 'https://cdn.example.com/photo.jpg',
      model_id: 'model-42',
    });

    const [postUrl, postInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(postUrl).toBe('https://mcp.fanvue.com/v1/posts');
    const postBody = JSON.parse(postInit.body as string) as Record<string, unknown>;
    expect(postBody.model_id).toBe('model-42');
    expect(postBody.media_ids).toEqual(['asset-1']);
    expect(postBody.caption).toBe('Check out my new post!');
    expect(postBody.hashtags).toEqual(['summer', 'model']);
    expect(postBody.scheduled_for).toBeNull();
  });

  it('passes scheduled_for through when provided', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'asset-1', url: 'https://cdn.fanvue.com/asset-1' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'post-1', url: 'https://fanvue.com/post-1', status: 'published' }));
    vi.stubGlobal('fetch', fetchMock);

    const c = new FanvueConnector(AUTH);
    await c.publish(input({ scheduledFor: '2026-08-02T10:00:00Z' }));

    const postBody = JSON.parse((fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string) as Record<string, unknown>;
    expect(postBody.scheduled_for).toBe('2026-08-02T10:00:00Z');
  });

  it('uploads every media URL before posting', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'asset-1', url: 'u1' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'asset-2', url: 'u2' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'post-1', url: 'https://fanvue.com/post-1', status: 'published' }));
    vi.stubGlobal('fetch', fetchMock);

    const c = new FanvueConnector(AUTH);
    const result = await c.publish(input({ mediaUrls: ['https://a.jpg', 'https://b.mp4'] }));
    expect(result.state).toBe('published');
    const postBody = JSON.parse((fetchMock.mock.calls[2] as [string, RequestInit])[1].body as string) as { media_ids: string[] };
    expect(postBody.media_ids).toEqual(['asset-1', 'asset-2']);
  });

  it('is idempotent: a repeated publish with the same key is skipped without new requests', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'asset-1', url: 'u1' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'post-1', url: 'https://fanvue.com/post-1', status: 'published' }));
    vi.stubGlobal('fetch', fetchMock);

    const c = new FanvueConnector(AUTH);
    const i = input({ idempotencyKey: 'same-key' });
    const first = await c.publish(i);
    const second = await c.publish(i);

    expect(first.state).toBe('published');
    expect(second.state).toBe('skipped');
    expect(second.remoteId).toBe('post-1');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns a failed result when the upload endpoint fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'nope' }, 500))
      .mockResolvedValueOnce(jsonResponse({ id: 'post-1', url: 'u', status: 'published' }));
    vi.stubGlobal('fetch', fetchMock);

    const c = new FanvueConnector(AUTH);
    const result = await c.publish(input());
    expect(result.state).toBe('failed');
    expect(result.error).toContain('API POST https://mcp.fanvue.com/v1/upload failed: 500');
    expect(result.remoteId).toBeNull();
  });

  it('returns a failed result when the post creation fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'asset-1', url: 'u1' }))
      .mockResolvedValueOnce(jsonResponse({ error: 'x' }, 422));
    vi.stubGlobal('fetch', fetchMock);

    const c = new FanvueConnector(AUTH);
    const result = await c.publish(input());
    expect(result.state).toBe('failed');
    expect(result.error).toContain('API POST https://mcp.fanvue.com/v1/posts failed: 422');
  });

  it('returns a failed result on network errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('socket hang up')));
    const c = new FanvueConnector(AUTH);
    const result = await c.publish(input());
    expect(result.state).toBe('failed');
    expect(result.error).toContain('socket hang up');
  });
});

describe('fetchMetrics', () => {
  it('maps analytics response into ConnectorMetrics', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ views: 100, likes: 12, comments: 3, revenue: 500 })),
    );
    const c = new FanvueConnector(AUTH);
    const metrics = await c.fetchMetrics('post-1');

    expect(metrics.postId).toBe('post-1');
    expect(metrics.platform).toBe('fanvue');
    expect(metrics.metrics).toEqual({ views: 100, likes: 12, comments: 3 });
    expect(metrics.collectedAt).toBeTruthy();

    const [url, init] = (vi.mocked(fetch).mock.calls[0] ?? []) as [string, RequestInit];
    expect(url).toBe('https://mcp.fanvue.com/v1/analytics/posts/post-1');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer fanvue-token');
  });

  it('throws when the analytics endpoint fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 500)));
    const c = new FanvueConnector(AUTH);
    await expect(c.fetchMetrics('post-1')).rejects.toThrow('API GET');
  });
});

describe('revoke', () => {
  it('posts to the revoke endpoint and logs the event', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const c = new FanvueConnector(AUTH);
    await c.revoke();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://mcp.fanvue.com/v1/auth/revoke');
    expect(JSON.parse(init.body as string)).toEqual({ model_id: 'model-42' });
    expect(c.getLogs().some((l) => l.action === 'revoke' && l.message === 'Fanvue MCP access revoked')).toBe(true);
  });
});
