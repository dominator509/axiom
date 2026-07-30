// ─── Snapchat Connector (assisted publish) ───
// Snapchat has no open publish API → uses Relay hand-off (assisted mode)
import { BaseConnector } from './base.js';
const SNAP_BASE = 'https://kit.snapchat.com/v1';
export class SnapchatConnector extends BaseConnector {
    constructor(auth) {
        super('snapchat', 'Snapchat', 'assisted', auth);
    }
    capability() {
        return {
            publish: true,
            media: ['image', 'video', 'story'],
            maxMediaBytes: 32_000_000,
            maxMediaCount: 10,
            caption: false,
            maxCaptionLength: 0,
            scheduling: 'none',
            metrics: ['views', 'impressions'],
            refreshMetrics: false,
        };
    }
    async validate(input) {
        const errors = [];
        const warnings = [];
        if (!input.mediaUrls || input.mediaUrls.length === 0) {
            errors.push({ field: 'mediaUrls', message: 'Snapchat requires at least one media', severity: 'error' });
        }
        if (input.caption && input.caption.length > 100) {
            warnings.push({ field: 'caption', message: 'Snapchat captions limited to ~100 chars', severity: 'warning' });
        }
        return {
            valid: errors.length === 0,
            errors,
            warnings,
            infos: [{ field: 'general', message: 'Snapchat uses assisted publish — operator must tap to post', severity: 'info' }],
            tosVerdict: 'pass',
        };
    }
    async publish(input) {
        return this.idempotentPublish(input, async () => {
            this.log('info', 'publish', `Snapchat assisted publish: relay card needed`);
            return {
                remoteId: null,
                state: 'skipped',
                error: 'Assisted publish: relay card sent to operator for manual tap',
                postUrl: undefined,
            };
        });
    }
    async fetchMetrics(remoteId, _period) {
        const metrics = await this.apiGet(`${SNAP_BASE}/media/${remoteId}/insights`);
        return {
            postId: remoteId,
            platform: 'snapchat',
            collectedAt: new Date().toISOString(),
            metrics: { views: metrics.views, impressions: metrics.impressions },
        };
    }
    async revoke() {
        await this.apiDelete(`${SNAP_BASE}/oauth/revoke`, {
            'Content-Type': 'application/x-www-form-urlencoded',
        });
        this.log('info', 'revoke', 'Snapchat access revoked');
    }
}
//# sourceMappingURL=snapchat.js.map