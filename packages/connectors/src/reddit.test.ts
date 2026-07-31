// ─── Reddit Connector — Vitest Suite ───
// Covers: capability(), validate(), publish() kind selection (self/link/image/video)
// with subreddit-rules check then submit, fetchMetrics() via /api/info, and revoke()
// via the OAuth revoke_token endpoint.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { RedditConnector } from './reddit.js';
import type { ConnectorAuth, ConnectorPublishInput } from './types.js';

const AUTH: ConnectorAuth = {
  accessToken: 'reddit-token-123',
  extra: { clientId: 'client-1', clientSecret: 'secret-1' },
};

function input(overrides: Partial<ConnectorPublishInput> = {}): ConnectorPublishInput {
  return {
    idempotencyKey: `rdt-${Math.random().toString(36).slice(2)}`,
    caption: 'Test post title',
    mediaUrls: [],
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const EMPTY_RULES = { rules: [], site_rules: [] };

const SUBMIT_OK = {
  json: {
    errors: [],
    data: {
      id: 'abc123',
      name: 't3_abc123',
      url: 'https://reddit.com/r/testsub/comments/abc123',
    },
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RedditConnector basics', () => {
  it('declares reddit capabilities', () => {
    const c = new RedditConnector(AUTH);
    const cap = c.capability();
    expect(cap.publish).toBe(true);
    expect(cap.media).toEqual(['image', 'video']);
    expect(cap.maxMediaBytes).toBe(1_073_741_824);
    expect(cap.maxMediaCount).toBe(1);
    expect(cap.caption).toBe(true);
    expect(cap.maxCaptionLength).toBe(40_000);
    expect(cap.scheduling).toBe('internal');
    expect(cap.metrics).toEqual(['views', 'likes', 'comments', 'shares']);
    expect(cap.refreshMetrics).toBe(true);
  });

  it('exposes platform, displayName, and publishMode', () => {
    const c = new RedditConnector(AUTH);
    expect(c.platform).toBe('reddit');
    expect(c.displayName).toBe('Reddit');
    expect(c.publishMode).toBe('api');
  });
});

describe('validate', () => {
  it('passes a valid input', async () => {
    const c = new RedditConnector(AUTH);
    const report = await c.validate(input({ mediaUrls: ['https://cdn.example.com/pic.jpg'] }));
    expect(report.valid).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.tosVerdict).toBe('pass');
  });

  it('errors when mediaUrls is empty', async () => {
    const c = new RedditConnector(AUTH);
    const report = await c.validate(input());
    expect(report.valid).toBe(false);
    expect(report.errors).toContainEqual({
      field: 'mediaUrls',
      message: 'At least one media URL is required.',
      severity: 'error',
    });
  });

  it('errors when the caption exceeds maxCaptionLength', async () => {
    const c = new RedditConnector(AUTH);
    const report = await c.validate(input({ caption: 'a'.repeat(40_001) }));
    expect(report.valid).toBe(false);
    expect(report.errors).toContainEqual({
      field: 'caption',
      message: 'Caption exceeds maximum length of 40000 characters (got 40001).',
      severity: 'error',
    });
  });

  it('errors when more than maxMediaCount media items are provided', async () => {
    const c = new RedditConnector(AUTH);
    const report = await c.validate(
      input({ mediaUrls: ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg'] }),
    );
    expect(report.valid).toBe(false);
    expect(report.errors).toContainEqual({
      field: 'mediaUrls',
      message: 'Maximum of 1 media items allowed (got 2).',
      severity: 'error',
    });
  });

  it('warns for unsupported media types (gif)', async () => {
    const c = new RedditConnector(AUTH);
    const report = await c.validate(input({ mediaUrls: ['https://cdn.example.com/anim.gif'] }));
    expect(report.valid).toBe(true);
    expect(report.warnings).toContainEqual({
      field: 'mediaUrls[0]',
      message: 'Media type "gif" is not in the connector\'s supported types (image, video).',
      severity: 'warning',
    });
    expect(report.tosVerdict).toBe('flag');
  });
});

describe('publish', () => {
  it('submits a self post after checking subreddit rules', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(EMPTY_RULES))
      .mockResolvedValueOnce(jsonResponse(SUBMIT_OK));
    vi.stubGlobal('fetch', fetchMock);

    const c = new RedditConnector(AUTH);
    const result = await c.publish(input({ options: { subreddit: 'testsub' } }));

    expect(result.state).toBe('published');
    expect(result.remoteId).toBe('t3_abc123');
    expect(result.postUrl).toBe('https://reddit.com/r/testsub/comments/abc123');

    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [rulesUrl, rulesInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(rulesUrl).toBe('https://oauth.reddit.com/r/testsub/about/rules');
    expect(rulesInit.method).toBeUndefined(); // GET is the fetch default; no explicit method
    expect((rulesInit.headers as Record<string, string>).Authorization).toBe('Bearer reddit-token-123');

    const [submitUrl, submitInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(submitUrl).toBe('https://oauth.reddit.com/api/submit');
    expect(submitInit.method).toBe('POST');
    const body = submitInit.body as string;
    expect(body).toContain('sr=testsub');
    expect(body).toContain('kind=self');
    expect(body).toContain('title=Test+post+title');
    expect(body).toContain('text=Test+post+title');
    expect(body).toContain('resubmit=true');
    const headers = submitInit.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(headers['User-Agent']).toBe('axiom:connector:reddit:v0.1.0 (by /u/axiom)');
  });

  it('submits a link post when options.link is provided', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(EMPTY_RULES))
      .mockResolvedValueOnce(jsonResponse(SUBMIT_OK));
    vi.stubGlobal('fetch', fetchMock);

    const c = new RedditConnector(AUTH);
    const result = await c.publish(
      input({ options: { subreddit: 'testsub', link: 'https://example.com/page' } }),
    );

    expect(result.state).toBe('published');
    const body = (fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string;
    expect(body).toContain('kind=link');
    expect(body).toContain('url=https%3A%2F%2Fexample.com%2Fpage');
    expect(body).not.toContain('text=');
  });

  it('submits an image post with the media URL', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(EMPTY_RULES))
      .mockResolvedValueOnce(jsonResponse(SUBMIT_OK));
    vi.stubGlobal('fetch', fetchMock);

    const c = new RedditConnector(AUTH);
    const result = await c.publish(
      input({ mediaUrls: ['https://cdn.example.com/pic.png'], options: { subreddit: 'testsub' } }),
    );

    expect(result.state).toBe('published');
    const body = (fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string;
    expect(body).toContain('kind=image');
    expect(body).toContain('url=https%3A%2F%2Fcdn.example.com%2Fpic.png');
    expect(body).not.toContain('text=');
  });

  it('submits a video post for video URLs', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(EMPTY_RULES))
      .mockResolvedValueOnce(jsonResponse(SUBMIT_OK));
    vi.stubGlobal('fetch', fetchMock);

    const c = new RedditConnector(AUTH);
    await c.publish(
      input({ mediaUrls: ['https://cdn.example.com/clip.mp4'], options: { subreddit: 'testsub' } }),
    );

    const body = (fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string;
    expect(body).toContain('kind=video');
    expect(body).toContain('url=https%3A%2F%2Fcdn.example.com%2Fclip.mp4');
  });

  it('passes nsfw, spoiler, sendreplies and flair options through', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(EMPTY_RULES))
      .mockResolvedValueOnce(jsonResponse(SUBMIT_OK));
    vi.stubGlobal('fetch', fetchMock);

    const c = new RedditConnector(AUTH);
    await c.publish(
      input({
        options: {
          subreddit: 'testsub',
          nsfw: true,
          spoiler: false,
          sendreplies: true,
          flairId: 'flair-7',
          flairText: 'Discussion',
        },
      }),
    );

    const body = (fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string;
    expect(body).toContain('nsfw=true');
    expect(body).toContain('spoiler=false');
    expect(body).toContain('sendreplies=true');
    expect(body).toContain('flair_id=flair-7');
    expect(body).toContain('flair_text=Discussion');
  });

  it('truncates the title to 300 characters', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(EMPTY_RULES))
      .mockResolvedValueOnce(jsonResponse(SUBMIT_OK));
    vi.stubGlobal('fetch', fetchMock);

    const longCaption = 't'.repeat(500);
    const c = new RedditConnector(AUTH);
    await c.publish(input({ caption: longCaption, options: { subreddit: 'testsub' } }));

    const body = (fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string;
    expect(body).toContain(`title=${'t'.repeat(300)}`);
    expect(body).toContain(`text=${'t'.repeat(500)}`);
  });

  it('logs potential rule violations but still submits', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          rules: [
            { short_name: 'No Spam', description: 'Do not spam the subreddit', violation_reason: 'spam' },
            { short_name: 'Be Nice', description: 'Be kind to others' },
          ],
          site_rules: [],
        }),
      )
      .mockResolvedValueOnce(jsonResponse(SUBMIT_OK));
    vi.stubGlobal('fetch', fetchMock);

    const c = new RedditConnector(AUTH);
    const result = await c.publish(
      input({
        caption: 'Check https://a.com and https://b.com in this post please',
        options: { subreddit: 'testsub' },
      }),
    );

    expect(result.state).toBe('published');
    expect(
      c.getLogs().some((l) => l.level === 'warn' && l.message.includes('Subreddit rules may be violated')),
    ).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('continues to submit when the rules endpoint fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'rate limited' }, 429))
      .mockResolvedValueOnce(jsonResponse(SUBMIT_OK));
    vi.stubGlobal('fetch', fetchMock);

    const c = new RedditConnector(AUTH);
    const result = await c.publish(input({ options: { subreddit: 'testsub' } }));
    expect(result.state).toBe('published');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns a failed result when subreddit is missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const c = new RedditConnector(AUTH);
    const result = await c.publish(input());

    expect(result.state).toBe('failed');
    expect(result.error).toBe('Reddit requires a subreddit in input.options.subreddit');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns a failed result when the submit endpoint fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(EMPTY_RULES))
      .mockResolvedValueOnce(jsonResponse({ error: 'boom' }, 500));
    vi.stubGlobal('fetch', fetchMock);

    const c = new RedditConnector(AUTH);
    const result = await c.publish(input({ options: { subreddit: 'testsub' } }));

    expect(result.state).toBe('failed');
    expect(result.error).toContain('Reddit submit failed: HTTP 500');
  });

  it('returns a failed result when Reddit rejects the submission', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(EMPTY_RULES))
      .mockResolvedValueOnce(
        jsonResponse({ json: { errors: [['BAD_TITLE', 'bad title'], ['NO_TEXT', 'no text']] } }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const c = new RedditConnector(AUTH);
    const result = await c.publish(input({ options: { subreddit: 'testsub' } }));

    expect(result.state).toBe('failed');
    expect(result.error).toBe('Reddit submit rejected: BAD_TITLE: bad title; NO_TEXT: no text');
  });

  it('returns a failed result when no post ID is returned', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(EMPTY_RULES))
      .mockResolvedValueOnce(jsonResponse({ json: { errors: [], data: {} } }));
    vi.stubGlobal('fetch', fetchMock);

    const c = new RedditConnector(AUTH);
    const result = await c.publish(input({ options: { subreddit: 'testsub' } }));

    expect(result.state).toBe('failed');
    expect(result.error).toBe('Reddit did not return a post ID');
  });

  it('builds a fallback postUrl from the subreddit when data.url is missing', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(EMPTY_RULES))
      .mockResolvedValueOnce(
        jsonResponse({ json: { errors: [], data: { id: 'abc123', name: 't3_abc123' } } }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const c = new RedditConnector(AUTH);
    const result = await c.publish(input({ options: { subreddit: 'testsub' } }));

    expect(result.state).toBe('published');
    expect(result.postUrl).toBe('https://www.reddit.com/r/testsub/comments/abc123/');
  });
});

describe('fetchMetrics', () => {
  it('normalizes the id with a t3_ prefix and maps info data', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        kind: 'Listing',
        data: {
          children: [
            {
              kind: 't3',
              data: {
                id: 'abc123',
                name: 't3_abc123',
                title: 'Test post title',
                ups: 10,
                downvotes: 2,
                score: 8,
                num_comments: 5,
                view_count: 100,
                url: 'https://reddit.com/r/testsub/comments/abc123',
                permalink: '/r/testsub/comments/abc123/test_post_title/',
                created_utc: 1_700_000_000,
              },
            },
          ],
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const c = new RedditConnector(AUTH);
    const metrics = await c.fetchMetrics('abc123');

    expect(metrics.postId).toBe('abc123');
    expect(metrics.platform).toBe('reddit');
    expect(metrics.metrics).toEqual({ views: 100, likes: 8, comments: 5, shares: 0 });
    expect(metrics.raw).toMatchObject({ ups: 10, downvotes: 2, score: 8 });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://oauth.reddit.com/api/info?id=t3_abc123');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer reddit-token-123');
  });

  it('keeps an already-prefixed id unchanged', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        kind: 'Listing',
        data: {
          children: [
            {
              kind: 't3',
              data: {
                id: 'abc123',
                name: 't3_abc123',
                title: 't',
                ups: 1,
                num_comments: 0,
                url: 'u',
                permalink: 'p',
                created_utc: 0,
              },
            },
          ],
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const c = new RedditConnector(AUTH);
    await c.fetchMetrics('t3_abc123');
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('https://oauth.reddit.com/api/info?id=t3_abc123');
  });

  it('clamps negative likes to zero', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          children: [
            {
              data: {
                id: 'x',
                name: 't3_x',
                title: 't',
                ups: 1,
                downvotes: 5,
                num_comments: 0,
                url: 'u',
                permalink: 'p',
                created_utc: 0,
              },
            },
          ],
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const c = new RedditConnector(AUTH);
    const metrics = await c.fetchMetrics('x');
    expect(metrics.metrics.likes).toBe(0);
  });

  it('throws when the info endpoint fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 500)));
    const c = new RedditConnector(AUTH);
    await expect(c.fetchMetrics('abc123')).rejects.toThrow('Reddit info fetch failed: HTTP 500');
  });

  it('throws when the post is not found', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ kind: 'Listing', data: { children: [] } })));
    const c = new RedditConnector(AUTH);
    await expect(c.fetchMetrics('abc123')).rejects.toThrow('Reddit post abc123 not found');
  });
});

describe('revoke', () => {
  it('revokes the OAuth token with Basic credentials and clears auth data', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true }));
    vi.stubGlobal('fetch', fetchMock);

    const c = new RedditConnector(AUTH);
    await c.revoke();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://www.reddit.com/api/v1/revoke_token');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('token=reddit-token-123&token_type_hint=access_token');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${Buffer.from('client-1:secret-1').toString('base64')}`);
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');

    expect(c.getLogs().some((l) => l.action === 'revoke' && l.message.includes('token revoked'))).toBe(true);
    expect(c.auth.accessToken).toBe('');
    expect(c.auth.refreshToken).toBeUndefined();
    expect(c.auth.expiresAt).toBe(0);
  });

  it('warns but does not throw when revocation fails, and still clears auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: 'invalid_grant' }, 400));
    vi.stubGlobal('fetch', fetchMock);

    const c = new RedditConnector(AUTH);
    await expect(c.revoke()).resolves.toBeUndefined();

    expect(c.getLogs().some((l) => l.level === 'warn' && l.message.includes('warned: 400'))).toBe(true);
    expect(c.auth.accessToken).toBe('');
    expect(c.auth.expiresAt).toBe(0);
  });
});
