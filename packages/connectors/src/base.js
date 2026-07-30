// ─── BaseConnector Abstract Class ───
/**
 * In-memory idempotency ledger (would be backed by DB in production).
 * Maps `${platform}:${idempotencyKey}` -> IdempotencyEntry.
 */
const idempotencyLedger = new Map();
/** Default metric names available to all platforms */
export const COMMON_METRICS = [
    'likes', 'comments', 'shares', 'views', 'impressions',
];
/** Maximum log entries kept per connector */
const MAX_LOG = 100;
/**
 * Abstract base class for all SocialConnector implementations.
 * Provides idempotency checking, logging wrapper, and error handling patterns.
 */
export class BaseConnector {
    platform;
    displayName;
    publishMode;
    auth;
    logHistory = [];
    constructor(platform, displayName, publishMode, auth) {
        this.platform = platform;
        this.displayName = displayName;
        this.publishMode = publishMode;
        this.auth = auth;
    }
    // ── Idempotency ──
    /**
     * Check the idempotency ledger before publishing.
     * Returns existing entry if already published/skipped, null if fresh.
     */
    checkIdempotency(key) {
        const entry = idempotencyLedger.get(`${this.platform}:${key}`);
        return entry;
    }
    /**
     * Record result in the idempotency ledger.
     */
    recordIdempotency(key, remoteId, state) {
        idempotencyLedger.set(`${this.platform}:${key}`, {
            idempotencyKey: key,
            platform: this.platform,
            remoteId,
            state,
            completedAt: new Date().toISOString(),
        });
    }
    /**
     * Idempotent publish wrapper. If already published (by idempotencyKey),
     * returns the previous result. Otherwise calls doPublish.
     */
    async idempotentPublish(input, doPublish) {
        const existing = this.checkIdempotency(input.idempotencyKey);
        if (existing) {
            if (existing.state === 'published') {
                this.log('info', 'publish', `Skipping already-published post ${input.idempotencyKey}`);
                return {
                    remoteId: existing.remoteId,
                    state: 'skipped',
                    error: undefined,
                };
            }
            if (existing.state === 'skipped') {
                this.log('info', 'publish', `Skipping previously-skipped post ${input.idempotencyKey}`);
                return {
                    remoteId: null,
                    state: 'skipped',
                    error: 'Previously skipped',
                };
            }
            // 'failed' state — allow retry
            this.log('warn', 'publish', `Retrying previously-failed post ${input.idempotencyKey}`);
        }
        const start = Date.now();
        try {
            const result = await doPublish();
            result.latencyMs = Date.now() - start;
            this.recordIdempotency(input.idempotencyKey, result.remoteId, result.state);
            return result;
        }
        catch (err) {
            const elapsed = Date.now() - start;
            const errorMsg = err instanceof Error ? err.message : String(err);
            this.recordIdempotency(input.idempotencyKey, null, 'failed');
            return {
                remoteId: null,
                state: 'failed',
                error: errorMsg,
                latencyMs: elapsed,
            };
        }
    }
    // ── Logging ──
    log(level, action, message, data) {
        const entry = {
            timestamp: new Date().toISOString(),
            level,
            platform: this.platform,
            action,
            message,
            data,
        };
        this.logHistory.push(entry);
        if (this.logHistory.length > MAX_LOG) {
            this.logHistory.shift();
        }
    }
    /** Return recent log entries */
    getLogs() {
        return [...this.logHistory];
    }
    // ── HTTP helpers ──
    /**
     * Authenticated GET request.
     */
    async apiGet(url, headers) {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${this.auth.accessToken}`,
                'Content-Type': 'application/json',
                ...headers,
            },
        });
        if (!response.ok) {
            const body = await response.text().catch(() => '');
            this.log('error', 'apiGet', `HTTP ${response.status}: ${body}`, { url });
            throw new Error(`API GET ${url} failed: ${response.status} ${response.statusText}`);
        }
        return response.json();
    }
    /**
     * Authenticated POST request.
     */
    async apiPost(url, body, headers) {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${this.auth.accessToken}`,
                'Content-Type': 'application/json',
                ...headers,
            },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            const responseBody = await response.text().catch(() => '');
            this.log('error', 'apiPost', `HTTP ${response.status}: ${responseBody}`, { url });
            throw new Error(`API POST ${url} failed: ${response.status} ${response.statusText}`);
        }
        return response.json();
    }
    /**
     * Upload binary data (e.g. media uploads).
     */
    async apiUpload(url, formData, headers) {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${this.auth.accessToken}`,
                ...headers,
            },
            body: formData,
        });
        if (!response.ok) {
            const body = await response.text().catch(() => '');
            this.log('error', 'apiUpload', `HTTP ${response.status}: ${body}`, { url });
            throw new Error(`API Upload to ${url} failed: ${response.status} ${response.statusText}`);
        }
        return response.json();
    }
    /**
     * DELETE request.
     */
    async apiDelete(url, headers) {
        const response = await fetch(url, {
            method: 'DELETE',
            headers: {
                Authorization: `Bearer ${this.auth.accessToken}`,
                'Content-Type': 'application/json',
                ...headers,
            },
        });
        if (!response.ok) {
            const body = await response.text().catch(() => '');
            this.log('error', 'apiDelete', `HTTP ${response.status}: ${body}`, { url });
            throw new Error(`API DELETE ${url} failed: ${response.status} ${response.statusText}`);
        }
        return response.json();
    }
}
//# sourceMappingURL=base.js.map