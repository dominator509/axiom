// ─── Facebook Connector ───
// Uses the Facebook Graph API v22.0 for publishing, metrics, and app permissions management.
import { BaseConnector } from './base.js';
import { validatePublish } from './validation.js';
const FB_GRAPH_BASE = 'https://graph.facebook.com/v22.0';
export class FacebookConnector extends BaseConnector {
    constructor(auth) {
        super('facebook', 'Facebook', 'api', auth);
    }
    capability() {
        return {
            publish: true,
            media: ['image', 'video', 'story'],
            maxMediaBytes: 4_294_967_296, // 4 GB
            maxMediaCount: 10,
            caption: true,
            maxCaptionLength: 63_206,
            scheduling: 'native',
            metrics: ['impressions', 'likes', 'comments', 'shares'],
            refreshMetrics: true,
        };
    }
    async validate(input) {
        return validatePublish(input, this.capability());
    }
    async publish(input) {
        return this.idempotentPublish(input, async () => {
            const pageId = this.auth.externalUserId;
            if (!pageId) {
                throw new Error('Facebook externalUserId (Page ID) is required');
            }
            const accessToken = this.auth.accessToken;
            const caption = input.caption;
            const mediaUrls = input.mediaUrls;
            const link = input.options?.link;
            // ── Text-only post (with optional link) ──
            if (mediaUrls.length === 0) {
                const body = {
                    message: caption,
                    access_token: accessToken,
                };
                if (link) {
                    body.link = link;
                }
                const feedResp = await this.apiPost(`${FB_GRAPH_BASE}/${pageId}/feed`, body, { 'Content-Type': 'application/json' });
                const remoteId = feedResp.id;
                this.log('info', 'publish', `Facebook feed post published`, { remoteId });
                return {
                    remoteId,
                    state: 'published',
                    postUrl: `https://www.facebook.com/${pageId}/posts/${remoteId}`,
                };
            }
            // ── Media posts ──
            let lastRemoteId = null;
            for (const mediaUrl of mediaUrls) {
                const mediaType = this.detectMediaType(mediaUrl);
                if (mediaType === 'video') {
                    // POST /{page-id}/videos
                    const body = {
                        file_url: mediaUrl,
                        description: caption,
                        access_token: accessToken,
                    };
                    const videoResp = await this.apiPost(`${FB_GRAPH_BASE}/${pageId}/videos`, body, { 'Content-Type': 'application/json' });
                    lastRemoteId = videoResp.id;
                    this.log('info', 'publish', `Facebook video published`, { remoteId: videoResp.id, mediaUrl });
                }
                else if (mediaType === 'story') {
                    // Story upload via /{page-id}/stories
                    const body = {
                        file_url: mediaUrl,
                        access_token: accessToken,
                    };
                    // Stories use the parent page ID as the media owner
                    const storyResp = await this.apiPost(`${FB_GRAPH_BASE}/${pageId}/stories`, body, { 'Content-Type': 'application/json' });
                    lastRemoteId = storyResp.id;
                    this.log('info', 'publish', `Facebook story published`, { remoteId: storyResp.id, mediaUrl });
                }
                else {
                    // POST /{page-id}/photos
                    const body = {
                        url: mediaUrl,
                        caption: caption,
                        access_token: accessToken,
                    };
                    const photoResp = await this.apiPost(`${FB_GRAPH_BASE}/${pageId}/photos`, body, { 'Content-Type': 'application/json' });
                    lastRemoteId = photoResp.post_id ?? photoResp.id;
                    this.log('info', 'publish', `Facebook photo published`, { remoteId: lastRemoteId, mediaUrl });
                }
            }
            const postUrl = lastRemoteId
                ? `https://www.facebook.com/${pageId}/posts/${lastRemoteId}`
                : undefined;
            return {
                remoteId: lastRemoteId,
                state: 'published',
                postUrl,
            };
        });
    }
    async fetchMetrics(remoteId, _period) {
        const pageId = this.auth.externalUserId;
        if (!pageId) {
            throw new Error('Facebook externalUserId (Page ID) is required for metrics');
        }
        const accessToken = this.auth.accessToken;
        // Get insights for the post
        const insightsUrl = `${FB_GRAPH_BASE}/${pageId}_${remoteId}/insights` +
            `?metric=impressions,likes,comments,shares&access_token=${accessToken}`;
        const resp = await fetch(insightsUrl);
        if (!resp.ok) {
            const body = await resp.text().catch(() => '');
            throw new Error(`Facebook metrics fetch failed: HTTP ${resp.status} — ${body}`);
        }
        const insights = (await resp.json());
        const result = {};
        for (const item of insights.data) {
            if (item.values && item.values.length > 0) {
                result[item.name] = item.values[0].value;
            }
        }
        // If the insights endpoint didn't return data, fall back to reading post fields
        let likes = result['likes'] ?? 0;
        let comments = result['comments'] ?? 0;
        let shares = result['shares'] ?? 0;
        let impressions = result['impressions'] ?? 0;
        // Fallback: fetch post reactions/comments counts directly
        if (likes === 0 || comments === 0) {
            try {
                const postUrl = `${FB_GRAPH_BASE}/${pageId}_${remoteId}?fields=likes.summary(true).limit(0),comments.summary(true).limit(0),shares&access_token=${accessToken}`;
                const postResp = await fetch(postUrl);
                if (postResp.ok) {
                    const postData = (await postResp.json());
                    if (postData.likes?.summary?.total_count != null) {
                        likes = postData.likes.summary.total_count;
                    }
                    if (postData.comments?.summary?.total_count != null) {
                        comments = postData.comments.summary.total_count;
                    }
                    if (postData.shares?.count != null) {
                        shares = postData.shares.count;
                    }
                }
            }
            catch {
                // Non-critical — use what we have
            }
        }
        this.log('info', 'fetchMetrics', `Fetched Facebook metrics`, { remoteId, likes, comments, shares, impressions });
        return {
            postId: remoteId,
            platform: this.platform,
            collectedAt: new Date().toISOString(),
            metrics: {
                impressions,
                likes,
                comments,
                shares,
            },
            raw: insights,
        };
    }
    async revoke() {
        const pageId = this.auth.externalUserId;
        if (!pageId) {
            this.log('warn', 'revoke', 'No externalUserId set; skipping revoke');
            return;
        }
        const accessToken = this.auth.accessToken;
        // Revoke: DELETE /{page-id}/permissions removes all app permissions
        const revokeUrl = `${FB_GRAPH_BASE}/${pageId}/permissions?access_token=${encodeURIComponent(accessToken)}`;
        const response = await fetch(revokeUrl, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
            },
        });
        if (!response.ok) {
            const body = await response.text().catch(() => '');
            this.log('warn', 'revoke', `Facebook permissions deletion warned: ${response.status} — ${body}`);
        }
        else {
            const result = (await response.json());
            this.log('info', 'revoke', `Facebook permissions revoked for page ${pageId}`, {
                success: result.success,
            });
        }
        // Also attempt to revoke the user-level token
        try {
            const userTokenRevokeUrl = `${FB_GRAPH_BASE}/me/permissions?access_token=${encodeURIComponent(accessToken)}`;
            const userResp = await fetch(userTokenRevokeUrl, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                },
            });
            if (userResp.ok) {
                this.log('info', 'revoke', 'Facebook user-level permissions also revoked');
            }
        }
        catch {
            // Non-critical
        }
        // Clear cached auth data
        this.auth.accessToken = '';
        this.auth.refreshToken = undefined;
        this.auth.expiresAt = 0;
    }
    /** Detect media type from URL extension */
    detectMediaType(url) {
        try {
            const pathname = new URL(url).pathname;
            const ext = pathname.split('.').pop()?.toLowerCase() ?? '';
            const videoExts = new Set(['mp4', 'mov', 'webm', 'avi', 'mkv', 'm4v']);
            const storyExts = new Set(['heic', 'heif']);
            if (videoExts.has(ext))
                return 'video';
            if (storyExts.has(ext))
                return 'story';
            return 'image';
        }
        catch {
            return 'image';
        }
    }
}
export default FacebookConnector;
//# sourceMappingURL=facebook.js.map