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
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ThreadsConnector', () => {
  it('declares threads capabilities', () => {
    const cap = new ThreadsConnector(AUTH).capability();
    expect(cap.media).toEqual(['image', 'video', 'carousel']);
    expect(cap.maxMediaCount).toBe(20);
    expect(cap.maxCaptionLength).toBe(500);
    expect(cap.metrics).toEqual([
      'impressions',
      'likes',
      'comments',
      'shares',
      'reposts',
      'quotes',
    ]);
  });

  it('validates via validatePublish', async () => {
    const c = new ThreadsConnector(AUTH);
    expect((await c.validate(input())).valid).toBe(true);
    expect((await c.validate(input({ caption: 'x'.repeat(600) }))).valid).toBe(false);
  });
});

describe('publish', () => {
  it('creates containers with the right media_type and publishes them', async () => {
    // Source flow: create child containers, create the carousel parent, then
    // publish the parent (4 calls).
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'c1' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'c1', status: 'FINISHED' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'c2' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'c2', status: 'FINISHED' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'parent-1' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'parent-1', status: 'FINISHED' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'p1' }));
    vi.stubGlobal('fetch', fetchMock);

    const c = new ThreadsConnector(AUTH);
    const result = await c.publish(
      input({ mediaUrls: ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.mp4'] }),
    );

    expect(result.state).toBe('published');
    expect(result.remoteId).toBe('p1');
    expect(result.postUrl).toBe('https://www.threads.net/@axiom/post/p1');

    // Container creation calls come first (both)
    const create1 = fetchMock.mock.calls[0] as [string, RequestInit];
    const create1Url = new URL(create1[0]);
    expect(create1Url.origin + create1Url.pathname).toBe(
      'https://graph.threads.net/v1.0/threads-user-1/threads',
    );
    expect(create1[1].body).toBeUndefined();
    expect(create1Url.searchParams.get('media_type')).toBe('IMAGE');
    expect(create1Url.searchParams.get('image_url')).toBe('https://cdn.example.com/a.jpg');
    expect(create1Url.searchParams.get('is_carousel_item')).toBe('true');

    const create2 = fetchMock.mock.calls[2] as [string, RequestInit];
    const create2Url = new URL(create2[0]);
    expect(create2[1].body).toBeUndefined();
    expect(create2Url.searchParams.get('media_type')).toBe('VIDEO');
    expect(create2Url.searchParams.get('video_url')).toBe('https://cdn.example.com/b.mp4');
    expect(create2Url.searchParams.get('is_carousel_item')).toBe('true');

    const parent = fetchMock.mock.calls[4] as [string, RequestInit];
    const parentUrl = new URL(parent[0]);
    expect(parentUrl.origin + parentUrl.pathname).toBe(
      'https://graph.threads.net/v1.0/threads-user-1/threads',
    );
    expect(parent[1].body).toBeUndefined();
    expect(parentUrl.searchParams.get('media_type')).toBe('CAROUSEL');
    expect(parentUrl.searchParams.get('text')).toBe('Hello Threads');
    expect(parentUrl.searchParams.get('children')).toBe('c1,c2');

    const publish = fetchMock.mock.calls[6] as [string, RequestInit];
    const publishUrl = new URL(publish[0]);
    expect(publishUrl.origin + publishUrl.pathname).toBe(
      'https://graph.threads.net/v1.0/threads-user-1/threads_publish',
    );
    expect(publish[1].body).toBeUndefined();
    expect(publishUrl.searchParams.get('creation_id')).toBe('parent-1');
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
        { name: 'views', period: 'lifetime', values: [{ value: 90 }] },
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
    expect(url).toBe(
      'https://graph.threads.net/v1.0/p1/insights?metric=views,likes,replies,reposts,quotes,shares&access_token=threads-token',
    );
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
    expect(url).toBe(
      'https://graph.threads.net/v1.0/threads-user-1/permissions?access_token=threads-token',
    );
    expect(init.method).toBe('DELETE');
  });

  it('fails when externalUserId is missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const c = new ThreadsConnector({ accessToken: 't' });
    await expect(c.revoke()).rejects.toThrow('requires externalUserId');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
