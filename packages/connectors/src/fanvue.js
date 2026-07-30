// ─── Fanvue MCP Connector ───
// Connects to Fanvue's MCP endpoint for uploads, posting, and analytics
import { BaseConnector } from './base.js';
const FANVUE_MCP_BASE = 'https://mcp.fanvue.com/v1';
export class FanvueConnector extends BaseConnector {
    modelId;
    constructor(auth) {
        super('fanvue', 'Fanvue', 'api', auth);
        this.modelId = auth.externalUserId || '';
    }
    capability() {
        return {
            publish: true,
            media: ['image', 'video'],
            maxMediaBytes: 200_000_000, // 200 MB
            maxMediaCount: 10,
            caption: true,
            maxCaptionLength: 2200,
            scheduling: 'internal',
            metrics: ['views', 'likes', 'comments'],
            refreshMetrics: true,
        };
    }
    async validate(input) {
        const errors = [];
        if (!input.mediaUrls || input.mediaUrls.length === 0) {
            errors.push({ field: 'mediaUrls', message: 'Fanvue requires at least one media file', severity: 'error' });
        }
        if (!input.caption && input.caption === '') {
            errors.push({ field: 'caption', message: 'Fanvue posts require a caption', severity: 'error' });
        }
        return {
            valid: errors.length === 0,
            errors,
            warnings: [],
            infos: [],
            tosVerdict: 'pass',
        };
    }
    async publish(input) {
        return this.idempotentPublish(input, async () => {
            // 1. Upload media to Fanvue
            const mediaIds = [];
            for (const mediaUrl of input.mediaUrls) {
                const uploadRes = await this.apiPost(`${FANVUE_MCP_BASE}/upload`, { url: mediaUrl, model_id: this.modelId });
                mediaIds.push(uploadRes.id);
            }
            // 2. Create post with uploaded media
            const postRes = await this.apiPost(`${FANVUE_MCP_BASE}/posts`, {
                model_id: this.modelId,
                media_ids: mediaIds,
                caption: input.caption,
                hashtags: input.hashtags || [],
                scheduled_for: input.scheduledFor || null,
            });
            this.log('info', 'publish', `Fanvue post created: ${postRes.id}`);
            return {
                remoteId: postRes.id,
                state: 'published',
                postUrl: postRes.url,
            };
        });
    }
    async fetchMetrics(remoteId, _period) {
        const data = await this.apiGet(`${FANVUE_MCP_BASE}/analytics/posts/${remoteId}`);
        return {
            postId: remoteId,
            platform: 'fanvue',
            collectedAt: new Date().toISOString(),
            metrics: {
                views: data.views,
                likes: data.likes,
                comments: data.comments,
            },
        };
    }
    async revoke() {
        await this.apiPost(`${FANVUE_MCP_BASE}/auth/revoke`, { model_id: this.modelId });
        this.log('info', 'revoke', 'Fanvue MCP access revoked');
    }
}
//# sourceMappingURL=fanvue.js.map