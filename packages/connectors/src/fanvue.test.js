// ─── Fanvue Connector — Vitest Suite (real Fanvue API v2025-06-26) ───
// Covers: capability(), validate(), publish() with the documented S3
// multipart flow (download → create session → presigned parts → complete →
// create post), idempotency, failure paths, fetchMetrics(), revoke(), and
// token refresh via the Ory client_secret_basic endpoint.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { FanvueConnector } from './fanvue.js';
const AUTH = {
    accessToken: 'fanvue-token',
    externalUserId: 'de5c2550-652b-4342-8f9d-f612962625d9',
};
function refreshAuth() {
    return {
        accessToken: 'fanvue-token',
        refreshToken: 'ory_rt_test',
        expiresAt: Math.floor(Date.now() / 1000) - 60, // already expired → refresh path
        externalUserId: 'de5c2550-652b-4342-8f9d-f612962625d9',
        extra: { clientId: 'client-1', clientSecret: 'secret-1' },
    };
}
function input(overrides = {}) {
    return {
        idempotencyKey: `fk-${Math.random().toString(36).slice(2)}`,
        caption: 'Check out my new post!',
        mediaUrls: ['https://cdn.example.com/photo.jpg'],
        hashtags: ['summer', 'model'],
        ...overrides,
    };
}
function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}
afterEach(() => {
    vi.unstubAllGlobals();
});
describe('FanvueConnector', () => {
    it('declares fanvue capabilities against the real API limits', () => {
        const c = new FanvueConnector(AUTH);
        const cap = c.capability();
        expect(cap.publish).toBe(true);
        expect(cap.media).toEqual(['image', 'video', 'audio']);
        expect(cap.maxMediaBytes).toBe(1_610_612_736);
        expect(cap.maxMediaCount).toBe(10);
        expect(cap.maxCaptionLength).toBe(5000);
        expect(cap.scheduling).toBe('internal');
        expect(cap.metrics).toEqual(['likes', 'comments']);
    });
    it('exposes platform, displayName and publishMode', () => {
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
    it('errors when the caption is missing', async () => {
        const c = new FanvueConnector(AUTH);
        const report = await c.validate(input({ caption: '' }));
        expect(report.valid).toBe(false);
        expect(report.errors.some((e) => e.field === 'caption')).toBe(true);
    });
});
describe('publish', () => {
    /** Build a fetch mock for the full multipart flow (1 part). */
    function multipartFetchMock(overrides = {}) {
        const mediaBytes = new Uint8Array([1, 2, 3, 4]);
        const fetchMock = vi.fn().mockImplementation((url, init) => {
            const u = String(url);
            if (u.startsWith('https://cdn.example.com/')) {
                return Promise.resolve(new Response(mediaBytes, {
                    status: 200,
                    headers: { 'Content-Type': 'image/jpeg' },
                }));
            }
            if (u.endsWith('/media/uploads') && (init?.method ?? 'GET') === 'POST') {
                return Promise.resolve(jsonResponse({
                    mediaUuid: 'm-uuid-1',
                    uploadId: 'up-1',
                    partSize: 4,
                    maxParts: 1,
                    totalParts: 1,
                }, overrides.uploadStatus ?? 200));
            }
            if (u.includes('/media/uploads/up-1/parts/1/url')) {
                return Promise.resolve(new Response('https://s3.example.com/part-1', { status: 200 }));
            }
            if (u.startsWith('https://s3.example.com/')) {
                return Promise.resolve(new Response(null, { status: 200, headers: { etag: '"etag-1"' } }));
            }
            if (u.endsWith('/media/uploads/up-1') && (init?.method ?? '') === 'PATCH') {
                return Promise.resolve(jsonResponse({ status: 'processing' }));
            }
            if (u.endsWith('/posts') && (init?.method ?? '') === 'POST') {
                return Promise.resolve(jsonResponse({
                    uuid: 'post-1',
                    createdAt: '2026-08-07T00:00:00.000Z',
                    text: 'Check out my new post!',
                    price: null,
                    audience: 'followers-and-subscribers',
                    publishAt: null,
                    publishedAt: '2026-08-07T00:00:00.000Z',
                    expiresAt: null,
                }, overrides.postStatus ?? 201));
            }
            return Promise.resolve(jsonResponse({ error: 'unexpected call' }, 500));
        });
        return { fetchMock, mediaBytes };
    }
    it('uploads via the multipart flow then creates the post', async () => {
        const { fetchMock } = multipartFetchMock();
        vi.stubGlobal('fetch', fetchMock);
        const c = new FanvueConnector(AUTH);
        const result = await c.publish(input());
        expect(result.state).toBe('published');
        expect(result.remoteId).toBe('post-1');
        expect(result.postUrl).toBe('https://fanvue.com/post/post-1');
        expect(result.latencyMs).toEqual(expect.any(Number));
        // First call downloads the media.
        expect(fetchMock.mock.calls[0][0]).toBe('https://cdn.example.com/photo.jpg');
        // Upload session creation carries the version header and media metadata.
        const createSession = fetchMock.mock.calls.find((call) => String(call[0]).endsWith('/media/uploads') && (call[1]?.method ?? 'GET') === 'POST');
        expect(createSession).toBeTruthy();
        expect(createSession[1].headers['X-Fanvue-API-Version']).toBe('2025-06-26');
        expect(JSON.parse(createSession[1].body)).toEqual({
            name: 'photo.jpg',
            filename: 'photo.jpg',
            mediaType: 'image',
            sizeBytes: 4,
        });
        // Presigned part URL fetched with the creator uuid.
        const partUrlCall = fetchMock.mock.calls.find((call) => String(call[0]).includes('/creators/de5c2550-652b-4342-8f9d-f612962625d9/media/uploads/up-1/parts/1/url'));
        expect(partUrlCall).toBeTruthy();
        // Part PUT goes to the signed URL with raw bytes.
        const putCall = fetchMock.mock.calls.find((call) => String(call[0]) === 'https://s3.example.com/part-1');
        expect(putCall).toBeTruthy();
        expect(putCall[1].method).toBe('PUT');
        // Complete session carries the ETag.
        const completeCall = fetchMock.mock.calls.find((call) => String(call[0]).endsWith('/media/uploads/up-1') && (call[1]?.method ?? '') === 'PATCH');
        expect(completeCall).toBeTruthy();
        expect(JSON.parse(completeCall[1].body)).toEqual({
            parts: [{ partNumber: 1, etag: '"etag-1"' }],
        });
        // Post creation body matches the API reference.
        const postCall = fetchMock.mock.calls.find((call) => String(call[0]).endsWith('/posts') && (call[1]?.method ?? '') === 'POST');
        expect(JSON.parse(postCall[1].body)).toEqual({
            audience: 'followers-and-subscribers',
            text: 'Check out my new post!',
            mediaUuids: ['m-uuid-1'],
            publishAt: null,
        });
    });
    it('passes publishAt through when scheduledFor is provided', async () => {
        const { fetchMock } = multipartFetchMock();
        vi.stubGlobal('fetch', fetchMock);
        const c = new FanvueConnector(AUTH);
        await c.publish(input({ scheduledFor: '2026-08-02T10:00:00Z' }));
        const postCall = fetchMock.mock.calls.find((call) => String(call[0]).endsWith('/posts') && (call[1]?.method ?? '') === 'POST');
        expect(JSON.parse(postCall[1].body).publishAt).toBe('2026-08-02T10:00:00Z');
    });
    it('honors the audience option', async () => {
        const { fetchMock } = multipartFetchMock();
        vi.stubGlobal('fetch', fetchMock);
        const c = new FanvueConnector(AUTH);
        await c.publish(input({ options: { audience: 'subscribers' } }));
        const postCall = fetchMock.mock.calls.find((call) => String(call[0]).endsWith('/posts') && (call[1]?.method ?? '') === 'POST');
        expect(JSON.parse(postCall[1].body).audience).toBe('subscribers');
    });
    it('resolves the creator uuid from /users/me when externalUserId is absent', async () => {
        const { fetchMock } = multipartFetchMock();
        // First call is /users/me
        const meCall = vi.fn().mockResolvedValueOnce(jsonResponse({ uuid: 'me-uuid-42', handle: 'creator', isCreator: true }));
        vi.stubGlobal('fetch', vi.fn().mockImplementation((url, init) => {
            const u = String(url);
            if (u.endsWith('/users/me'))
                return meCall();
            return fetchMock(url, init);
        }));
        const c = new FanvueConnector({ accessToken: 'fanvue-token' });
        const result = await c.publish(input());
        expect(result.state).toBe('published');
        const partUrlCall = fetchMock.mock.calls.find((call) => String(call[0]).includes('/creators/me-uuid-42/media/uploads/'));
        expect(partUrlCall).toBeTruthy();
    });
    it('is idempotent: a repeated publish with the same key is skipped without new requests', async () => {
        const { fetchMock } = multipartFetchMock();
        vi.stubGlobal('fetch', fetchMock);
        const c = new FanvueConnector(AUTH);
        const i = input({ idempotencyKey: 'same-key' });
        const first = await c.publish(i);
        const second = await c.publish(i);
        expect(first.state).toBe('published');
        expect(second.state).toBe('skipped');
        expect(second.remoteId).toBe('post-1');
    });
    it('returns a failed result when the upload session fails', async () => {
        const { fetchMock } = multipartFetchMock({ uploadStatus: 500 });
        vi.stubGlobal('fetch', fetchMock);
        const c = new FanvueConnector(AUTH);
        const result = await c.publish(input());
        expect(result.state).toBe('failed');
        expect(result.error).toContain('Fanvue API POST /media/uploads failed: 500');
        expect(result.remoteId).toBeNull();
    });
    it('returns a failed result when the post creation fails', async () => {
        const { fetchMock } = multipartFetchMock({ postStatus: 422 });
        vi.stubGlobal('fetch', fetchMock);
        const c = new FanvueConnector(AUTH);
        const result = await c.publish(input());
        expect(result.state).toBe('failed');
        expect(result.error).toContain('Fanvue API POST /posts failed: 422');
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
    it('maps GET /posts/{uuid} into ConnectorMetrics with likes + comments', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
            uuid: 'post-1',
            likesCount: 42,
            commentsCount: 7,
            tips: { count: 3, totalGross: 5000, totalNet: 4250 },
            price: 999,
            audience: 'subscribers',
            publishedAt: '2026-08-07T00:00:00.000Z',
        })));
        const c = new FanvueConnector(AUTH);
        const metrics = await c.fetchMetrics('post-1');
        expect(metrics.postId).toBe('post-1');
        expect(metrics.platform).toBe('fanvue');
        expect(metrics.metrics).toEqual({ likes: 42, comments: 7 });
        expect(metrics.raw).toMatchObject({ tips: { count: 3 }, price: 999 });
        expect(metrics.collectedAt).toBeTruthy();
        const [url, init] = (vi.mocked(fetch).mock.calls[0] ?? []);
        expect(url).toBe('https://api.fanvue.com/posts/post-1');
        expect(init.method).toBe('GET');
        expect(init.headers.Authorization).toBe('Bearer fanvue-token');
        expect(init.headers['X-Fanvue-API-Version']).toBe('2025-06-26');
    });
    it('throws when the post endpoint fails', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 500)));
        const c = new FanvueConnector(AUTH);
        await expect(c.fetchMetrics('post-1')).rejects.toThrow('Fanvue API GET /posts/post-1 failed');
    });
});
describe('token refresh', () => {
    it('exchanges the refresh token via Ory client_secret_basic when expired', async () => {
        const tokenFetch = vi.fn().mockResolvedValue(jsonResponse({ access_token: 'fresh-token', expires_in: 3600, token_type: 'bearer' }));
        vi.stubGlobal('fetch', tokenFetch);
        const c = new FanvueConnector(refreshAuth());
        const { accessToken, expiresAt } = await c.refreshAccessToken();
        expect(accessToken).toBe('fresh-token');
        expect(expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
        const [url, init] = tokenFetch.mock.calls[0];
        expect(url).toBe('https://auth.fanvue.com/oauth2/token');
        const headers = init.headers;
        expect(headers.Authorization).toMatch(/^Basic /);
        const body = new URLSearchParams(init.body);
        expect(body.get('grant_type')).toBe('refresh_token');
        expect(body.get('refresh_token')).toBe('ory_rt_test');
    });
    it('throws when refresh credentials are absent', async () => {
        const c = new FanvueConnector(AUTH);
        await expect(c.refreshAccessToken()).rejects.toThrow('Fanvue token refresh requires refreshToken + clientId + clientSecret');
    });
    it('refreshes before a request when the token is expired', async () => {
        const refreshFetch = vi
            .fn()
            .mockResolvedValueOnce(jsonResponse({ access_token: 'fresh-token', expires_in: 3600 }))
            .mockResolvedValueOnce(jsonResponse({
            uuid: 'post-1',
            likesCount: 1,
            commentsCount: 0,
            tips: null,
        }));
        vi.stubGlobal('fetch', refreshFetch);
        const c = new FanvueConnector(refreshAuth());
        const metrics = await c.fetchMetrics('post-1');
        expect(metrics.metrics.likes).toBe(1);
        expect(refreshFetch.mock.calls[0][0]).toBe('https://auth.fanvue.com/oauth2/token');
        const [url, init] = refreshFetch.mock.calls[1];
        expect(url).toBe('https://api.fanvue.com/posts/post-1');
        expect(init.headers.Authorization).toBe('Bearer fresh-token');
    });
    it('throws on expired token without refresh credentials', async () => {
        const expired = {
            accessToken: 'stale',
            expiresAt: Math.floor(Date.now() / 1000) - 10,
            externalUserId: 'uuid-1',
        };
        const c = new FanvueConnector(expired);
        await expect(c.fetchMetrics('post-1')).rejects.toThrow('Fanvue access token expired and no refresh credentials available');
    });
});
describe('revoke', () => {
    it('revokes the refresh token via the Ory RFC 7009 endpoint', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const c = new FanvueConnector(refreshAuth());
        await c.revoke();
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://auth.fanvue.com/oauth2/revoke');
        const body = new URLSearchParams(init.body);
        expect(body.get('token')).toBe('ory_rt_test');
        expect(body.get('token_type_hint')).toBe('refresh_token');
        expect(c.getLogs().some((l) => l.action === 'revoke')).toBe(true);
    });
    it('logs a warning when no refresh credentials are available', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const c = new FanvueConnector(AUTH);
        await c.revoke();
        expect(fetchMock).not.toHaveBeenCalled();
        expect(c.getLogs().some((l) => l.action === 'revoke' && l.level === 'warn')).toBe(true);
    });
});
//# sourceMappingURL=fanvue.test.js.map