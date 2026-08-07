// ─── Snapchat Connector — Vitest Suite ───
// Covers: capability(), validate() (media + caption-length warning + assisted info),
// publish() assisted relay handoff (always skipped), fetchMetrics(), revoke().
import { describe, it, expect, vi, afterEach } from 'vitest';
import { SnapchatConnector } from './snapchat.js';
const AUTH = { accessToken: 'snap-token' };
function input(overrides = {}) {
    return {
        idempotencyKey: `sk-${Math.random().toString(36).slice(2)}`,
        caption: 'A snap',
        mediaUrls: ['https://cdn.example.com/snap.jpg'],
        ...overrides,
    };
}
function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
afterEach(() => {
    vi.unstubAllGlobals();
});
describe('SnapchatConnector', () => {
    it('declares snapchat capabilities (assisted, no caption, no scheduling)', () => {
        const c = new SnapchatConnector(AUTH);
        expect(c.platform).toBe('snapchat');
        expect(c.publishMode).toBe('assisted');
        const cap = c.capability();
        expect(cap.media).toEqual(['image', 'video', 'story']);
        expect(cap.caption).toBe(false);
        expect(cap.maxCaptionLength).toBe(0);
        expect(cap.scheduling).toBe('none');
        expect(cap.metrics).toEqual(['views', 'impressions']);
        expect(cap.refreshMetrics).toBe(false);
    });
});
describe('validate', () => {
    it('passes a valid input with an info message about assisted publish', async () => {
        const c = new SnapchatConnector(AUTH);
        const report = await c.validate(input());
        expect(report.valid).toBe(true);
        expect(report.infos[0]).toMatchObject({
            field: 'general',
            message: 'Snapchat uses assisted publish — operator must tap to post',
            severity: 'info',
        });
    });
    it('errors when there is no media', async () => {
        const c = new SnapchatConnector(AUTH);
        const report = await c.validate(input({ mediaUrls: [] }));
        expect(report.valid).toBe(false);
        expect(report.errors[0]).toMatchObject({ field: 'mediaUrls', severity: 'error' });
    });
    it('warns when the caption exceeds ~100 chars', async () => {
        const c = new SnapchatConnector(AUTH);
        const report = await c.validate(input({ caption: 'x'.repeat(120) }));
        expect(report.valid).toBe(true);
        expect(report.warnings[0]).toMatchObject({
            field: 'caption',
            message: 'Snapchat captions limited to ~100 chars',
            severity: 'warning',
        });
    });
    it('does not warn for short captions', async () => {
        const c = new SnapchatConnector(AUTH);
        const report = await c.validate(input());
        expect(report.warnings).toEqual([]);
    });
});
describe('publish', () => {
    it('always returns a skipped assisted-publish result without network calls', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const c = new SnapchatConnector(AUTH);
        const result = await c.publish(input());
        expect(result).toMatchObject({
            remoteId: null,
            state: 'skipped',
            error: 'Assisted publish: relay card sent to operator for manual tap',
        });
        expect(result.postUrl).toBeUndefined();
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
describe('fetchMetrics', () => {
    it('fetches views and impressions from the Snap Kit insights endpoint', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ views: 500, impressions: 1200 })));
        const c = new SnapchatConnector(AUTH);
        const metrics = await c.fetchMetrics('snap-1');
        expect(metrics.postId).toBe('snap-1');
        expect(metrics.platform).toBe('snapchat');
        expect(metrics.metrics).toEqual({ views: 500, impressions: 1200 });
        const [url] = vi.mocked(fetch).mock.calls[0];
        expect(url).toBe('https://kit.snapchat.com/v1/media/snap-1/insights');
    });
    it('throws when the insights endpoint fails', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 500)));
        const c = new SnapchatConnector(AUTH);
        await expect(c.fetchMetrics('snap-1')).rejects.toThrow('API GET');
    });
});
describe('revoke', () => {
    it('deletes the OAuth grant and logs the event', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true }));
        vi.stubGlobal('fetch', fetchMock);
        const c = new SnapchatConnector(AUTH);
        await c.revoke();
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://kit.snapchat.com/v1/oauth/revoke');
        expect(init.method).toBe('DELETE');
        expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
        expect(c.getLogs().some((l) => l.message === 'Snapchat access revoked')).toBe(true);
    });
});
//# sourceMappingURL=snapchat.test.js.map