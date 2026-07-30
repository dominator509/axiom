// ─── Instagram Connector ───
// Uses the Instagram Graph API for publishing, metrics, and auth management.
import { BaseConnector } from './base.js';
import { validatePublish } from './validation.js';
const IG_GRAPH_BASE = 'https://graph.facebook.com/v22.0';
export class InstagramConnector extends BaseConnector {
    constructor(auth) {
        super('instagram', 'Instagram', 'api', auth);
    }
    capability() {
        return {
            publish: true,
            media: ['image', 'video', 'carousel', 'story'],
            maxMediaBytes: 104_857_600, // 100 MB
            maxMediaCount: 10,
            caption: true,
            maxCaptionLength: 2_200,
            scheduling: 'native',
            metrics: ['impressions', 'likes', 'comments', 'shares', 'saves'],
            refreshMetrics: true,
        };
    }
    async validate(input) {
        return validatePublish(input, this.capability());
    }
    async publish(input) {
        return this.idempotentPublish(input, async () => {
            const igUserId = this.auth.externalUserId;
            if (!igUserId) {
                throw new Error('Instagram externalUserId (IG Business Account ID) is required');
            }
            const accessToken = this.auth.accessToken;
            // Step 1: Create media containers for each media URL
            const creationIds = [];
            for (const mediaUrl of input.mediaUrls) {
                const mediaType = this.detectMediaType(mediaUrl);
                const body = {
                    image_url: mediaUrl,
                    caption: input.caption,
                    access_token: accessToken,
                };
                if (mediaType === 'video') {
                    body.media_type = 'VIDEO';
                    body.video_url = mediaUrl;
                    delete body.image_url;
                }
                const createResp = await this.apiPost(`${IG_GRAPH_BASE}/${igUserId}/media`, body, { 'Content-Type': 'application/json' });
                creationIds.push(createResp.id);
                this.log('info', 'publish', `Created media container ${createResp.id}`, { mediaUrl, mediaType });
            }
            // Step 2: Publish each container
            let lastRemoteId = null;
            for (const creationId of creationIds) {
                const publishResp = await this.apiPost(`${IG_GRAPH_BASE}/${igUserId}/media_publish`, {
                    creation_id: creationId,
                    access_token: accessToken,
                }, { 'Content-Type': 'application/json' });
                lastRemoteId = publishResp.id;
                this.log('info', 'publish', `Published container ${creationId} -> post ${publishResp.id}`);
            }
            const postUrl = lastRemoteId
                ? `https://www.instagram.com/p/${lastRemoteId}/`
                : undefined;
            return {
                remoteId: lastRemoteId,
                state: 'published',
                postUrl,
            };
        });
    }
    async fetchMetrics(remoteId, _period) {
        const igUserId = this.auth.externalUserId;
        if (!igUserId) {
            throw new Error('Instagram externalUserId is required for metrics');
        }
        const accessToken = this.auth.accessToken;
        const metrics = await this.apiGet(`${IG_GRAPH_BASE}/${igUserId}/media/${remoteId}/insights` +
            `?metric=impressions,likes,comments,shares,saves` +
            `&access_token=${accessToken}`);
        const result = {};
        for (const item of metrics.data) {
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
                saves: result['saves'] ?? 0,
            },
            raw: metrics,
        };
    }
    async revoke() {
        const igUserId = this.auth.externalUserId;
        if (!igUserId) {
            this.log('warn', 'revoke', 'No externalUserId set; skipping revoke');
            return;
        }
        const accessToken = this.auth.accessToken;
        await this.apiDelete(`${IG_GRAPH_BASE}/${igUserId}/permissions?delegation&access_token=${accessToken}`);
        this.log('info', 'revoke', `Revoked Instagram permissions for user ${igUserId}`);
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
export default InstagramConnector;
//# sourceMappingURL=instagram.js.map