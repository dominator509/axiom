// ─── Instagram Connector — Vitest Suite ───
// Covers: capability(), validate(), publish() container creation + publishing
// (image vs video), missing externalUserId, idempotency, fetchMetrics(), revoke().

import { describe, it, expect, vi, afterEach } from 'vitest';
import { InstagramConnector } from './instagram.js';
import type { ConnectorAuth, ConnectorPublishInput } from './types.js';

const AUTH: ConnectorAuth = {
  accessToken: 'ig-token',
  externalUserId: 'ig-business-1',
};

function input(overrides: Partial<ConnectorPublishInput> = {}): ConnectorPublishInput {
  return {
    idempotencyKey: `ik-${Math.random().toString(36).slice(2)}`,
    caption: 'Summer vibes',
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

describe('InstagramConnector', () => {
  it('declares instagram capabilities', () => {
    const cap = new InstagramConnector(AUTH).capability();
    expect(cap.media).toEqual(['image', 'video', 'carousel', 'story']);
    expect(cap.maxMediaCount).toBe(10);
    expect(cap.maxCaptionLength).toBe(2200);
    expect(cap.scheduling).toBe('native');
    expect(cap.metrics).toEqual(['impressions', 'likes', 'comments', 'shares', 'saves']);
  });

  it('validates via validatePublish', async () => {
    const c = new InstagramConnector(AUTH);
    const ok = await c.validate(input());
    expect(ok.valid).toBe(true);

    const bad = await c.validate(input({ mediaUrls: [] }));
    expect(bad.valid).toBe(false);
    expect(bad.tosVerdict).toBe('block');
  });
});

describe('publish', () => {
  it('creates containers then publishes them, returning the last post id', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'container-1' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'container-2' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'carousel-1' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'post-1' }));
    vi.stubGlobal('fetch', fetchMock);

    const c = new InstagramConnector(AUTH);
    const result = await c.publish(
      input({ mediaUrls: ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.mp4'] }),
    );

    expect(result.state).toBe('published');
    expect(result.remoteId).toBe('post-1');
    expect(result.postUrl).toBe('https://www.instagram.com/p/post-1/');

    // Container creation calls (all containers are created before any publish)
    const createInit1 = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(createInit1[0]).toBe('https://graph.facebook.com/v22.0/ig-business-1/media');
    const body1 = JSON.parse(createInit1[1].body as string) as Record<string, string>;
    expect(body1.image_url).toBe('https://cdn.example.com/a.jpg');
    expect(body1.media_type).toBeUndefined();
    expect(body1.is_carousel_item).toBe('true');

    const createInit2 = fetchMock.mock.calls[1] as [string, RequestInit];
    const body2 = JSON.parse(createInit2[1].body as string) as Record<string, string>;
    expect(body2.media_type).toBe('VIDEO');
    expect(body2.video_url).toBe('https://cdn.example.com/b.mp4');
    expect(body2.image_url).toBeUndefined();
    expect(body2.is_carousel_item).toBe('true');

    const parentInit = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(parentInit[0]).toBe('https://graph.facebook.com/v22.0/ig-business-1/media');
    expect(JSON.parse(parentInit[1].body as string)).toMatchObject({
      media_type: 'CAROUSEL',
      children: 'container-1,container-2',
      caption: 'Summer vibes',
    });

    const publishInit = fetchMock.mock.calls[3] as [string, RequestInit];
    expect(publishInit[0]).toBe('https://graph.facebook.com/v22.0/ig-business-1/media_publish');
    expect(JSON.parse(publishInit[1].body as string)).toMatchObject({
      creation_id: 'carousel-1',
    });
  });

  it('publishes a story with an explicit STORIES container', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'story-container-1' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'story-1' }));
    vi.stubGlobal('fetch', fetchMock);

    const c = new InstagramConnector(AUTH);
    const result = await c.publish(
      input({
        idempotencyKey: 'ig-story',
        options: { mediaType: 'story' },
      }),
    );

    expect(result).toMatchObject({ remoteId: 'story-1', state: 'published' });
    expect(result.postUrl).toBeUndefined();

    const createInit = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(createInit[1].body as string)).toMatchObject({
      media_type: 'STORIES',
      image_url: 'https://cdn.example.com/photo.jpg',
    });
    expect(JSON.parse(createInit[1].body as string).caption).toBeUndefined();

    const publishInit = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(publishInit[0]).toBe('https://graph.facebook.com/v22.0/ig-business-1/media_publish');
    expect(JSON.parse(publishInit[1].body as string)).toMatchObject({
      creation_id: 'story-container-1',
    });
  });

  it('rejects multi-media story input before making a provider request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const c = new InstagramConnector(AUTH);

    const report = await c.validate(
      input({
        options: { mediaType: 'story' },
        mediaUrls: ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg'],
      }),
    );

    expect(report.valid).toBe(false);
    expect(report.tosVerdict).toBe('block');
    expect(report.errors).toContainEqual({
      field: 'mediaUrls',
      message: 'Instagram stories require exactly one media URL.',
      severity: 'error',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails fast when externalUserId is missing', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const c = new InstagramConnector({ accessToken: 'ig-token' });
    const result = await c.publish(input());
    expect(result.state).toBe('failed');
    expect(result.error).toContain('externalUserId (IG Business Account ID) is required');
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('is idempotent for repeated publishes with the same key', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'container-1' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'post-1' }));
    vi.stubGlobal('fetch', fetchMock);

    const c = new InstagramConnector(AUTH);
    const i = input({ idempotencyKey: 'ig-same' });
    await c.publish(i);
    const second = await c.publish(i);

    expect(second.state).toBe('skipped');
    expect(second.remoteId).toBe('post-1');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns failed when a container creation fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'rate limited' }, 429)));
    const c = new InstagramConnector(AUTH);
    const result = await c.publish(input());
    expect(result.state).toBe('failed');
    expect(result.error).toContain('429');
  });

  it('returns failed on network errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('ECONNRESET')));
    const c = new InstagramConnector(AUTH);
    const result = await c.publish(input());
    expect(result.state).toBe('failed');
    expect(result.error).toContain('ECONNRESET');
  });
});

describe('fetchMetrics', () => {
  it('maps insights data to metrics with zero defaults', async () => {
    const insights = {
      data: [
        { name: 'impressions', period: 'lifetime', values: [{ value: 1000 }] },
        { name: 'likes', period: 'lifetime', values: [{ value: 55 }] },
        { name: 'comments', period: 'lifetime', values: [{ value: 4 }] },
      ],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(insights)));
    const c = new InstagramConnector(AUTH);
    const metrics = await c.fetchMetrics('post-9');

    expect(metrics.postId).toBe('post-9');
    expect(metrics.metrics).toEqual({
      impressions: 1000,
      likes: 55,
      comments: 4,
      shares: 0,
      saves: 0,
    });
    expect(metrics.raw).toEqual(insights);

    const [url] = vi.mocked(fetch).mock.calls[0] as [string];
    expect(url).toContain('/v22.0/post-9/insights');
    expect(url).toContain('metric=impressions,likes,comments,shares,saved');
    expect(url).toContain('access_token=ig-token');
  });

  it('fetches media insights without requiring the account id', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ data: [{ name: 'saved', period: 'lifetime', values: [{ value: 8 }] }] }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const c = new InstagramConnector({ accessToken: 'ig-token' });
    const metrics = await c.fetchMetrics('post-9');

    expect(metrics.metrics.saves).toBe(8);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect((fetchMock.mock.calls[0] as [string])[0]).toContain('/v22.0/post-9/insights');
  });
});

describe('revoke', () => {
  it('deletes permissions when externalUserId is set', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true }));
    vi.stubGlobal('fetch', fetchMock);

    const c = new InstagramConnector(AUTH);
    await c.revoke();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://graph.facebook.com/v22.0/ig-business-1/permissions?delegation&access_token=ig-token',
    );
    expect(init.method).toBe('DELETE');
    expect(
      c
        .getLogs()
        .some((l) => l.action === 'revoke' && l.message.includes('Revoked Instagram permissions')),
    ).toBe(true);
  });

  it('skips gracefully when externalUserId is missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const c = new InstagramConnector({ accessToken: 'ig-token' });
    await expect(c.revoke()).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
