// ─── X (Twitter) Connector ───
// Uses the Twitter API v2 for publishing, metrics, and OAuth 2.0 management.
import { BaseConnector } from './base.js';
import { validatePublish } from './validation.js';
const TWITTER_UPLOAD_BASE = 'https://upload.twitter.com/1.1';
const TWITTER_API_BASE = 'https://api.twitter.com/2';
const TWITTER_OAUTH_REVOKE = 'https://api.twitter.com/2/oauth2/revoke';
export class XConnector extends BaseConnector {
    constructor(auth) {
        super('x', 'X (Twitter)', 'api', auth);
    }
    capability() {
        return {
            publish: true,
            media: ['image', 'video'],
            maxMediaBytes: 536_870_912, // 512 MB
            maxMediaCount: 4,
            caption: true,
            maxCaptionLength: 4_000,
            scheduling: 'internal',
            metrics: ['likes', 'comments', 'shares', 'impressions', 'reposts', 'quotes'],
            refreshMetrics: true,
        };
    }
    async validate(input) {
        return validatePublish(input, this.capability());
    }
    async publish(input) {
        return this.idempotentPublish(input, async () => {
            const mediaIds = [];
            // Step 1: Upload each media file via chunked upload (INIT → APPEND → FINALIZE)
            for (const mediaUrl of input.mediaUrls) {
                const mediaId = await this.uploadMedia(mediaUrl);
                mediaIds.push(mediaId);
                this.log('info', 'publish', `Media uploaded to X`, { mediaUrl, mediaId });
            }
            // Step 2: Create tweet with media_ids
            const body = {
                text: input.caption,
            };
            if (mediaIds.length > 0) {
                body.media = { media_ids: mediaIds };
            }
            const tweetResp = await this.apiPost(`${TWITTER_API_BASE}/tweets`, body, {
                Authorization: `Bearer ${this.auth.accessToken}`,
                'Content-Type': 'application/json',
            });
            const remoteId = tweetResp.data.id;
            this.log('info', 'publish', `Tweet published`, { remoteId });
            const postUrl = `https://x.com/i/web/status/${remoteId}`;
            return {
                remoteId,
                state: 'published',
                postUrl,
            };
        });
    }
    async fetchMetrics(remoteId, _period) {
        const url = `${TWITTER_API_BASE}/tweets/${remoteId}?tweet.fields=public_metrics`;
        const resp = await fetch(url, {
            headers: {
                Authorization: `Bearer ${this.auth.accessToken}`,
            },
        });
        if (!resp.ok) {
            const body = await resp.text().catch(() => '');
            throw new Error(`X metrics fetch failed: HTTP ${resp.status} — ${body}`);
        }
        const data = (await resp.json());
        if (!data.data) {
            throw new Error(`X tweet ${remoteId} not found`);
        }
        const m = data.data.public_metrics ?? {};
        return {
            postId: remoteId,
            platform: this.platform,
            collectedAt: new Date().toISOString(),
            metrics: {
                likes: m.like_count ?? 0,
                comments: m.reply_count ?? 0,
                shares: m.retweet_count ?? 0,
                impressions: m.impression_count ?? 0,
                reposts: m.retweet_count ?? 0,
                quotes: m.quote_count ?? 0,
            },
            raw: data.data,
        };
    }
    async revoke() {
        // Revoke OAuth 2.0 token
        const clientId = this.auth.extra?.clientId ?? '';
        const params = new URLSearchParams({
            token: this.auth.accessToken,
            token_type_hint: 'access_token',
        });
        if (clientId) {
            params.append('client_id', clientId);
        }
        const response = await fetch(TWITTER_OAUTH_REVOKE, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: params.toString(),
        });
        if (response.ok) {
            const result = (await response.json());
            this.log('info', 'revoke', `X OAuth 2.0 token revoked`, { revoked: result.revoked });
        }
        else {
            const body = await response.text().catch(() => '');
            this.log('warn', 'revoke', `X token revocation warned: ${response.status} — ${body}`);
        }
        // Clear cached auth data
        this.auth.accessToken = '';
        this.auth.refreshToken = undefined;
        this.auth.expiresAt = 0;
    }
    /**
     * Upload a single media file to X using the chunked upload API.
     * Downloads the media from the provided URL first, then performs
     * INIT → APPEND → FINALIZE.
     */
    async uploadMedia(mediaUrl) {
        // Download the media file
        const mediaResponse = await fetch(mediaUrl);
        if (!mediaResponse.ok) {
            throw new Error(`Failed to download media from ${mediaUrl}: ${mediaResponse.status}`);
        }
        const mediaBuffer = await mediaResponse.arrayBuffer();
        const totalBytes = mediaBuffer.byteLength;
        const contentType = mediaResponse.headers.get('content-type') ?? 'application/octet-stream';
        // Detect media type for the upload
        const mediaType = contentType.startsWith('video/') ? 'video/mp4' : 'image/jpeg';
        // STEP 1: INIT — allocate a media ID
        const initFormData = new FormData();
        initFormData.append('command', 'INIT');
        initFormData.append('media_type', mediaType);
        initFormData.append('total_bytes', String(totalBytes));
        const initResp = await fetch(`${TWITTER_UPLOAD_BASE}/media/upload.json`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${this.auth.accessToken}`,
            },
            body: initFormData,
        });
        if (!initResp.ok) {
            const initBody = await initResp.text().catch(() => '');
            throw new Error(`X media INIT failed: HTTP ${initResp.status} — ${initBody}`);
        }
        const initData = (await initResp.json());
        const mediaId = initData.media_id_string;
        this.log('info', 'uploadMedia', `Media INIT complete`, { mediaId, totalBytes });
        // STEP 2: APPEND — upload the file in chunks
        const chunkSize = 5 * 1024 * 1024; // 5 MB chunks
        let segmentIndex = 0;
        for (let offset = 0; offset < totalBytes; offset += chunkSize) {
            const end = Math.min(offset + chunkSize, totalBytes);
            const chunk = Buffer.from(mediaBuffer.slice(offset, end));
            const appendFormData = new FormData();
            appendFormData.append('command', 'APPEND');
            appendFormData.append('media_id', mediaId);
            appendFormData.append('segment_index', String(segmentIndex));
            appendFormData.append('media', new Blob([chunk], { type: contentType }));
            const appendResp = await fetch(`${TWITTER_UPLOAD_BASE}/media/upload.json`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${this.auth.accessToken}`,
                },
                body: appendFormData,
            });
            if (!appendResp.ok) {
                const appendBody = await appendResp.text().catch(() => '');
                throw new Error(`X media APPEND failed at segment ${segmentIndex}: HTTP ${appendResp.status} — ${appendBody}`);
            }
            segmentIndex++;
        }
        this.log('info', 'uploadMedia', `Media APPEND complete`, { mediaId, segments: segmentIndex });
        // STEP 3: FINALIZE — complete the upload
        const finalizeFormData = new FormData();
        finalizeFormData.append('command', 'FINALIZE');
        finalizeFormData.append('media_id', mediaId);
        const finalizeResp = await fetch(`${TWITTER_UPLOAD_BASE}/media/upload.json`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${this.auth.accessToken}`,
            },
            body: finalizeFormData,
        });
        if (!finalizeResp.ok) {
            const finalizeBody = await finalizeResp.text().catch(() => '');
            throw new Error(`X media FINALIZE failed: HTTP ${finalizeResp.status} — ${finalizeBody}`);
        }
        const finalizeData = (await finalizeResp.json());
        // For videos, wait for processing to complete
        if (mediaType.startsWith('video/') && finalizeData.processing_state === 'pending') {
            await this.pollMediaProcessing(mediaId);
        }
        this.log('info', 'uploadMedia', `Media FINALIZE complete`, { mediaId });
        return mediaId;
    }
    /**
     * Poll media processing status for videos.
     */
    async pollMediaProcessing(mediaId) {
        const maxAttempts = 30;
        const pollIntervalMs = 2_000;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
            const statusResp = await fetch(`${TWITTER_UPLOAD_BASE}/media/upload.json?command=STATUS&media_id=${mediaId}`, {
                headers: {
                    Authorization: `Bearer ${this.auth.accessToken}`,
                },
            });
            if (!statusResp.ok) {
                this.log('warn', 'pollMediaProcessing', `Status check failed on attempt ${attempt}`);
                continue;
            }
            const statusData = (await statusResp.json());
            const info = statusData.processing_info;
            if (!info) {
                // No processing info means processing is complete
                return;
            }
            if (info.state === 'succeeded') {
                return;
            }
            if (info.state === 'failed') {
                throw new Error(`X media processing failed: ${info.error?.message ?? 'Unknown error'}`);
            }
            this.log('info', 'pollMediaProcessing', `Media processing ${info.state}`, {
                mediaId,
                progress: info.progress_percent,
            });
        }
        throw new Error(`X media processing timed out for media_id ${mediaId}`);
    }
}
export default XConnector;
//# sourceMappingURL=x.js.map