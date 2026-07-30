// ─── TikTok Connector ───
// Uses the TikTok Content Posting API v2 for uploads, metrics, and OAuth management.
import { BaseConnector } from './base.js';
import { validatePublish } from './validation.js';
const TIKTOK_API_BASE = 'https://open.tiktokapis.com/v2';
export class TikTokConnector extends BaseConnector {
    constructor(auth) {
        super('tiktok', 'TikTok', 'api', auth);
    }
    capability() {
        return {
            publish: true,
            media: ['video', 'short'],
            maxMediaBytes: 524_288_000, // 500 MB
            maxMediaCount: 1,
            caption: true,
            maxCaptionLength: 2_200,
            scheduling: 'internal',
            metrics: ['views', 'likes', 'comments', 'shares', 'follows'],
            refreshMetrics: true,
        };
    }
    async validate(input) {
        return validatePublish(input, this.capability());
    }
    async publish(input) {
        return this.idempotentPublish(input, async () => {
            const videoUrl = input.mediaUrls[0];
            if (!videoUrl) {
                throw new Error('TikTok requires at least one video URL');
            }
            // Step 1: Initialize the video upload
            const initPayload = {
                source_info: {
                    source: 'FILE_UPLOAD',
                    video_size: input.options?.videoSize ?? 0,
                    chunk_size: input.options?.chunkSize ?? 0,
                    total_chunk_count: input.options?.totalChunkCount ?? 1,
                },
            };
            const initResp = await this.apiPost(`${TIKTOK_API_BASE}/post/publish/video/init/`, initPayload, {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.auth.accessToken}`,
            });
            if (initResp.error) {
                throw new Error(`TikTok init failed: ${initResp.error.code} — ${initResp.error.message}`);
            }
            const { publish_id, upload_url } = initResp.data;
            this.log('info', 'publish', `TikTok video init complete`, { publish_id });
            // Step 2: Download the video from the source URL and upload to TikTok
            const videoResponse = await fetch(videoUrl);
            if (!videoResponse.ok) {
                throw new Error(`Failed to download video from ${videoUrl}: ${videoResponse.status}`);
            }
            const videoBuffer = await videoResponse.arrayBuffer();
            const uploadResp = await fetch(upload_url, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'video/mp4',
                    'Content-Length': String(videoBuffer.byteLength),
                },
                body: videoBuffer,
            });
            if (!uploadResp.ok) {
                const uploadBody = await uploadResp.text().catch(() => '');
                throw new Error(`TikTok video upload failed: ${uploadResp.status} ${uploadResp.statusText} — ${uploadBody}`);
            }
            this.log('info', 'publish', `TikTok video uploaded (${videoBuffer.byteLength} bytes)`);
            // Step 3: Complete the publish
            const completePayload = {
                publish_id,
                post_info: {
                    title: input.caption,
                    privacy_level: input.options?.privacyLevel ?? 'PUBLIC_TO_EVERYONE',
                    disable_duet: input.options?.disableDuet ?? false,
                    disable_stitch: input.options?.disableStitch ?? false,
                    disable_comment: input.options?.disableComment ?? false,
                    brand_organic_use: input.options?.brandOrganicUse ?? false,
                    brand_content: input.options?.brandContent ?? false,
                },
            };
            const completeResp = await this.apiPost(`${TIKTOK_API_BASE}/post/publish/video/complete/`, completePayload, {
                Authorization: `Bearer ${this.auth.accessToken}`,
                'Content-Type': 'application/json',
            });
            if (completeResp.error) {
                throw new Error(`TikTok complete failed: ${completeResp.error.code} — ${completeResp.error.message}`);
            }
            this.log('info', 'publish', `TikTok video published`, { publish_id: completeResp.data.publish_id });
            const postUrl = `https://www.tiktok.com/@${this.auth.extra?.username ?? 'user'}/video/${completeResp.data.publish_id}`;
            return {
                remoteId: completeResp.data.publish_id,
                state: 'published',
                postUrl,
            };
        });
    }
    async fetchMetrics(remoteId, _period) {
        const queryUrl = `${TIKTOK_API_BASE}/video/query/?fields=statistics&id=${remoteId}`;
        const resp = await this.apiGet(queryUrl, {
            Authorization: `Bearer ${this.auth.accessToken}`,
        });
        if (resp.error) {
            throw new Error(`TikTok metrics fetch failed: ${resp.error.code} — ${resp.error.message}`);
        }
        const video = resp.data.videos?.[0];
        if (!video) {
            throw new Error(`TikTok video ${remoteId} not found`);
        }
        const stats = video.statistics;
        return {
            postId: remoteId,
            platform: this.platform,
            collectedAt: new Date().toISOString(),
            metrics: {
                views: stats.view_count ?? 0,
                likes: stats.like_count ?? 0,
                comments: stats.comment_count ?? 0,
                shares: stats.share_count ?? 0,
                follows: 0, // TikTok's video-level API does not expose follower gains per video
            },
            raw: { statistics: stats },
        };
    }
    async revoke() {
        // TikTok does not have a server-side token revocation endpoint.
        // Disconnection is handled client-side by discarding the stored OAuth tokens.
        const openId = this.auth.externalUserId ?? 'unknown';
        // Attempt to call the user info endpoint as a liveness check,
        // then disconnect by clearing token representation on our side.
        try {
            const resp = await this.apiGet(`${TIKTOK_API_BASE}/user/info/?fields=open_id`, {
                Authorization: `Bearer ${this.auth.accessToken}`,
            });
            if (resp.data?.user?.open_id) {
                this.log('info', 'revoke', `Verified TikTok user ${openId} before disconnect`);
            }
        }
        catch {
            // Token may already be expired — still proceed with logical disconnect
            this.log('warn', 'revoke', `Could not verify TikTok user ${openId}; proceeding with disconnect`);
        }
        this.log('info', 'revoke', `TikTok OAuth disconnected for user ${openId}`);
    }
}
export default TikTokConnector;
//# sourceMappingURL=tiktok.js.map