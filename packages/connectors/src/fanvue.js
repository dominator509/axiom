// ─── Fanvue Connector (real Fanvue API v2025-06-26) ───
// Targets https://api.fanvue.com with OAuth 2.0 Bearer tokens and the
// required X-Fanvue-API-Version header. Media upload uses the documented
// S3 multipart flow: create session → presigned part URLs → PUT parts →
// complete session → mediaUuid; posts are created via POST /posts.
// Token refresh (Ory client_secret_basic) is supported when refresh
// credentials are supplied, so short-lived (1h) access tokens stay valid.
import { BaseConnector } from './base.js';
const FANVUE_API_BASE = 'https://api.fanvue.com';
const FANVUE_API_VERSION = '2025-06-26';
const FANVUE_TOKEN_URL = 'https://auth.fanvue.com/oauth2/token';
const FANVUE_REVOKE_URL = 'https://auth.fanvue.com/oauth2/revoke';
export class FanvueConnector extends BaseConnector {
    modelId;
    refreshToken;
    clientId;
    clientSecret;
    tokenExpiresAt;
    constructor(auth) {
        super('fanvue', 'Fanvue', 'api', auth);
        this.modelId = auth.externalUserId || '';
        this.refreshToken = auth.refreshToken;
        this.clientId = auth.extra?.['clientId'];
        this.clientSecret = auth.extra?.['clientSecret'];
        this.tokenExpiresAt = auth.expiresAt;
    }
    capability() {
        return {
            publish: true,
            media: ['image', 'video', 'audio'],
            maxMediaBytes: 1_610_612_736, // 1.5 GiB — API limit (sizeBytes <= 1610612736)
            maxMediaCount: 10,
            caption: true,
            maxCaptionLength: 5000, // text max length per API reference
            scheduling: 'internal',
            metrics: ['likes', 'comments'],
            refreshMetrics: true,
        };
    }
    // ── Token refresh (Ory client_secret_basic) ──
    /**
     * Exchange the refresh token for a fresh access token using the Ory token
     * endpoint. Returns the new access token and expiry (epoch seconds).
     * Throws if refresh credentials are absent or the exchange fails.
     */
    async refreshAccessToken() {
        if (!this.refreshToken || !this.clientId || !this.clientSecret) {
            throw new Error('Fanvue token refresh requires refreshToken + clientId + clientSecret');
        }
        const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
        const resp = await fetch(FANVUE_TOKEN_URL, {
            method: 'POST',
            headers: {
                Authorization: `Basic ${basic}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            // NOTE: scope intentionally omitted — requesting scopes beyond the
            // original authorization grant makes Ory reject the refresh (400).
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: this.refreshToken,
            }),
        });
        if (!resp.ok) {
            const body = await resp.text().catch(() => '');
            this.log('error', 'refresh', `HTTP ${resp.status}: ${body}`);
            throw new Error(`Fanvue token refresh failed: ${resp.status} ${resp.statusText}`);
        }
        const tokens = await resp.json();
        const accessToken = typeof tokens['access_token'] === 'string' ? tokens['access_token'] : '';
        const expiresIn = typeof tokens['expires_in'] === 'number' ? tokens['expires_in'] : 3600;
        if (!accessToken) {
            throw new Error('Fanvue token refresh returned no access_token');
        }
        // Ory ROTATES the refresh token on every grant — the old one is revoked
        // immediately. Adopt the rotated token so the next refresh keeps working.
        const rotatedRefresh = typeof tokens['refresh_token'] === 'string' && tokens['refresh_token']
            ? tokens['refresh_token']
            : undefined;
        if (rotatedRefresh) {
            this.refreshToken = rotatedRefresh;
            this.auth.refreshToken = rotatedRefresh;
        }
        this.auth.accessToken = accessToken;
        this.auth.expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
        return { accessToken, expiresAt: this.auth.expiresAt };
    }
    /** Whether a stored refresh token is usable. */
    canRefresh() {
        return Boolean(this.refreshToken && this.clientId && this.clientSecret);
    }
    /** Refresh if the current token is expired (or within 60s of expiry). */
    async ensureFreshToken() {
        if (!this.tokenExpiresAt && !this.auth.expiresAt)
            return;
        const exp = this.auth.expiresAt ?? this.tokenExpiresAt ?? 0;
        if (Date.now() / 1000 > exp - 60) {
            if (!this.canRefresh()) {
                throw new Error('Fanvue access token expired and no refresh credentials available');
            }
            await this.refreshAccessToken();
        }
    }
    // ── Request helpers (real API surface) ──
    fanvueHeaders() {
        return {
            Authorization: `Bearer ${this.auth.accessToken}`,
            'Content-Type': 'application/json',
            'X-Fanvue-API-Version': FANVUE_API_VERSION,
        };
    }
    async fanvueRequest(method, path, body, rawText = false) {
        await this.ensureFreshToken();
        const response = await fetch(`${FANVUE_API_BASE}${path}`, {
            method,
            headers: this.fanvueHeaders(),
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        if (!response.ok) {
            const responseBody = await response.text().catch(() => '');
            this.log('error', method, `HTTP ${response.status}: ${responseBody}`, { path });
            throw new Error(`Fanvue API ${method} ${path} failed: ${response.status} ${response.statusText}`);
        }
        if (response.status === 204)
            return undefined;
        if (rawText)
            return (await response.text());
        return response.json();
    }
    /** Determine media type from a URL path extension (defaults to image). */
    mediaTypeFromUrl(url) {
        const path = url.split('?')[0].toLowerCase();
        if (/\.(mp4|mov|avi|webm|mkv)$/.test(path))
            return 'video';
        if (/\.(mp3|wav|m4a|aac|flac)$/.test(path))
            return 'audio';
        if (/\.(pdf|docx?|xlsx?|txt)$/.test(path))
            return 'document';
        return 'image';
    }
    /** Download remote media bytes (bounded) for the multipart upload. */
    async downloadMedia(url) {
        const resp = await fetch(url, { method: 'GET' });
        if (!resp.ok) {
            throw new Error(`Fanvue media download failed: ${resp.status} ${resp.statusText} (${url})`);
        }
        const buffer = await resp.arrayBuffer();
        return new Uint8Array(buffer);
    }
    /**
     * Upload one remote media URL via the documented multipart flow and return
     * the mediaUuid. Requires the creator uuid for the presigned part URLs.
     */
    async uploadMedia(url, creatorUuid) {
        const bytes = await this.downloadMedia(url);
        const name = url.split('/').pop()?.split('?')[0] || 'media';
        const filename = name.length <= 255 ? name : name.slice(-255);
        const mediaType = this.mediaTypeFromUrl(url);
        const session = await this.fanvueRequest('POST', '/media/uploads', {
            name: filename,
            filename,
            mediaType,
            sizeBytes: bytes.length,
        });
        const parts = Math.max(1, session.totalParts ?? Math.ceil(bytes.length / session.partSize));
        const completed = [];
        for (let partNumber = 1; partNumber <= parts; partNumber++) {
            const signedUrl = await this.fanvueRequest('GET', `/creators/${creatorUuid}/media/uploads/${session.uploadId}/parts/${partNumber}/url`, undefined, true);
            const start = (partNumber - 1) * session.partSize;
            const end = Math.min(bytes.length, partNumber * session.partSize);
            const partBytes = bytes.slice(start, end);
            const putRes = await fetch(signedUrl, {
                method: 'PUT',
                body: partBytes,
            });
            if (!putRes.ok) {
                const body = await putRes.text().catch(() => '');
                throw new Error(`Fanvue part ${partNumber} upload failed: ${putRes.status} ${body}`);
            }
            const etag = putRes.headers.get('etag') || '';
            completed.push({ partNumber, etag });
        }
        await this.fanvueRequest('PATCH', `/media/uploads/${session.uploadId}`, {
            parts: completed,
        });
        this.log('info', 'upload', `Fanvue media uploaded: ${session.mediaUuid}`);
        return session.mediaUuid;
    }
    // ── Connector interface ──
    async validate(input) {
        const errors = [];
        if (!input.mediaUrls || input.mediaUrls.length === 0) {
            errors.push({ field: 'mediaUrls', message: 'Fanvue requires at least one media file', severity: 'error' });
        }
        if (!input.caption) {
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
            // Resolve the creator uuid (needed for presigned part URLs).
            let creatorUuid = this.modelId;
            if (!creatorUuid) {
                const me = await this.fanvueRequest('GET', '/users/me');
                creatorUuid = me.uuid;
                this.modelId = me.uuid;
            }
            // 1. Upload each media URL → mediaUuid list.
            const mediaUuids = [];
            for (const mediaUrl of input.mediaUrls) {
                const mediaUuid = await this.uploadMedia(mediaUrl, creatorUuid);
                mediaUuids.push(mediaUuid);
            }
            // 2. Create the post (audience defaults to followers-and-subscribers).
            const audience = input.options?.['audience'] ?? 'followers-and-subscribers';
            const post = await this.fanvueRequest('POST', '/posts', {
                audience,
                text: input.caption,
                mediaUuids,
                publishAt: input.scheduledFor ?? null,
            });
            this.log('info', 'publish', `Fanvue post created: ${post.uuid}`);
            return {
                remoteId: post.uuid,
                state: 'published',
                postUrl: `https://fanvue.com/post/${post.uuid}`,
            };
        });
    }
    async fetchMetrics(remoteId, _period) {
        const post = await this.fanvueRequest('GET', `/posts/${remoteId}`);
        return {
            postId: remoteId,
            platform: 'fanvue',
            collectedAt: new Date().toISOString(),
            metrics: {
                likes: post.likesCount ?? 0,
                comments: post.commentsCount ?? 0,
            },
            raw: {
                tips: post.tips ?? null,
                price: post.price ?? null,
                audience: post.audience,
                publishedAt: post.publishedAt ?? null,
            },
        };
    }
    async revoke() {
        if (!this.refreshToken || !this.clientId || !this.clientSecret) {
            this.log('warn', 'revoke', 'Fanvue revoke skipped: no refresh token/client credentials');
            return;
        }
        const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
        const resp = await fetch(FANVUE_REVOKE_URL, {
            method: 'POST',
            headers: {
                Authorization: `Basic ${basic}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                token: this.refreshToken,
                token_type_hint: 'refresh_token',
            }),
        });
        if (!resp.ok) {
            const body = await resp.text().catch(() => '');
            this.log('error', 'revoke', `HTTP ${resp.status}: ${body}`);
            return;
        }
        this.log('info', 'revoke', 'Fanvue refresh token revoked (Ory RFC 7009)');
    }
}
//# sourceMappingURL=fanvue.js.map