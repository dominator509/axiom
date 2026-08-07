// ─── Telegram Connector — Vitest Suite ───
// Covers: capability(), validate(), publish() sendMessage flow with hashtags,
// fetchMetrics() empty metrics, and revoke().
import { describe, it, expect, vi, afterEach } from 'vitest';
import { TelegramConnector } from './telegram.js';
const AUTH = {
    accessToken: '123:bot-token',
    externalUserId: '@axiom_news',
};
function input(overrides = {}) {
    return {
        idempotencyKey: `tk-${Math.random().toString(36).slice(2)}`,
        caption: 'New update is live',
        mediaUrls: ['https://fanvue.com/post/1'],
        hashtags: ['news', 'update'],
        ...overrides,
    };
}
function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
afterEach(() => {
    vi.unstubAllGlobals();
});
describe('TelegramConnector', () => {
    it('declares telegram capabilities (link_share, no metrics)', () => {
        const c = new TelegramConnector(AUTH);
        expect(c.platform).toBe('telegram');
        expect(c.publishMode).toBe('link_share');
        const cap = c.capability();
        expect(cap.media).toEqual(['image', 'video']);
        expect(cap.maxMediaCount).toBe(1);
        expect(cap.maxCaptionLength).toBe(1024);
        expect(cap.metrics).toEqual([]);
        expect(cap.refreshMetrics).toBe(false);
    });
    it('validates: passes with media, fails without media', async () => {
        const c = new TelegramConnector(AUTH);
        expect((await c.validate(input())).valid).toBe(true);
        const bad = await c.validate(input({ mediaUrls: [] }));
        expect(bad.valid).toBe(false);
        expect(bad.errors[0]).toMatchObject({ field: 'mediaUrls', severity: 'error' });
    });
});
describe('publish', () => {
    it('sends a message with caption + link + hashtags to the channel', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
            ok: true,
            result: { message_id: 42, chat: { id: -100, type: 'channel' }, text: 'x' },
        }));
        vi.stubGlobal('fetch', fetchMock);
        const c = new TelegramConnector(AUTH);
        const result = await c.publish(input());
        expect(result.state).toBe('published');
        expect(result.remoteId).toBe('42');
        expect(result.postUrl).toBe('https://t.me/axiom_news/42');
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://api.telegram.org/bot123:bot-token/sendMessage');
        const body = JSON.parse(init.body);
        expect(body.chat_id).toBe('@axiom_news');
        expect(body.text).toBe('New update is live\n\nhttps://fanvue.com/post/1\n\n#news #update');
        expect(body.parse_mode).toBe('HTML');
        expect(body.disable_web_page_preview).toBe(false);
    });
    it('falls back to @channel when externalUserId is missing', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, result: { message_id: 7, chat: { id: -100, type: 'channel' } } }));
        vi.stubGlobal('fetch', fetchMock);
        const c = new TelegramConnector({ accessToken: '123:bot-token' });
        await c.publish(input({ hashtags: undefined }));
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.chat_id).toBe('@channel');
        expect(body.text).toBe('New update is live\n\nhttps://fanvue.com/post/1');
    });
    it('returns failed when the API rejects', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ ok: false }, 400)));
        const c = new TelegramConnector(AUTH);
        const result = await c.publish(input());
        expect(result.state).toBe('failed');
        expect(result.error).toContain('400');
    });
    it('returns failed on network errors', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
        const c = new TelegramConnector(AUTH);
        const result = await c.publish(input());
        expect(result.state).toBe('failed');
        expect(result.error).toContain('offline');
    });
});
describe('fetchMetrics', () => {
    it('returns an empty metric set (Bot API has no per-message analytics)', async () => {
        const c = new TelegramConnector(AUTH);
        const metrics = await c.fetchMetrics('42');
        expect(metrics.postId).toBe('42');
        expect(metrics.platform).toBe('telegram');
        expect(metrics.metrics).toEqual({});
    });
});
describe('revoke', () => {
    it('calls logOut and logs the event', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, result: true }));
        vi.stubGlobal('fetch', fetchMock);
        const c = new TelegramConnector(AUTH);
        await c.revoke();
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://api.telegram.org/bot123:bot-token/logOut');
        expect(init.method).toBe('POST');
        expect(c.getLogs().some((l) => l.message === 'Telegram bot logged out')).toBe(true);
    });
});
//# sourceMappingURL=telegram.test.js.map