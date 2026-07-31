// ─── YouTube Connector — Vitest Suite ───
// Covers: capability(), validate(), publish() resumable upload flow
// (init with metadata → download → PUT to Location URL), Shorts tag detection,
// fetchMetrics() via videos?part=statistics, and revoke() via Google's revoke endpoint.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { YouTubeConnector } from './youtube.js';
import type { ConnectorAuth, ConnectorPublishInput } from './types.js';

const AUTH: ConnectorAuth = {
  accessToken: 'yt-token-123',
};

function input(overrides: Partial<ConnectorPublishInput> = {}): ConnectorPublishInput {
  return {
    idempotencyKey: `ytb-${Math.random().toString(36).slice(2)}`,
    caption: 'My awesome video',
    mediaUrls: ['https://cdn.example.com/video.mp4'],
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

const UPLOAD_SESSION_URL =
  'https://www.googleapis.com/upload/youtube/v3/videos?part=snippet,status&uploadType=resumable';

function initResponse(location?: string): Response {
  return new Response('', {
    status: 200,
    headers: location ? { Location: location } : {},
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('YouTubeConnector basics', () => {
  it('declares youtube capabilities', () => {
    const c = new YouTubeConnector(AUTH);
    const cap = c.capability();
    expect(cap.publish).toBe(true);
    expect(cap.media).toEqual(['video', 'short']);
    expect(cap.maxMediaBytes).toBe(274_877_906_944);
    expect(cap.maxMediaCount).toBe(1);
    expect(cap.caption).toBe(true);
    expect(cap.maxCaptionLength).toBe(5_000);
    expect(cap.scheduling).toBe('native');
    expect(cap.metrics).toEqual(['views', 'likes', 'comments', 'shares']);
    expect(cap.refreshMetrics).toBe(true);
  });

  it('exposes platform, displayName, and publishMode', () => {
    const c = new YouTubeConnector(AUTH);
    expect(c.platform).toBe('youtube');
    expect(c.displayName).toBe('YouTube');
    expect(c.publishMode).toBe('api');
  });
});

describe('validate', () => {
  it('passes a valid input', async () => {
    const c = new YouTubeConnector(AUTH);
    const report = await c.validate(input());
    expect(report.valid).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.tosVerdict).toBe('pass');
  });

  it('errors when mediaUrls is empty', async () => {
    const c = new YouTubeConnector(AUTH);
    const report = await c.validate(input({ mediaUrls: [] }));
    expect(report.valid).toBe(false);
    expect(report.errors).toContainEqual({
      field: 'mediaUrls',
      message: 'At least one media URL is required.',
      severity: 'error',
    });
  });

  it('errors when the caption exceeds maxCaptionLength', async () => {
    const c = new YouTubeConnector(AUTH);
    const report = await c.validate(input({ caption: 'a'.repeat(5_001) }));
    expect(report.valid).toBe(false);
    expect(report.errors).toContainEqual({
      field: 'caption',
      message: 'Caption exceeds maximum length of 5000 characters (got 5001).',
      severity: 'error',
    });
  });

  it('warns for unsupported media types (image)', async () => {
    const c = new YouTubeConnector(AUTH);
    const report = await c.validate(input({ mediaUrls: ['https://cdn.example.com/photo.png'] }));
    expect(report.valid).toBe(true);
    expect(report.warnings).toContainEqual({
      field: 'mediaUrls[0]',
      message: 'Media type "image" is not in the connector\'s supported types (video, short).',
      severity: 'warning',
    });
    expect(report.tosVerdict).toBe('flag');
  });

  it('warns when the caption is empty', async () => {
    const c = new YouTubeConnector(AUTH);
    const report = await c.validate(input({ caption: '' }));
    expect(report.valid).toBe(true);
    expect(report.warnings.some((w) => w.field === 'caption')).toBe(true);
  });
});

describe('publish', () => {
  it('runs init → download → PUT upload and returns the video id', async () => {
    const uploadUrl = 'https://upload.googleapis.com/upload/youtube/v3/videos?upload_id=xyz789';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(initResponse(uploadUrl)) // 0: init session
      .mockResolvedValueOnce(new Response('videodata', { status: 200 })) // 1: download source
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'vid-1',
          kind: 'youtube#video',
          snippet: { title: 'My Video', description: 'My awesome video' },
          status: { uploadStatus: 'uploaded', privacyStatus: 'unlisted' },
        }),
      ); // 2: PUT upload
    vi.stubGlobal('fetch', fetchMock);

    const c = new YouTubeConnector(AUTH);
    const result = await c.publish(
      input({
        options: {
          title: 'My Video',
          videoSize: 1024,
          privacyStatus: 'unlisted',
          tags: ['test', 'demo'],
          categoryId: '22',
          madeForKids: false,
        },
      }),
    );

    expect(result.state).toBe('published');
    expect(result.remoteId).toBe('vid-1');
    expect(result.postUrl).toBe('https://www.youtube.com/watch?v=vid-1');
    expect(result.latencyMs).toEqual(expect.any(Number));

    expect(fetchMock).toHaveBeenCalledTimes(3);

    // 0: init
    const [initUrl, initInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(initUrl).toBe(UPLOAD_SESSION_URL);
    expect(initInit.method).toBe('POST');
    const headers = initInit.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer yt-token-123');
    expect(headers['Content-Type']).toBe('application/json; charset=UTF-8');
    expect(headers['X-Upload-Content-Length']).toBe('1024');
    expect(headers['X-Upload-Content-Type']).toBe('video/*');
    expect(JSON.parse(initInit.body as string)).toEqual({
      snippet: {
        title: 'My Video',
        description: 'My awesome video',
        tags: ['test', 'demo'],
        categoryId: '22',
      },
      status: {
        privacyStatus: 'unlisted',
        selfDeclaredMadeForKids: false,
      },
    });

    // 1: download
    const [downloadUrl] = fetchMock.mock.calls[1] as [string];
    expect(downloadUrl).toBe('https://cdn.example.com/video.mp4');

    // 2: PUT upload
    const [putUrl, putInit] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(putUrl).toBe(uploadUrl);
    expect(putInit.method).toBe('PUT');
    expect((putInit.headers as Record<string, string>)['Content-Type']).toBe('video/*');
    expect((putInit.headers as Record<string, string>)['Content-Length']).toBe('9');
  });

  it('appends the Shorts tag for short-form vertical videos', async () => {
    const uploadUrl = 'https://upload.googleapis.com/upload/youtube/v3/videos?upload_id=short1';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(initResponse(uploadUrl))
      .mockResolvedValueOnce(new Response('data', { status: 200 }))
      .mockResolvedValueOnce(jsonResponse({ id: 'vid-2', kind: 'youtube#video' }));
    vi.stubGlobal('fetch', fetchMock);

    const c = new YouTubeConnector(AUTH);
    await c.publish(
      input({
        options: { title: 'Short', durationSec: 45, aspectRatio: '9:16', tags: ['fun'] },
      }),
    );

    const initBody = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string) as {
      snippet: { tags: string[] };
    };
    expect(initBody.snippet.tags).toEqual(['fun', '#Shorts']);
  });

  it('does not mutate the caller-provided tags array when appending Shorts', async () => {
    const uploadUrl = 'https://upload.googleapis.com/upload/youtube/v3/videos?upload_id=short2';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(initResponse(uploadUrl))
      .mockResolvedValueOnce(new Response('data', { status: 200 }))
      .mockResolvedValueOnce(jsonResponse({ id: 'vid-5', kind: 'youtube#video' }));
    vi.stubGlobal('fetch', fetchMock);

    const options = { title: 'Short', durationSec: 30, aspectRatio: '9:16', tags: ['fun'] };
    const c = new YouTubeConnector(AUTH);
    await c.publish(input({ options }));

    // Regression: publish() must not mutate the caller's input options
    expect(options.tags).toEqual(['fun']);
    const initBody = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string) as {
      snippet: { tags: string[] };
    };
    expect(initBody.snippet.tags).toEqual(['fun', '#Shorts']);
  });

  it('does not append the Shorts tag for long-form videos', async () => {
    const uploadUrl = 'https://upload.googleapis.com/upload/youtube/v3/videos?upload_id=long1';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(initResponse(uploadUrl))
      .mockResolvedValueOnce(new Response('data', { status: 200 }))
      .mockResolvedValueOnce(jsonResponse({ id: 'vid-3', kind: 'youtube#video' }));
    vi.stubGlobal('fetch', fetchMock);

    const c = new YouTubeConnector(AUTH);
    await c.publish(
      input({ options: { title: 'Long', durationSec: 120, aspectRatio: '9:16', tags: ['fun'] } }),
    );

    const initBody = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string) as {
      snippet: { tags: string[] };
    };
    expect(initBody.snippet.tags).toEqual(['fun']);
  });

  it('applies default title, tags, category and privacy status', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(initResponse('https://upload.googleapis.com/up'))
      .mockResolvedValueOnce(new Response('data', { status: 200 }))
      .mockResolvedValueOnce(jsonResponse({ id: 'vid-4', kind: 'youtube#video' }));
    vi.stubGlobal('fetch', fetchMock);

    const c = new YouTubeConnector(AUTH);
    await c.publish(input());

    const initBody = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string) as {
      snippet: { title: string; description: string; tags: string[]; categoryId: string };
      status: { privacyStatus: string; selfDeclaredMadeForKids: boolean };
    };
    expect(initBody.snippet.title).toBe('Untitled');
    expect(initBody.snippet.description).toBe('My awesome video');
    expect(initBody.snippet.tags).toEqual([]);
    expect(initBody.snippet.categoryId).toBe('22');
    expect(initBody.status.privacyStatus).toBe('private');
    expect(initBody.status.selfDeclaredMadeForKids).toBe(false);
  });

  it('returns a failed result when no video URL is provided', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const c = new YouTubeConnector(AUTH);
    const result = await c.publish(input({ mediaUrls: [] }));

    expect(result.state).toBe('failed');
    expect(result.error).toBe('YouTube requires exactly one video URL');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns a failed result when the resumable init fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: { message: 'denied' } }, 403));
    vi.stubGlobal('fetch', fetchMock);

    const c = new YouTubeConnector(AUTH);
    const result = await c.publish(input());

    expect(result.state).toBe('failed');
    expect(result.error).toContain('YouTube resumable upload init failed: 403');
  });

  it('returns a failed result when no Location header is returned', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(initResponse());
    vi.stubGlobal('fetch', fetchMock);

    const c = new YouTubeConnector(AUTH);
    const result = await c.publish(input());

    expect(result.state).toBe('failed');
    expect(result.error).toBe('YouTube did not return a Location header for resumable upload');
  });

  it('returns a failed result when the source video cannot be downloaded', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(initResponse('https://upload.googleapis.com/up'))
      .mockResolvedValueOnce(jsonResponse({}, 404));
    vi.stubGlobal('fetch', fetchMock);

    const c = new YouTubeConnector(AUTH);
    const result = await c.publish(input());

    expect(result.state).toBe('failed');
    expect(result.error).toBe('Failed to download video from https://cdn.example.com/video.mp4: 404');
  });

  it('returns a failed result when the PUT upload fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(initResponse('https://upload.googleapis.com/up'))
      .mockResolvedValueOnce(new Response('data', { status: 200 }))
      .mockResolvedValueOnce(jsonResponse({ error: 'quota' }, 503));
    vi.stubGlobal('fetch', fetchMock);

    const c = new YouTubeConnector(AUTH);
    const result = await c.publish(input());

    expect(result.state).toBe('failed');
    expect(result.error).toContain('YouTube video upload failed: 503');
  });

  it('returns a failed result on network errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('socket hang up')));
    const c = new YouTubeConnector(AUTH);
    const result = await c.publish(input());
    expect(result.state).toBe('failed');
    expect(result.error).toContain('socket hang up');
  });
});

describe('fetchMetrics', () => {
  it('parses string statistics into ConnectorMetrics', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        items: [
          {
            id: 'vid-1',
            statistics: { viewCount: '100', likeCount: '5', commentCount: '2', favoriteCount: '1' },
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const c = new YouTubeConnector(AUTH);
    const metrics = await c.fetchMetrics('vid-1');

    expect(metrics.postId).toBe('vid-1');
    expect(metrics.platform).toBe('youtube');
    expect(metrics.metrics).toEqual({ views: 100, likes: 5, comments: 2, shares: 1 });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://www.googleapis.com/youtube/v3/videos?part=statistics&id=vid-1');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer yt-token-123');
  });

  it('defaults missing statistics to zero', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ items: [{ id: 'vid-1', statistics: {} }] })));
    const c = new YouTubeConnector(AUTH);
    const metrics = await c.fetchMetrics('vid-1');
    expect(metrics.metrics).toEqual({ views: 0, likes: 0, comments: 0, shares: 0 });
  });

  it('throws when the video is not found', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ items: [] })));
    const c = new YouTubeConnector(AUTH);
    await expect(c.fetchMetrics('vid-1')).rejects.toThrow('YouTube video vid-1 not found');
  });

  it('throws on HTTP errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 500)));
    const c = new YouTubeConnector(AUTH);
    await expect(c.fetchMetrics('vid-1')).rejects.toThrow('API GET');
  });
});

describe('revoke', () => {
  it('revokes the OAuth token at Google and clears auth data', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);

    const c = new YouTubeConnector(AUTH);
    await c.revoke();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://oauth2.googleapis.com/revoke?token=yt-token-123');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/x-www-form-urlencoded');

    expect(c.getLogs().some((l) => l.action === 'revoke' && l.message.includes('revoked successfully'))).toBe(true);
    expect(c.auth.accessToken).toBe('');
    expect(c.auth.refreshToken).toBeUndefined();
    expect(c.auth.expiresAt).toBe(0);
  });

  it('warns but does not throw when revocation fails, and still clears auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: 'invalid_token' }, 400));
    vi.stubGlobal('fetch', fetchMock);

    const c = new YouTubeConnector(AUTH);
    await expect(c.revoke()).resolves.toBeUndefined();

    expect(c.getLogs().some((l) => l.level === 'warn' && l.message.includes('warned: 400'))).toBe(true);
    expect(c.auth.accessToken).toBe('');
    expect(c.auth.expiresAt).toBe(0);
  });
});
