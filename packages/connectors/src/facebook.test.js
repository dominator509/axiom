// ─── Facebook Connector — Vitest Suite ───
// Covers: capability(), validate() (media + caption rules), publish() branching
// by media type (feed / videos / stories / photos), fetchMetrics() with insights
// + fallback, and revoke() (page + user permission deletion, auth clearing).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { FacebookConnector } from './facebook.js';
const AUTH = {
    accessToken: 'fb-token-123',
    externalUserId: 'page-1',
};
function input(overrides = {}) {
    return {
        idempotencyKey: `fbk-${Math.random().toString(36).slice(2)}`,
        caption: 'Hello from the test post',
        mediaUrls: ['https://cdn.example.com/photo.jpg'],
        ...overrides,
    };
}
function jsonResponse(body, status = 200, headers = {}) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json', ...headers },
    });
}
afterEach(() => {
    vi.unstubAllGlobals();
});
describe('FacebookConnector basics', () => {
    it('declares facebook capabilities', () => {
        const c = new FacebookConnector(AUTH);
        const cap = c.capability();
        expect(cap.publish).toBe(true);
        expect(cap.media).toEqual(['image', 'video', 'story']);
        expect(cap.maxMediaBytes).toBe(4_294_967_296);
        expect(cap.maxMediaCount).toBe(10);
        expect(cap.caption).toBe(true);
        expect(cap.maxCaptionLength).toBe(63_206);
        expect(cap.scheduling).toBe('native');
        expect(cap.metrics).toEqual(['impressions', 'likes', 'comments', 'shares']);
        expect(cap.refreshMetrics).toBe(true);
    });
    it('exposes platform, displayName, and publishMode', () => {
        const c = new FacebookConnector(AUTH);
        expect(c.platform).toBe('facebook');
        expect(c.displayName).toBe('Facebook');
        expect(c.publishMode).toBe('api');
    });
});
describe('validate', () => {
    it('passes a valid input', async () => {
        const c = new FacebookConnector(AUTH);
        const report = await c.validate(input());
        expect(report.valid).toBe(true);
        expect(report.errors).toEqual([]);
        expect(report.tosVerdict).toBe('pass');
    });
    it('errors when mediaUrls is empty', async () => {
        const c = new FacebookConnector(AUTH);
        const report = await c.validate(input({ mediaUrls: [] }));
        expect(report.valid).toBe(false);
        expect(report.errors).toContainEqual({
            field: 'mediaUrls',
            message: 'At least one media URL is required.',
            severity: 'error',
        });
        expect(report.tosVerdict).toBe('block');
    });
    it('errors when the caption exceeds maxCaptionLength', async () => {
        const c = new FacebookConnector(AUTH);
        const report = await c.validate(input({ caption: 'a'.repeat(63_207) }));
        expect(report.valid).toBe(false);
        expect(report.errors).toContainEqual({
            field: 'caption',
            message: 'Caption exceeds maximum length of 63206 characters (got 63207).',
            severity: 'error',
        });
    });
    it('warns when the caption is empty', async () => {
        const c = new FacebookConnector(AUTH);
        const report = await c.validate(input({ caption: '' }));
        expect(report.valid).toBe(true);
        expect(report.warnings).toContainEqual({
            field: 'caption',
            message: 'This platform recommends including a caption.',
            severity: 'warning',
        });
        expect(report.tosVerdict).toBe('flag');
    });
    it('warns when a media type is not supported (gif)', async () => {
        const c = new FacebookConnector(AUTH);
        const report = await c.validate(input({ mediaUrls: ['https://cdn.example.com/anim.gif'] }));
        expect(report.valid).toBe(true);
        expect(report.warnings).toContainEqual({
            field: 'mediaUrls[0]',
            message: 'Media type "gif" is not in the connector\'s supported types (image, video, story).',
            severity: 'warning',
        });
    });
    it('errors when more than maxMediaCount media items are provided', async () => {
        const c = new FacebookConnector(AUTH);
        const urls = Array.from({ length: 11 }, (_, i) => `https://cdn.example.com/p${i}.jpg`);
        const report = await c.validate(input({ mediaUrls: urls }));
        expect(report.valid).toBe(false);
        expect(report.errors).toContainEqual({
            field: 'mediaUrls',
            message: 'Maximum of 10 media items allowed (got 11).',
            severity: 'error',
        });
    });
});
describe('publish', () => {
    it('publishes a text-only feed post (with optional link)', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'post-1' }));
        vi.stubGlobal('fetch', fetchMock);
        const c = new FacebookConnector(AUTH);
        const result = await c.publish(input({ mediaUrls: [], options: { link: 'https://example.com/landing' } }));
        expect(result.state).toBe('published');
        expect(result.remoteId).toBe('post-1');
        expect(result.postUrl).toBe('https://www.facebook.com/page-1/posts/post-1');
        expect(result.latencyMs).toEqual(expect.any(Number));
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://graph.facebook.com/v22.0/page-1/feed');
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body)).toEqual({
            message: 'Hello from the test post',
            access_token: 'fb-token-123',
            link: 'https://example.com/landing',
        });
        expect(init.headers.Authorization).toBe('Bearer fb-token-123');
    });
    it('publishes an image via the photos endpoint and prefers post_id', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValue(jsonResponse({ id: 'photo-1', post_id: 'post-9' }));
        vi.stubGlobal('fetch', fetchMock);
        const c = new FacebookConnector(AUTH);
        const result = await c.publish(input({ mediaUrls: ['https://cdn.example.com/photo.jpg'] }));
        expect(result.state).toBe('published');
        expect(result.remoteId).toBe('post-9');
        expect(result.postUrl).toBe('https://www.facebook.com/page-1/posts/post-9');
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://graph.facebook.com/v22.0/page-1/photos');
        expect(JSON.parse(init.body)).toEqual({
            url: 'https://cdn.example.com/photo.jpg',
            caption: 'Hello from the test post',
            access_token: 'fb-token-123',
        });
    });
    it('publishes a video via the videos endpoint', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'vid-1' }));
        vi.stubGlobal('fetch', fetchMock);
        const c = new FacebookConnector(AUTH);
        const result = await c.publish(input({ mediaUrls: ['https://cdn.example.com/clip.mp4'] }));
        expect(result.state).toBe('published');
        expect(result.remoteId).toBe('vid-1');
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://graph.facebook.com/v22.0/page-1/videos');
        expect(JSON.parse(init.body)).toEqual({
            file_url: 'https://cdn.example.com/clip.mp4',
            description: 'Hello from the test post',
            access_token: 'fb-token-123',
        });
    });
    it('publishes a story via the stories endpoint (no description field)', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'story-1' }));
        vi.stubGlobal('fetch', fetchMock);
        const c = new FacebookConnector(AUTH);
        const result = await c.publish(input({ mediaUrls: ['https://cdn.example.com/photo.heic'] }));
        expect(result.state).toBe('published');
        expect(result.remoteId).toBe('story-1');
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://graph.facebook.com/v22.0/page-1/stories');
        expect(JSON.parse(init.body)).toEqual({
            file_url: 'https://cdn.example.com/photo.heic',
            access_token: 'fb-token-123',
        });
    });
    it('uploads every media item in order and returns the last remoteId', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(jsonResponse({ id: 'photo-1' }))
            .mockResolvedValueOnce(jsonResponse({ id: 'vid-1' }));
        vi.stubGlobal('fetch', fetchMock);
        const c = new FacebookConnector(AUTH);
        const result = await c.publish(input({ mediaUrls: ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.mp4'] }));
        expect(result.remoteId).toBe('vid-1');
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[0][0]).toContain('/photos');
        expect(fetchMock.mock.calls[1][0]).toContain('/videos');
    });
    it('falls back to the photo id when post_id is missing', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'photo-1' }));
        vi.stubGlobal('fetch', fetchMock);
        const c = new FacebookConnector(AUTH);
        const result = await c.publish(input());
        expect(result.remoteId).toBe('photo-1');
    });
    it('returns a failed result when externalUserId (Page ID) is missing', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const c = new FacebookConnector({ accessToken: 'fb-token-123' });
        const result = await c.publish(input());
        expect(result.state).toBe('failed');
        expect(result.error).toBe('Facebook externalUserId (Page ID) is required');
        expect(result.remoteId).toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });
    it('returns a failed result when the feed endpoint fails', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: 'nope' }, 500));
        vi.stubGlobal('fetch', fetchMock);
        const c = new FacebookConnector(AUTH);
        const result = await c.publish(input({ mediaUrls: [] }));
        expect(result.state).toBe('failed');
        expect(result.error).toContain('API POST https://graph.facebook.com/v22.0/page-1/feed failed: 500');
    });
    it('returns a failed result when the photos endpoint fails', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: 'x' }, 400));
        vi.stubGlobal('fetch', fetchMock);
        const c = new FacebookConnector(AUTH);
        const result = await c.publish(input());
        expect(result.state).toBe('failed');
        expect(result.error).toContain('API POST https://graph.facebook.com/v22.0/page-1/photos failed: 400');
    });
    it('returns a failed result on network errors', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('socket hang up')));
        const c = new FacebookConnector(AUTH);
        const result = await c.publish(input());
        expect(result.state).toBe('failed');
        expect(result.error).toContain('socket hang up');
    });
});
describe('fetchMetrics', () => {
    it('maps insights data into ConnectorMetrics', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
            data: [
                { name: 'impressions', period: 'lifetime', values: [{ value: 100 }] },
                { name: 'likes', period: 'lifetime', values: [{ value: 12 }] },
                { name: 'comments', period: 'lifetime', values: [{ value: 3 }] },
                { name: 'shares', period: 'lifetime', values: [{ value: 7 }] },
            ],
        }));
        vi.stubGlobal('fetch', fetchMock);
        const c = new FacebookConnector(AUTH);
        const metrics = await c.fetchMetrics('post-1');
        expect(metrics.postId).toBe('post-1');
        expect(metrics.platform).toBe('facebook');
        expect(metrics.metrics).toEqual({ impressions: 100, likes: 12, comments: 3, shares: 7 });
        expect(metrics.collectedAt).toBeTruthy();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url] = fetchMock.mock.calls[0];
        expect(url).toBe('https://graph.facebook.com/v22.0/page-1_post-1/insights' +
            '?metric=impressions,likes,comments,shares&access_token=fb-token-123');
    });
    it('falls back to post fields when insights are missing likes and comments', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(jsonResponse({ data: [] }))
            .mockResolvedValueOnce(jsonResponse({
            likes: { summary: { total_count: 9 } },
            comments: { summary: { total_count: 4 } },
            shares: { count: 2 },
        }));
        vi.stubGlobal('fetch', fetchMock);
        const c = new FacebookConnector(AUTH);
        const metrics = await c.fetchMetrics('post-1');
        expect(metrics.metrics).toEqual({ impressions: 0, likes: 9, comments: 4, shares: 2 });
        expect(fetchMock).toHaveBeenCalledTimes(2);
        const [fallbackUrl] = fetchMock.mock.calls[1];
        expect(fallbackUrl).toBe('https://graph.facebook.com/v22.0/page-1_post-1' +
            '?fields=likes.summary(true).limit(0),comments.summary(true).limit(0),shares' +
            '&access_token=fb-token-123');
    });
    it('throws when the insights endpoint fails', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 500)));
        const c = new FacebookConnector(AUTH);
        await expect(c.fetchMetrics('post-1')).rejects.toThrow('Facebook metrics fetch failed: HTTP 500');
    });
    it('throws when externalUserId (Page ID) is missing', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const c = new FacebookConnector({ accessToken: 'fb-token-123' });
        await expect(c.fetchMetrics('post-1')).rejects.toThrow('Facebook externalUserId (Page ID) is required for metrics');
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
describe('revoke', () => {
    it('deletes page and user permissions and clears auth data', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(jsonResponse({ success: true }))
            .mockResolvedValueOnce(jsonResponse({ success: true }));
        vi.stubGlobal('fetch', fetchMock);
        const c = new FacebookConnector(AUTH);
        await c.revoke();
        expect(fetchMock).toHaveBeenCalledTimes(2);
        const [pageUrl, pageInit] = fetchMock.mock.calls[0];
        expect(pageUrl).toBe('https://graph.facebook.com/v22.0/page-1/permissions?access_token=fb-token-123');
        expect(pageInit.method).toBe('DELETE');
        const [userUrl, userInit] = fetchMock.mock.calls[1];
        expect(userUrl).toBe('https://graph.facebook.com/v22.0/me/permissions?access_token=fb-token-123');
        expect(userInit.method).toBe('DELETE');
        expect(c.auth.accessToken).toBe('');
        expect(c.auth.refreshToken).toBeUndefined();
        expect(c.auth.expiresAt).toBe(0);
        expect(c.getLogs().some((l) => l.action === 'revoke' && l.message.includes('permissions revoked'))).toBe(true);
    });
    it('warns and still clears auth when permission deletion fails', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(jsonResponse({ error: 'denied' }, 403))
            .mockRejectedValueOnce(new TypeError('network down'));
        vi.stubGlobal('fetch', fetchMock);
        const c = new FacebookConnector(AUTH);
        await expect(c.revoke()).resolves.toBeUndefined();
        expect(c.getLogs().some((l) => l.level === 'warn' && l.message.includes('warned: 403'))).toBe(true);
        expect(c.auth.accessToken).toBe('');
        expect(c.auth.expiresAt).toBe(0);
    });
    it('logs a warning and does not clear auth when no Page ID is set', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const c = new FacebookConnector({ accessToken: 'fb-token-123' });
        await c.revoke();
        expect(fetchMock).not.toHaveBeenCalled();
        expect(c.getLogs().some((l) => l.level === 'warn' && l.message.includes('skipping revoke'))).toBe(true);
        expect(c.auth.accessToken).toBe('fb-token-123');
    });
});
//# sourceMappingURL=facebook.test.js.map