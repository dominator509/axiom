// ─── X (Twitter) Connector — Vitest Suite ───
// Covers: capability(), validate(), publish() chunked media upload
// (download → INIT → APPEND → FINALIZE → optional STATUS polling → tweet),
// fetchMetrics() via tweet.fields, and revoke() via OAuth2 revoke endpoint.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { XConnector } from './x.js';
import type { ConnectorAuth, ConnectorPublishInput } from './types.js';

const AUTH: ConnectorAuth = {
  accessToken: 'x-token-123',
  extra: { clientId: 'x-client-1' },
};

function input(overrides: Partial<ConnectorPublishInput> = {}): ConnectorPublishInput {
  return {
    idempotencyKey: `xt-${Math.random().toString(36).slice(2)}`,
    caption: 'Hello from X',
    mediaUrls: [],
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

const UPLOAD_URL = 'https://upload.twitter.com/1.1/media/upload.json';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('XConnector basics', () => {
  it('declares x capabilities', () => {
    const c = new XConnector(AUTH);
    const cap = c.capability();
    expect(cap.publish).toBe(true);
    expect(cap.media).toEqual(['image', 'video']);
    expect(cap.maxMediaBytes).toBe(536_870_912);
    expect(cap.maxMediaCount).toBe(4);
    expect(cap.caption).toBe(true);
    expect(cap.maxCaptionLength).toBe(4_000);
    expect(cap.scheduling).toBe('internal');
    expect(cap.metrics).toEqual(['likes', 'comments', 'shares', 'impressions', 'reposts', 'quotes']);
    expect(cap.refreshMetrics).toBe(true);
  });

  it('exposes platform, displayName, and publishMode', () => {
    const c = new XConnector(AUTH);
    expect(c.platform).toBe('x');
    expect(c.displayName).toBe('X (Twitter)');
    expect(c.publishMode).toBe('api');
  });
});

describe('validate', () => {
  it('passes a valid input', async () => {
    const c = new XConnector(AUTH);
    const report = await c.validate(input({ mediaUrls: ['https://cdn.example.com/pic.jpg'] }));
    expect(report.valid).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.tosVerdict).toBe('pass');
  });

  it('errors when mediaUrls is empty', async () => {
    const c = new XConnector(AUTH);
    const report = await c.validate(input());
    expect(report.valid).toBe(false);
    expect(report.errors).toContainEqual({
      field: 'mediaUrls',
      message: 'At least one media URL is required.',
      severity: 'error',
    });
  });

  it('errors when the caption exceeds maxCaptionLength', async () => {
    const c = new XConnector(AUTH);
    const report = await c.validate(input({ caption: 'a'.repeat(4_001) }));
    expect(report.valid).toBe(false);
    expect(report.errors).toContainEqual({
      field: 'caption',
      message: 'Caption exceeds maximum length of 4000 characters (got 4001).',
      severity: 'error',
    });
  });

  it('errors when more than maxMediaCount media items are provided', async () => {
    const c = new XConnector(AUTH);
    const urls = Array.from({ length: 5 }, (_, i) => `https://cdn.example.com/p${i}.jpg`);
    const report = await c.validate(input({ mediaUrls: urls }));
    expect(report.valid).toBe(false);
    expect(report.errors).toContainEqual({
      field: 'mediaUrls',
      message: 'Maximum of 4 media items allowed (got 5).',
      severity: 'error',
    });
  });

  it('warns for unsupported media types (audio)', async () => {
    const c = new XConnector(AUTH);
    const report = await c.validate(input({ mediaUrls: ['https://cdn.example.com/track.mp3'] }));
    expect(report.valid).toBe(true);
    expect(report.warnings).toContainEqual({
      field: 'mediaUrls[0]',
      message: 'Media type "audio" is not in the connector\'s supported types (image, video).',
      severity: 'warning',
    });
    expect(report.tosVerdict).toBe('flag');
  });
});

describe('publish', () => {
  it('uploads an image (INIT → APPEND → FINALIZE) then creates the tweet', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('jpegdata', { status: 200, headers: { 'Content-Type': 'image/jpeg' } })) // 0: download
      .mockResolvedValueOnce(jsonResponse({ media_id_string: 'm1', media_id: 1, size: 8, expires_after_secs: 3600 })) // 1: INIT
      .mockResolvedValueOnce(jsonResponse({})) // 2: APPEND segment 0
      .mockResolvedValueOnce(jsonResponse({ media_id_string: 'm1', media_id: 1, size: 8 })) // 3: FINALIZE
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'tweet-1', text: 'Hello from X' } })); // 4: tweet
    vi.stubGlobal('fetch', fetchMock);

    const c = new XConnector(AUTH);
    const result = await c.publish(input({ mediaUrls: ['https://cdn.example.com/pic.jpg'] }));

    expect(result.state).toBe('published');
    expect(result.remoteId).toBe('tweet-1');
    expect(result.postUrl).toBe('https://x.com/i/web/status/tweet-1');
    expect(result.latencyMs).toEqual(expect.any(Number));

    expect(fetchMock).toHaveBeenCalledTimes(5);

    // 0: download
    const [downloadUrl] = fetchMock.mock.calls[0] as [string];
    expect(downloadUrl).toBe('https://cdn.example.com/pic.jpg');

    // 1: INIT
    const [initUrl, initInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(initUrl).toBe(UPLOAD_URL);
    expect(initInit.method).toBe('POST');
    const initForm = initInit.body as FormData;
    expect(initForm.get('command')).toBe('INIT');
    expect(initForm.get('media_type')).toBe('image/jpeg');
    expect(initForm.get('total_bytes')).toBe('8');
    expect((initInit.headers as Record<string, string>).Authorization).toBe('Bearer x-token-123');

    // 2: APPEND
    const [, appendInit] = fetchMock.mock.calls[2] as [string, RequestInit];
    const appendForm = appendInit.body as FormData;
    expect(appendForm.get('command')).toBe('APPEND');
    expect(appendForm.get('media_id')).toBe('m1');
    expect(appendForm.get('segment_index')).toBe('0');
    expect(appendForm.get('media')).toBeInstanceOf(Blob);

    // 3: FINALIZE
    const [, finalizeInit] = fetchMock.mock.calls[3] as [string, RequestInit];
    const finalizeForm = finalizeInit.body as FormData;
    expect(finalizeForm.get('command')).toBe('FINALIZE');
    expect(finalizeForm.get('media_id')).toBe('m1');

    // 4: tweet
    const [tweetUrl, tweetInit] = fetchMock.mock.calls[4] as [string, RequestInit];
    expect(tweetUrl).toBe('https://api.twitter.com/2/tweets');
    expect(JSON.parse(tweetInit.body as string)).toEqual({
      text: 'Hello from X',
      media: { media_ids: ['m1'] },
    });
  });

  it('publishes a text-only tweet without media uploads', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'tweet-1', text: 'Hello from X' } }));
    vi.stubGlobal('fetch', fetchMock);

    const c = new XConnector(AUTH);
    const result = await c.publish(input());

    expect(result.state).toBe('published');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.twitter.com/2/tweets');
    expect(JSON.parse(init.body as string)).toEqual({ text: 'Hello from X' });
  });

  it('splits large files into multiple APPEND segments', async () => {
    const big = 'a'.repeat(5 * 1024 * 1024 + 1); // > 5 MB chunk size
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(big, { status: 200, headers: { 'Content-Type': 'image/jpeg' } }))
      .mockResolvedValueOnce(jsonResponse({ media_id_string: 'm1', media_id: 1, size: big.length }))
      .mockResolvedValueOnce(jsonResponse({})) // APPEND 0
      .mockResolvedValueOnce(jsonResponse({})) // APPEND 1
      .mockResolvedValueOnce(jsonResponse({ media_id_string: 'm1', media_id: 1, size: big.length }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'tweet-1', text: 'Hello from X' } }));
    vi.stubGlobal('fetch', fetchMock);

    const c = new XConnector(AUTH);
    const result = await c.publish(input({ mediaUrls: ['https://cdn.example.com/big.jpg'] }));

    expect(result.state).toBe('published');
    expect(fetchMock).toHaveBeenCalledTimes(6);
    const [, append0] = fetchMock.mock.calls[2] as [string, RequestInit];
    const [, append1] = fetchMock.mock.calls[3] as [string, RequestInit];
    expect((append0.body as FormData).get('segment_index')).toBe('0');
    expect((append1.body as FormData).get('segment_index')).toBe('1');
  });

  it('polls video processing until succeeded before tweeting', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(new Response('videodata', { status: 200, headers: { 'Content-Type': 'video/mp4' } })) // download
        .mockResolvedValueOnce(jsonResponse({ media_id_string: 'm1', media_id: 1, size: 9 })) // INIT
        .mockResolvedValueOnce(jsonResponse({})) // APPEND
        .mockResolvedValueOnce(jsonResponse({ media_id_string: 'm1', media_id: 1, size: 9, processing_state: 'pending' })) // FINALIZE
        .mockResolvedValueOnce(jsonResponse({ processing_info: { state: 'in_progress', progress_percent: 50 } })) // STATUS 1
        .mockResolvedValueOnce(jsonResponse({ processing_info: { state: 'succeeded' } })) // STATUS 2
        .mockResolvedValueOnce(jsonResponse({ data: { id: 'tweet-1', text: 'Hello from X' } })); // tweet
      vi.stubGlobal('fetch', fetchMock);

      const c = new XConnector(AUTH);
      const promise = c.publish(input({ mediaUrls: ['https://cdn.example.com/video.mp4'] }));

      await vi.advanceTimersByTimeAsync(2_000);
      await vi.advanceTimersByTimeAsync(2_000);

      const result = await promise;
      expect(result.state).toBe('published');
      expect(result.remoteId).toBe('tweet-1');
      expect(fetchMock).toHaveBeenCalledTimes(7);

      const status1Url = (fetchMock.mock.calls[4] as [string])[0];
      const status2Url = (fetchMock.mock.calls[5] as [string])[0];
      expect(status1Url).toBe(`${UPLOAD_URL}?command=STATUS&media_id=m1`);
      expect(status2Url).toBe(`${UPLOAD_URL}?command=STATUS&media_id=m1`);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails the publish when media processing reports a failed state', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(new Response('videodata', { status: 200, headers: { 'Content-Type': 'video/mp4' } }))
        .mockResolvedValueOnce(jsonResponse({ media_id_string: 'm1', media_id: 1, size: 9 }))
        .mockResolvedValueOnce(jsonResponse({}))
        .mockResolvedValueOnce(jsonResponse({ media_id_string: 'm1', media_id: 1, size: 9, processing_state: 'pending' }))
        .mockResolvedValueOnce(
          jsonResponse({ processing_info: { state: 'failed', error: { code: 1, name: 'n', message: 'bad media' } } }),
        );
      vi.stubGlobal('fetch', fetchMock);

      const c = new XConnector(AUTH);
      const promise = c.publish(input({ mediaUrls: ['https://cdn.example.com/video.mp4'] }));

      await vi.advanceTimersByTimeAsync(2_000);

      const result = await promise;
      expect(result.state).toBe('failed');
      expect(result.error).toBe('X media processing failed: bad media');
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns a failed result when the media download fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 404));
    vi.stubGlobal('fetch', fetchMock);

    const c = new XConnector(AUTH);
    const result = await c.publish(input({ mediaUrls: ['https://cdn.example.com/pic.jpg'] }));

    expect(result.state).toBe('failed');
    expect(result.error).toBe('Failed to download media from https://cdn.example.com/pic.jpg: 404');
  });

  it('returns a failed result when the media INIT fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('data', { status: 200, headers: { 'Content-Type': 'image/jpeg' } }))
      .mockResolvedValueOnce(jsonResponse({ error: 'no' }, 500));
    vi.stubGlobal('fetch', fetchMock);

    const c = new XConnector(AUTH);
    const result = await c.publish(input({ mediaUrls: ['https://cdn.example.com/pic.jpg'] }));

    expect(result.state).toBe('failed');
    expect(result.error).toContain('X media INIT failed: HTTP 500');
  });

  it('returns a failed result when a media APPEND fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('data', { status: 200, headers: { 'Content-Type': 'image/jpeg' } }))
      .mockResolvedValueOnce(jsonResponse({ media_id_string: 'm1', media_id: 1, size: 4 }))
      .mockResolvedValueOnce(jsonResponse({ error: 'too big' }, 413));
    vi.stubGlobal('fetch', fetchMock);

    const c = new XConnector(AUTH);
    const result = await c.publish(input({ mediaUrls: ['https://cdn.example.com/pic.jpg'] }));

    expect(result.state).toBe('failed');
    expect(result.error).toContain('X media APPEND failed at segment 0: HTTP 413');
  });

  it('returns a failed result when the media FINALIZE fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('data', { status: 200, headers: { 'Content-Type': 'image/jpeg' } }))
      .mockResolvedValueOnce(jsonResponse({ media_id_string: 'm1', media_id: 1, size: 4 }))
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({ error: 'nope' }, 500));
    vi.stubGlobal('fetch', fetchMock);

    const c = new XConnector(AUTH);
    const result = await c.publish(input({ mediaUrls: ['https://cdn.example.com/pic.jpg'] }));

    expect(result.state).toBe('failed');
    expect(result.error).toContain('X media FINALIZE failed: HTTP 500');
  });

  it('returns a failed result when the tweet creation fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('data', { status: 200, headers: { 'Content-Type': 'image/jpeg' } }))
      .mockResolvedValueOnce(jsonResponse({ media_id_string: 'm1', media_id: 1, size: 4 }))
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({ media_id_string: 'm1', media_id: 1, size: 4 }))
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'duplicate' } }, 403));
    vi.stubGlobal('fetch', fetchMock);

    const c = new XConnector(AUTH);
    const result = await c.publish(input({ mediaUrls: ['https://cdn.example.com/pic.jpg'] }));

    expect(result.state).toBe('failed');
    expect(result.error).toContain('API POST https://api.twitter.com/2/tweets failed: 403');
  });
});

describe('fetchMetrics', () => {
  it('maps public_metrics into ConnectorMetrics', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          id: 'tweet-1',
          public_metrics: {
            like_count: 5,
            reply_count: 2,
            retweet_count: 3,
            quote_count: 1,
            impression_count: 100,
            bookmark_count: 0,
          },
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const c = new XConnector(AUTH);
    const metrics = await c.fetchMetrics('tweet-1');

    expect(metrics.postId).toBe('tweet-1');
    expect(metrics.platform).toBe('x');
    expect(metrics.metrics).toEqual({
      likes: 5,
      comments: 2,
      shares: 3,
      impressions: 100,
      reposts: 3,
      quotes: 1,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.twitter.com/2/tweets/tweet-1?tweet.fields=public_metrics');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer x-token-123');
  });

  it('defaults missing metric fields to zero', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: { id: 'tweet-1' } })));
    const c = new XConnector(AUTH);
    const metrics = await c.fetchMetrics('tweet-1');
    expect(metrics.metrics).toEqual({
      likes: 0,
      comments: 0,
      shares: 0,
      impressions: 0,
      reposts: 0,
      quotes: 0,
    });
  });

  it('throws when the metrics endpoint fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 500)));
    const c = new XConnector(AUTH);
    await expect(c.fetchMetrics('tweet-1')).rejects.toThrow('X metrics fetch failed: HTTP 500');
  });

  it('throws when the tweet is not found', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({})));
    const c = new XConnector(AUTH);
    await expect(c.fetchMetrics('tweet-1')).rejects.toThrow('X tweet tweet-1 not found');
  });
});

describe('revoke', () => {
  it('revokes the OAuth token with client_id and clears auth data', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ revoked: true }));
    vi.stubGlobal('fetch', fetchMock);

    const c = new XConnector(AUTH);
    await c.revoke();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.twitter.com/2/oauth2/revoke');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('token=x-token-123&token_type_hint=access_token&client_id=x-client-1');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/x-www-form-urlencoded');

    expect(c.getLogs().some((l) => l.action === 'revoke' && l.message.includes('token revoked'))).toBe(true);
    expect(c.auth.accessToken).toBe('');
    expect(c.auth.refreshToken).toBeUndefined();
    expect(c.auth.expiresAt).toBe(0);
  });

  it('omits client_id when not configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ revoked: true }));
    vi.stubGlobal('fetch', fetchMock);

    const c = new XConnector({ accessToken: 'x-token-123' });
    await c.revoke();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe('token=x-token-123&token_type_hint=access_token');
  });

  it('warns but does not throw when revocation fails, and still clears auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: 'invalid_token' }, 400));
    vi.stubGlobal('fetch', fetchMock);

    const c = new XConnector(AUTH);
    await expect(c.revoke()).resolves.toBeUndefined();

    expect(c.getLogs().some((l) => l.level === 'warn' && l.message.includes('warned: 400'))).toBe(true);
    expect(c.auth.accessToken).toBe('');
    expect(c.auth.expiresAt).toBe(0);
  });
});
