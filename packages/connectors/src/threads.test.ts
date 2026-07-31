// ─── Threads Connector — Vitest Suite ───
// Covers: capability(), validate(), publish() container + publish flow,
// missing externalUserId, fetchMetrics(), revoke().

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ThreadsConnector } from './threads.js';
import type { ConnectorAuth, ConnectorPublishInput } from './types.js';

const AUTH: ConnectorAuth = {
  accessToken: 'threads-token',
  externalUserId: 'threads-user-1',
  extra: { username: 'axiom' },
};

function input(overrides: Partial<ConnectorPublishInput> = {}): ConnectorPublishInput {
  return {
    idempotencyKey: `thk-${Math.random().toString(36).slice(2)}`,
    caption: 'Hello Threads',
    mediaUrls: ['https://cdn.example.com/photo.jpg'],
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ThreadsConnector', () => {
  it('declares threads capabilities', () => {
    const cap = new ThreadsConnector(AUTH).capability();
    expect(cap.media).toEqual(['image', 'video']);
    expect(cap.maxMediaCount).toBe(10);
    expect(cap.maxCaptionLength).toBe(500);
    expect(cap.metrics).toEqual(['impressions', 'likes', 'comments', 'shares', 'reposts', 'quotes']);
  });

  it('validates via validatePublish', async () => {
    const c = new ThreadsConnector(AUTH);
    expect((await c.validate(input())).valid).toBe(true);
    expect((await c.validate(input({ caption: 'x'.repeat(600) }))).valid).toBe(false);
  });
});

describe('publish', () => {
  it('creates containers with the right media_type and publishes them', async () => {
    // Source flow: create ALL containers first, then publish each (4 calls)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'c1' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'c2' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'p1' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'p2' }));
    vi.stubGlobal('fetch', fetchMock);

    const c = new ThreadsConnector(AUTH);
    const result = await c.publish(
      input({ mediaUrls: ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.mp4'] }),
    );

    expect(result.state).toBe('published');
    expect(result.remoteId).toBe('p2');
    expect(result.postUrl).toBe('https://www.threads.net/@axiom/post/p2');

    // Container creation calls come first (both)
    const create1 = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(create1[0]).toBe('https://graph.threads.net/v1.0/threads-user-1/threads');
    expect(JSON.parse(create1[1].body as string)).toMatchObject({
      media_type: 'IMAGE',
      text: 'Hello Threads',
      media_url: 'https://cdn.example.com/a.jpg',
    });

    const create2 = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(create2[1].body as string)).toMatchObject({
      media_type: 'VIDEO',
      media_url: 'https://cdn.example.com/b.mp4',
    });

    // Publish calls follow, in container order
    const publish1 = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(publish1[0]).toBe('https://graph.threads.net/v1.0/threads-user-1/threads_publish');
    expect(JSON.parse(publish1[1].body as string)).toMatchObject({ creation_id: 'c1' });

    const publish2 = fetchMock.mock.calls[3] as [string, RequestInit];
    expect(JSON.parse(publish2[1].body as string)).toMatchObject({ creation_id: 'c2' });
  });

  it('fails fast when externalUserId is missing', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const c = new ThreadsConnector({ accessToken: 'threads-token' });
    const result = await c.publish(input());
    expect(result.state).toBe('failed');
    expect(result.error).toContain('externalUserId (Threads User ID) is required');
  });

  it('returns failed when container creation fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'x' }, 400)));
    const c = new ThreadsConnector(AUTH);
    const result = await c.publish(input());
    expect(result.state).toBe('failed');
  });
});

describe('fetchMetrics', () => {
  it('maps insights to metrics', async () => {
    const data = {
      data: [
        { name: 'impressions', period: 'day', values: [{ value: 90 }] },
        { name: 'likes', period: 'day', values: [{ value: 9 }] },
      ],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(data)));
    const c = new ThreadsConnector(AUTH);
    const metrics = await c.fetchMetrics('p1');

    expect(metrics.metrics).toEqual({
      impressions: 90,
      likes: 9,
      comments: 0,
      shares: 0,
      reposts: 0,
      quotes: 0,
    });

    const [url] = vi.mocked(fetch).mock.calls[0] as [string];
    expect(url).toContain('/threads-user-1/threads');
    expect(url).toContain('fields=insights.metric(impressions,likes,comments,shares,reposts,quotes)');
  });

  it('throws when the metrics fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 500)));
    const c = new ThreadsConnector(AUTH);
    await expect(c.fetchMetrics('p1')).rejects.toThrow('Threads metrics fetch failed');
  });
});

describe('revoke', () => {
  it('deletes permissions when externalUserId is set', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true }));
    vi.stubGlobal('fetch', fetchMock);

    const c = new ThreadsConnector(AUTH);
    await c.revoke();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://graph.threads.net/v1.0/threads-user-1/permissions?access_token=threads-token');
    expect(init.method).toBe('DELETE');
  });

  it('skips when externalUserId is missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const c = new ThreadsConnector({ accessToken: 't' });
    await expect(c.revoke()).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
