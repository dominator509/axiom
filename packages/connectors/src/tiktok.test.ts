// ─── TikTok Connector — Vitest Suite ───
// Covers: capability(), validate(), publish() 4-step flow
// (init → video download → PUT upload → complete), fetchMetrics() via video/query,
// and revoke() (liveness check + logical disconnect, no server-side revocation).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { TikTokConnector } from './tiktok.js';
import type { ConnectorAuth, ConnectorPublishInput } from './types.js';

const AUTH: ConnectorAuth = {
  accessToken: 'tt-token-123',
  extra: { username: 'testuser' },
};

function input(overrides: Partial<ConnectorPublishInput> = {}): ConnectorPublishInput {
  return {
    idempotencyKey: `ttk-${Math.random().toString(36).slice(2)}`,
    caption: 'Check out this video',
    mediaUrls: ['https://cdn.example.com/video.mp4'],
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const INIT_OK = {
  data: { publish_id: 'pub-1', upload_url: 'https://upload.tiktokapis.com/v2/upload' },
};

const STATUS_OK = {
  data: { status: 'PUBLISH_COMPLETE', publicaly_available_post_id: [123456789] },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TikTokConnector basics', () => {
  it('declares tiktok capabilities', () => {
    const c = new TikTokConnector(AUTH);
    const cap = c.capability();
    expect(cap.publish).toBe(true);
    expect(cap.media).toEqual(['video', 'short']);
    expect(cap.maxMediaBytes).toBe(524_288_000);
    expect(cap.maxMediaCount).toBe(1);
    expect(cap.caption).toBe(true);
    expect(cap.maxCaptionLength).toBe(2_200);
    expect(cap.scheduling).toBe('internal');
    expect(cap.metrics).toEqual(['views', 'likes', 'comments', 'shares', 'follows']);
    expect(cap.refreshMetrics).toBe(true);
  });

  it('exposes platform, displayName, and publishMode', () => {
    const c = new TikTokConnector(AUTH);
    expect(c.platform).toBe('tiktok');
    expect(c.displayName).toBe('TikTok');
    expect(c.publishMode).toBe('api');
  });
});

describe('validate', () => {
  it('passes a valid input', async () => {
    const c = new TikTokConnector(AUTH);
    const report = await c.validate(input());
    expect(report.valid).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.tosVerdict).toBe('pass');
  });

  it('errors when mediaUrls is empty', async () => {
    const c = new TikTokConnector(AUTH);
    const report = await c.validate(input({ mediaUrls: [] }));
    expect(report.valid).toBe(false);
    expect(report.errors).toContainEqual({
      field: 'mediaUrls',
      message: 'At least one media URL is required.',
      severity: 'error',
    });
  });

  it('errors when the caption exceeds maxCaptionLength', async () => {
    const c = new TikTokConnector(AUTH);
    const report = await c.validate(input({ caption: 'a'.repeat(2_201) }));
    expect(report.valid).toBe(false);
    expect(report.errors).toContainEqual({
      field: 'caption',
      message: 'Caption exceeds maximum length of 2200 characters (got 2201).',
      severity: 'error',
    });
  });

  it('warns when a media type is not supported (image)', async () => {
    const c = new TikTokConnector(AUTH);
    const report = await c.validate(input({ mediaUrls: ['https://cdn.example.com/photo.jpg'] }));
    expect(report.valid).toBe(true);
    expect(report.warnings).toContainEqual({
      field: 'mediaUrls[0]',
      message: 'Media type "image" is not in the connector\'s supported types (video, short).',
      severity: 'warning',
    });
    expect(report.tosVerdict).toBe('flag');
  });

  it('warns when the caption is empty', async () => {
    const c = new TikTokConnector(AUTH);
    const report = await c.validate(input({ caption: '' }));
    expect(report.valid).toBe(true);
    expect(report.warnings.some((w) => w.field === 'caption')).toBe(true);
  });
});

describe('publish', () => {
  it('runs download → init → PUT upload → status and returns the post id', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('mp4bytes', { status: 200 })) // 1: download source video
      .mockResolvedValueOnce(jsonResponse(INIT_OK)) // 2: init
      .mockResolvedValueOnce(jsonResponse({}, 200)) // 3: PUT upload to upload_url
      .mockResolvedValueOnce(jsonResponse(STATUS_OK)); // 4: status
    vi.stubGlobal('fetch', fetchMock);

    const c = new TikTokConnector(AUTH);
    const result = await c.publish(
      input({
        options: {
          videoSize: 1000,
          chunkSize: 500,
          totalChunkCount: 2,
          privacyLevel: 'SELF_ONLY',
          disableComment: true,
        },
      }),
    );

    expect(result.state).toBe('published');
    expect(result.remoteId).toBe('123456789');
    expect(result.postUrl).toBe('https://www.tiktok.com/@testuser/video/123456789');
    expect(result.latencyMs).toEqual(expect.any(Number));

    expect(fetchMock).toHaveBeenCalledTimes(4);

    // 1: source download
    const [downloadUrl] = fetchMock.mock.calls[0] as [string];
    expect(downloadUrl).toBe('https://cdn.example.com/video.mp4');

    // 2: init
    const [initUrl, initInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(initUrl).toBe('https://open.tiktokapis.com/v2/post/publish/video/init/');
    expect(initInit.method).toBe('POST');
    expect(JSON.parse(initInit.body as string)).toEqual({
      post_info: {
        title: 'Check out this video',
        privacy_level: 'SELF_ONLY',
        disable_duet: false,
        disable_stitch: false,
        disable_comment: true,
        brand_content_toggle: false,
        brand_organic_toggle: false,
        is_aigc: false,
      },
      source_info: { source: 'FILE_UPLOAD', video_size: 8, chunk_size: 500, total_chunk_count: 1 },
    });
    expect((initInit.headers as Record<string, string>).Authorization).toBe('Bearer tt-token-123');

    // 3: PUT upload
    const [uploadUrl, uploadInit] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(uploadUrl).toBe('https://upload.tiktokapis.com/v2/upload');
    expect(uploadInit.method).toBe('PUT');
    expect((uploadInit.headers as Record<string, string>)['Content-Type']).toBe('video/mp4');
    expect((uploadInit.headers as Record<string, string>)['Content-Length']).toBe('8');

    // 4: status polling
    const [statusUrl, statusInit] = fetchMock.mock.calls[3] as [string, RequestInit];
    expect(statusUrl).toBe('https://open.tiktokapis.com/v2/post/publish/status/fetch/');
    expect(JSON.parse(statusInit.body as string)).toEqual({ publish_id: 'pub-1' });
  });

  it('applies defaults for upload options and privacy level', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('data', { status: 200 }))
      .mockResolvedValueOnce(jsonResponse(INIT_OK))
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse(STATUS_OK));
    vi.stubGlobal('fetch', fetchMock);

    const c = new TikTokConnector(AUTH);
    await c.publish(input());

    const initBody = JSON.parse(
      (fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string,
    ) as {
      post_info: { privacy_level: string; disable_duet: boolean };
      source_info: { video_size: number; chunk_size: number; total_chunk_count: number };
    };
    expect(initBody.source_info).toEqual({
      source: 'FILE_UPLOAD',
      video_size: 4,
      chunk_size: 4,
      total_chunk_count: 1,
    });
    expect(initBody.post_info.privacy_level).toBe('SELF_ONLY');
    expect(initBody.post_info.disable_duet).toBe(false);
  });

  it('uses the fallback username in the post URL', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('data', { status: 200 }))
      .mockResolvedValueOnce(jsonResponse(INIT_OK))
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse(STATUS_OK));
    vi.stubGlobal('fetch', fetchMock);

    const c = new TikTokConnector({ accessToken: 'tt-token-123' });
    const result = await c.publish(input());
    expect(result.postUrl).toBe('https://www.tiktok.com/@user/video/123456789');
  });

  it('returns a failed result when no video URL is provided', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const c = new TikTokConnector(AUTH);
    const result = await c.publish(input({ mediaUrls: [] }));

    expect(result.state).toBe('failed');
    expect(result.error).toBe('TikTok requires at least one video URL');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns a failed result when init reports an API error', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('data', { status: 200 }))
      .mockResolvedValueOnce(
        jsonResponse({ error: { code: 'bad_request', message: 'invalid payload' } }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const c = new TikTokConnector(AUTH);
    const result = await c.publish(input());

    expect(result.state).toBe('failed');
    expect(result.error).toBe('TikTok init failed: bad_request — invalid payload');
  });

  it('returns a failed result when the init endpoint fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('data', { status: 200 }))
      .mockResolvedValueOnce(jsonResponse({ error: 'nope' }, 500));
    vi.stubGlobal('fetch', fetchMock);

    const c = new TikTokConnector(AUTH);
    const result = await c.publish(input());

    expect(result.state).toBe('failed');
    expect(result.error).toContain(
      'API POST https://open.tiktokapis.com/v2/post/publish/video/init/ failed: 500',
    );
  });

  it('returns a failed result when the source video cannot be downloaded', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({}, 404));
    vi.stubGlobal('fetch', fetchMock);

    const c = new TikTokConnector(AUTH);
    const result = await c.publish(input());

    expect(result.state).toBe('failed');
    expect(result.error).toBe(
      'Failed to download video from https://cdn.example.com/video.mp4: 404',
    );
  });

  it('returns a failed result when the PUT upload fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('data', { status: 200 }))
      .mockResolvedValueOnce(jsonResponse(INIT_OK))
      .mockResolvedValueOnce(jsonResponse({ error: 'quota' }, 413));
    vi.stubGlobal('fetch', fetchMock);

    const c = new TikTokConnector(AUTH);
    const result = await c.publish(input());

    expect(result.state).toBe('failed');
    expect(result.error).toContain('TikTok video upload failed: 413');
  });

  it('returns a failed result when status polling reports an API error', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('data', { status: 200 }))
      .mockResolvedValueOnce(jsonResponse(INIT_OK))
      .mockResolvedValueOnce(new Response('data', { status: 200 }))
      .mockResolvedValueOnce(
        jsonResponse({ error: { code: 'missing_fields', message: 'title required' } }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const c = new TikTokConnector(AUTH);
    const result = await c.publish(input());

    expect(result.state).toBe('failed');
    expect(result.error).toBe('TikTok status failed: missing_fields — title required');
  });

  it('returns pending and resumes status polling without re-uploading', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('data', { status: 200 }))
      .mockResolvedValueOnce(jsonResponse(INIT_OK))
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({ data: { status: 'PROCESSING_UPLOAD' } }))
      .mockResolvedValueOnce(jsonResponse(STATUS_OK));
    vi.stubGlobal('fetch', fetchMock);

    const c = new TikTokConnector(AUTH);
    const first = await c.publish(input({ idempotencyKey: 'ttk-pending' }));
    expect(first).toMatchObject({ remoteId: 'pub-1', state: 'pending' });
    expect(fetchMock).toHaveBeenCalledTimes(4);

    const second = await c.publish(
      input({ idempotencyKey: 'ttk-pending', options: { publishId: 'pub-1' } }),
    );
    expect(second).toMatchObject({ remoteId: '123456789', state: 'published' });
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls[4][0]).toBe(
      'https://open.tiktokapis.com/v2/post/publish/status/fetch/',
    );
  });

  it('returns a failed result on network errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('socket hang up')));
    const c = new TikTokConnector(AUTH);
    const result = await c.publish(input());
    expect(result.state).toBe('failed');
    expect(result.error).toContain('socket hang up');
  });
});

describe('fetchMetrics', () => {
  it('maps video statistics into ConnectorMetrics', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          videos: [
            {
              id: 'vid-1',
              statistics: { view_count: 100, like_count: 5, comment_count: 2, share_count: 1 },
            },
          ],
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const c = new TikTokConnector(AUTH);
    const metrics = await c.fetchMetrics('vid-1');

    expect(metrics.postId).toBe('vid-1');
    expect(metrics.platform).toBe('tiktok');
    expect(metrics.metrics).toEqual({ views: 100, likes: 5, comments: 2, shares: 1, follows: 0 });
    expect(metrics.raw).toEqual({
      statistics: { view_count: 100, like_count: 5, comment_count: 2, share_count: 1 },
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://open.tiktokapis.com/v2/video/query/?fields=statistics&id=vid-1');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tt-token-123');
  });

  it('throws when the API returns an error object', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(jsonResponse({ error: { code: 'no_permission', message: 'denied' } })),
    );
    const c = new TikTokConnector(AUTH);
    await expect(c.fetchMetrics('vid-1')).rejects.toThrow(
      'TikTok metrics fetch failed: no_permission — denied',
    );
  });

  it('throws when the video is not found', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: { videos: [] } })));
    const c = new TikTokConnector(AUTH);
    await expect(c.fetchMetrics('vid-1')).rejects.toThrow('TikTok video vid-1 not found');
  });

  it('throws on HTTP errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 500)));
    const c = new TikTokConnector(AUTH);
    await expect(c.fetchMetrics('vid-1')).rejects.toThrow('API GET');
  });
});

describe('revoke', () => {
  it('revokes the token with TikTok client credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const c = new TikTokConnector({
      ...AUTH,
      extra: { ...AUTH.extra, clientKey: 'client-key', clientSecret: 'client-secret' },
    });
    await c.revoke();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://open.tiktokapis.com/v2/oauth/revoke/');
    expect(init.method).toBe('POST');
    expect(String(init.body)).toContain('client_key=client-key');
    expect(String(init.body)).toContain('client_secret=client-secret');
    expect(String(init.body)).toContain('token=tt-token-123');
    expect(c.auth.accessToken).toBe('');
    expect(c.auth.refreshToken).toBeUndefined();
    expect(c.auth.expiresAt).toBe(0);
  });

  it('fails closed when client credentials are not configured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const c = new TikTokConnector(AUTH);
    await expect(c.revoke()).rejects.toThrow('clientKey and clientSecret');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not clear local auth when server-side revocation fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'denied' }, 401)));
    const c = new TikTokConnector({
      ...AUTH,
      extra: { ...AUTH.extra, clientKey: 'client-key', clientSecret: 'client-secret' },
    });
    await expect(c.revoke()).rejects.toThrow('TikTok token revoke failed: 401');
    expect(c.auth.accessToken).toBe('tt-token-123');
  });
});
