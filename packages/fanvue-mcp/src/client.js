import { z } from 'zod';
// ─── Credential Schema ───
const FanvueCredentialsSchema = z.object({
    endpoint: z.string().url(),
    apiKey: z.string().min(1),
    modelId: z.string().optional(),
});
// ─── Error Type ───
export class FanvueMcpError extends Error {
    code;
    statusCode;
    details;
    constructor(code, message, statusCode, details) {
        super(message);
        this.code = code;
        this.statusCode = statusCode;
        this.details = details;
        this.name = 'FanvueMcpError';
    }
}
// ─── MCP Client ───
export class FanvueMcpClient {
    endpoint = '';
    apiKey = '';
    token = '';
    modelId = '';
    connected = false;
    constructor() {
        // Configured via connect()
    }
    /**
     * Authenticate with the Fanvue MCP endpoint.
     */
    async connect(credentials) {
        const parsed = FanvueCredentialsSchema.parse(credentials);
        this.endpoint = parsed.endpoint.replace(/\/+$/, '');
        this.apiKey = parsed.apiKey;
        const response = await fetch(`${this.endpoint}/auth/connect`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': this.apiKey,
            },
            body: JSON.stringify({
                model_id: parsed.modelId,
            }),
        });
        if (!response.ok) {
            const body = await this.safeJson(response);
            throw new FanvueMcpError('AUTH_FAILED', `Fanvue MCP connect failed: ${response.status} ${response.statusText}`, response.status, body);
        }
        const result = await response.json();
        this.token = result.token;
        this.modelId = result.modelId;
        this.connected = true;
        return result;
    }
    /**
     * Ensure the client is authenticated before making API calls.
     */
    assertConnected() {
        if (!this.connected || !this.token) {
            throw new FanvueMcpError('NOT_CONNECTED', 'Fanvue MCP client is not connected. Call connect() first.');
        }
    }
    /**
     * Build authenticated headers for MCP API requests.
     */
    authHeaders() {
        return {
            'Authorization': `Bearer ${this.token}`,
            'Content-Type': 'application/json',
        };
    }
    /**
     * Upload an image asset to Fanvue MCP.
     */
    async uploadImage(base64, filename) {
        this.assertConnected();
        const response = await fetch(`${this.endpoint}/assets/upload`, {
            method: 'POST',
            headers: this.authHeaders(),
            body: JSON.stringify({
                model_id: this.modelId,
                filename,
                data: base64,
            }),
        });
        if (!response.ok) {
            const body = await this.safeJson(response);
            throw new FanvueMcpError('UPLOAD_FAILED', `Image upload failed: ${response.status} ${response.statusText}`, response.status, body);
        }
        return response.json();
    }
    /**
     * Create a post using an uploaded asset.
     */
    async createPost(assetId, caption) {
        this.assertConnected();
        const response = await fetch(`${this.endpoint}/posts/create`, {
            method: 'POST',
            headers: this.authHeaders(),
            body: JSON.stringify({
                model_id: this.modelId,
                asset_id: assetId,
                caption,
            }),
        });
        if (!response.ok) {
            const body = await this.safeJson(response);
            throw new FanvueMcpError('POST_FAILED', `Create post failed: ${response.status} ${response.statusText}`, response.status, body);
        }
        return response.json();
    }
    /**
     * Fetch analytics for a model over a given timeframe.
     */
    async getAnalytics(modelId, timeframe = '30d') {
        this.assertConnected();
        const response = await fetch(`${this.endpoint}/analytics/${encodeURIComponent(modelId)}?timeframe=${timeframe}`, {
            method: 'GET',
            headers: this.authHeaders(),
        });
        if (!response.ok) {
            const body = await this.safeJson(response);
            throw new FanvueMcpError('ANALYTICS_FAILED', `Get analytics failed: ${response.status} ${response.statusText}`, response.status, body);
        }
        return response.json();
    }
    /**
     * Fetch inbox / DMs for a model.
     */
    async getInbox(modelId) {
        this.assertConnected();
        const response = await fetch(`${this.endpoint}/inbox/${encodeURIComponent(modelId)}`, {
            method: 'GET',
            headers: this.authHeaders(),
        });
        if (!response.ok) {
            const body = await this.safeJson(response);
            throw new FanvueMcpError('INBOX_FAILED', `Get inbox failed: ${response.status} ${response.statusText}`, response.status, body);
        }
        return response.json();
    }
    /**
     * Reply to a DM/inbox message.
     */
    async replyToDM(modelId, messageId, text) {
        this.assertConnected();
        const response = await fetch(`${this.endpoint}/inbox/${encodeURIComponent(modelId)}/reply`, {
            method: 'POST',
            headers: this.authHeaders(),
            body: JSON.stringify({
                message_id: messageId,
                text,
            }),
        });
        if (!response.ok) {
            const body = await this.safeJson(response);
            throw new FanvueMcpError('REPLY_FAILED', `Reply to DM failed: ${response.status} ${response.statusText}`, response.status, body);
        }
        return response.json();
    }
    /**
     * Safely parse JSON from a failed response. Returns null if parsing fails.
     */
    async safeJson(response) {
        try {
            return await response.json();
        }
        catch {
            return null;
        }
    }
}
//# sourceMappingURL=client.js.map