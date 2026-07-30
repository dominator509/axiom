// ─── Threads Connector ───
// Uses the Threads Publishing API (Meta Graph API v1.0) for publishing,
// metrics, and auth management.
import { BaseConnector } from './base.js';
import { validatePublish } from './validation.js';
const THREADS_GRAPH_BASE = 'https://graph.threads.net/v1.0';
export class ThreadsConnector extends BaseConnector {
    constructor(auth) {
        super('threads', 'Threads', 'api', auth);
    }
    capability() {
        return {
            publish: true,
            media: ['image', 'video'],
            maxMediaBytes: 104_857_600, // 100 MB
            maxMediaCount: 10,
            caption: true,
            maxCaptionLength: 500,
            scheduling: 'native',
            metrics: ['impressions', 'likes', 'comments', 'shares', 'reposts', 'quotes'],
            refreshMetrics: true,
        };
    }
    async validate(input) {
        return validatePublish(input, this.capability());
    }
    async publish(input) {
        return this.idempotentPublish(input, async () => {
            const threadsUserId = this.auth.externalUserId;
            if (!threadsUserId) {
                throw new Error('Threads externalUserId (Threads User ID) is required');
            }
            const accessToken = this.auth.accessToken;
            // Step 1: Create a media container for each URL
            const creationIds = [];
            for (const mediaUrl of input.mediaUrls) {
                const mediaType = this.detectMediaType(mediaUrl);
                const body = {
                    media_type: mediaType === 'video' ? 'VIDEO' : 'IMAGE',
                    text: input.caption,
                    media_url: mediaUrl,
                    access_token: accessToken,
                };
                const createResp = await this.apiPost(`${THREADS_GRAPH_BASE}/${threadsUserId}/threads`, body, { 'Content-Type': 'application/json' });
                creationIds.push(createResp.id);
                this.log('info', 'publish', `Created Threads media container ${createResp.id}`, { mediaUrl, mediaType });
            }
            // Step 2: Publish each container
            let lastRemoteId = null;
            for (const creationId of creationIds) {
                const publishResp = await this.apiPost(`${THREADS_GRAPH_BASE}/${threadsUserId}/threads_publish`, {
                    creation_id: creationId,
                    access_token: accessToken,
                }, { 'Content-Type': 'application/json' });
                lastRemoteId = publishResp.id;
                this.log('info', 'publish', `Published Threads container ${creationId} -> post ${publishResp.id}`);
            }
            const postUrl = lastRemoteId
                ? `https://www.threads.net/@${this.auth.extra?.username ?? 'user'}/post/${lastRemoteId}`
                : undefined;
            return {
                remoteId: lastRemoteId,
                state: 'published',
                postUrl,
            };
        });
    }
    async fetchMetrics(remoteId, _period) {
        const threadsUserId = this.auth.externalUserId;
        if (!threadsUserId) {
            throw new Error('Threads externalUserId is required for metrics');
        }
        const accessToken = this.auth.accessToken;
        const metricsUrl = `${THREADS_GRAPH_BASE}/${threadsUserId}/threads` +
            `?fields=insights.metric(impressions,likes,comments,shares,reposts,quotes)` +
            `&access_token=${accessToken}`;
        const resp = await fetch(metricsUrl);
        if (!resp.ok) {
            const body = await resp.text().catch(() => '');
            throw new Error(`Threads metrics fetch failed: HTTP ${resp.status} — ${body}`);
        }
        const data = (await resp.json());
        const result = {};
        for (const item of data.data) {
            if (item.values && item.values.length > 0) {
                result[item.name] = item.values[0].value;
            }
        }
        return {
            postId: remoteId,
            platform: this.platform,
            collectedAt: new Date().toISOString(),
            metrics: {
                impressions: result['impressions'] ?? 0,
                likes: result['likes'] ?? 0,
                comments: result['comments'] ?? 0,
                shares: result['shares'] ?? 0,
                reposts: result['reposts'] ?? 0,
                quotes: result['quotes'] ?? 0,
            },
            raw: data,
        };
    }
    async revoke() {
        const threadsUserId = this.auth.externalUserId;
        if (!threadsUserId) {
            this.log('warn', 'revoke', 'No externalUserId set; skipping revoke');
            return;
        }
        const accessToken = this.auth.accessToken;
        await this.apiDelete(`${THREADS_GRAPH_BASE}/${threadsUserId}/permissions?access_token=${accessToken}`);
        this.log('info', 'revoke', `Revoked Threads permissions for user ${threadsUserId}`);
    }
    /** Detect media type from URL extension */
    detectMediaType(url) {
        try {
            const pathname = new URL(url).pathname;
            const ext = pathname.split('.').pop()?.toLowerCase() ?? '';
            const videoExts = new Set(['mp4', 'mov', 'webm', 'avi', 'mkv', 'm4v']);
            return videoExts.has(ext) ? 'video' : 'image';
        }
        catch {
            return 'image';
        }
    }
}
export default ThreadsConnector;
//# sourceMappingURL=threads.js.map