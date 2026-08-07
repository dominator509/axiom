import { z } from 'zod';
// ─── Credential Schema ───
// Fanvue uses OAuth 2.0 (no API keys). The MCP server is authorized through
// the standard Fanvue OAuth flow; the resulting access token is sent as a
// Bearer token on MCP frames. The same token authorizes documented REST
// endpoints (api.fanvue.com) used for chats and insights.
const FanvueCredentialsSchema = z.object({
    endpoint: z.string().url(),
    apiKey: z.string().min(1).optional(),
    accessToken: z.string().min(1).optional(),
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
// ─── MCP Client (JSON-RPC 2.0) ───
//
// Speaks the Model Context Protocol to mcp.fanvue.com/mcp per the official
// Fanvue docs (https://api.fanvue.com/docs/mcp-server):
//   1. initialize handshake (protocolVersion, clientInfo, capabilities)
//   2. tools/list  — discover the tool surface (incl. custom__ tools)
//   3. tools/call  — invoke each operation with typed arguments
// The docs document exactly two custom tools: custom__start-image-upload and
// custom__create-image-post (the image-post flow). Everything else (chats,
// insights, media, posts) is a documented REST endpoint on api.fanvue.com —
// those are implemented as REST calls with the X-Fanvue-API-Version header.
const MCP_PROTOCOL_VERSION = '2025-03-26';
const DEFAULT_TOOL_TIMEOUT_MS = 30_000;
const FANVUE_API_BASE = 'https://api.fanvue.com';
const FANVUE_API_VERSION = '2025-06-26';
export class FanvueMcpClient {
    endpoint = '';
    apiKey = '';
    token = '';
    modelId = '';
    connected = false;
    protocolVersion = MCP_PROTOCOL_VERSION;
    serverCapabilities = {};
    toolNames = [];
    /** True once tools/list has been discovered (even if it returned zero tools). */
    toolsDiscovered = false;
    requestCounter = 1;
    constructor() {
        // Configured via connect()
    }
    /** Resolve the JSON-RPC endpoint URL (append /mcp when missing). */
    mcpUrl() {
        if (this.endpoint.endsWith('/mcp'))
            return this.endpoint;
        return `${this.endpoint}/mcp`;
    }
    /** Authenticated headers for MCP frames (OAuth Bearer per Fanvue docs). */
    headers() {
        const h = {
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/event-stream',
        };
        if (this.token)
            h['Authorization'] = `Bearer ${this.token}`;
        else if (this.apiKey)
            h['X-API-Key'] = this.apiKey;
        return h;
    }
    /**
     * Perform the MCP initialize handshake against the Fanvue endpoint,
     * then discover the tool surface via tools/list.
     */
    async connect(credentials) {
        const parsed = FanvueCredentialsSchema.parse(credentials);
        this.endpoint = parsed.endpoint.replace(/\/+$/, '');
        this.apiKey = parsed.apiKey ?? '';
        this.token = parsed.accessToken ?? '';
        this.modelId = parsed.modelId ?? '';
        // 1. initialize handshake (JSON-RPC 2.0).
        const initResult = await this.request('initialize', {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: {
                name: 'axiom-fanvue-mcp',
                version: '0.1.0',
            },
        });
        const serverInfo = (initResult ?? {});
        if (typeof serverInfo.protocolVersion === 'string') {
            this.protocolVersion = serverInfo.protocolVersion;
        }
        this.serverCapabilities = (serverInfo.capabilities ?? {});
        // 2. tools/list — discover what the server exposes.
        const listResult = (await this.request('tools/list', {}));
        this.toolNames = (listResult.tools ?? []).map((t) => t.name);
        this.toolsDiscovered = true;
        // Accept a returned auth token if the server provides one; otherwise the
        // provided access token (or apiKey) is used for subsequent frames.
        if (typeof serverInfo.auth === 'object' && serverInfo.auth !== null) {
            const auth = serverInfo.auth;
            if (typeof auth.token === 'string')
                this.token = auth.token;
        }
        this.connected = true;
        return {
            connected: true,
            modelId: this.modelId,
            token: this.token || this.apiKey,
            expiresAt: '2099-01-01T00:00:00Z',
            protocolVersion: this.protocolVersion,
            serverCapabilities: this.serverCapabilities,
            tools: this.toolNames,
        };
    }
    /** Return the discovered tool surface. */
    listTools() {
        this.assertConnected();
        return [...this.toolNames];
    }
    /** Whether the server advertises a specific tool. */
    hasTool(name) {
        return this.toolNames.includes(name);
    }
    /**
     * Core JSON-RPC 2.0 request over HTTP POST. Handles both batched and
     * single-frame responses; raises FanvueMcpError on protocol errors.
     */
    async request(method, params) {
        const id = this.requestCounter++;
        const frame = {
            jsonrpc: '2.0',
            method,
            params,
            id,
        };
        let response;
        try {
            response = await fetch(this.mcpUrl(), {
                method: 'POST',
                headers: this.headers(),
                body: JSON.stringify(frame),
                signal: AbortSignal.timeout(DEFAULT_TOOL_TIMEOUT_MS),
            });
        }
        catch (err) {
            throw new FanvueMcpError('NETWORK_ERROR', `Fanvue MCP request failed: ${err.message}`, undefined, { method, endpoint: this.mcpUrl() });
        }
        if (!response.ok) {
            const body = await this.safeJson(response);
            throw new FanvueMcpError('HTTP_ERROR', `Fanvue MCP ${method} failed: ${response.status} ${response.statusText}`, response.status, body);
        }
        let payload;
        try {
            payload = await response.json();
        }
        catch {
            throw new FanvueMcpError('BAD_RESPONSE', `Fanvue MCP ${method} returned non-JSON response`, response.status);
        }
        if (payload && 'error' in payload && payload.error) {
            throw new FanvueMcpError(`MCP_${payload.error.code ?? 'ERROR'}`, payload.error.message || `MCP ${method} error`, response.status, payload.error.data);
        }
        if (!payload || !('result' in payload)) {
            throw new FanvueMcpError('BAD_RESPONSE', `Fanvue MCP ${method} returned no result`, response.status, payload);
        }
        return payload.result;
    }
    /** Call an MCP tool by name with typed arguments. */
    async callTool(name, args) {
        this.assertConnected();
        // Only enforce the unknown-tool guard once the surface has been
        // discovered. An explicitly empty list means the server advertises no
        // tools — any call is unknown. A never-discovered list stays permissive.
        if (this.toolsDiscovered && !this.toolNames.includes(name)) {
            throw new FanvueMcpError('UNKNOWN_TOOL', `Fanvue MCP tool "${name}" not advertised by server (have: ${this.toolNames.join(', ')})`);
        }
        return this.request('tools/call', { name, arguments: args });
    }
    /** Extract a named field from a tools/call result (result envelope). */
    unwrap(result, key) {
        const r = (result ?? {});
        const content = r.content;
        if (Array.isArray(content) && content.length > 0) {
            const first = content[0];
            if (typeof first.text === 'string') {
                try {
                    const parsed = JSON.parse(first.text);
                    if (key in parsed)
                        return parsed;
                }
                catch {
                    // not JSON text; fall through
                }
            }
        }
        if (key in r)
            return r;
        return r;
    }
    /**
     * Ensure the client has completed the MCP handshake.
     */
    assertConnected() {
        if (!this.connected) {
            throw new FanvueMcpError('NOT_CONNECTED', 'Fanvue MCP client is not connected. Call connect() first.');
        }
    }
    // ── Documented MCP custom tools: the image-post flow ──
    /**
     * Step 1 of the documented image-post flow: custom__start-image-upload.
     * Takes no arguments; reserves an upload slot and returns everything the
     * PUT step needs. Requires the write:media scope.
     */
    async startImageUpload() {
        const result = await this.callTool('custom__start-image-upload', {});
        const unwrapped = this.unwrap(result, 'mediaUuid');
        if (typeof unwrapped.mediaUuid !== 'string' || typeof unwrapped.uploadUrl !== 'string') {
            throw new FanvueMcpError('UPLOAD_FAILED', 'Fanvue MCP start-image-upload returned no mediaUuid/uploadUrl', undefined, result);
        }
        return {
            mediaUuid: unwrapped.mediaUuid,
            uploadId: unwrapped.uploadId ?? '',
            uploadUrl: unwrapped.uploadUrl,
            instructions: unwrapped.instructions ?? '',
        };
    }
    /**
     * Step 2 of the documented image-post flow: HTTP PUT the raw image bytes
     * (not base64) to the uploadUrl with no Authorization header, then return
     * the ETag response header which confirms the upload.
     */
    async uploadImageBytes(uploadUrl, bytes) {
        let response;
        try {
            response = await fetch(uploadUrl, {
                method: 'PUT',
                body: bytes,
                signal: AbortSignal.timeout(DEFAULT_TOOL_TIMEOUT_MS),
            });
        }
        catch (err) {
            throw new FanvueMcpError('NETWORK_ERROR', `Fanvue image upload failed: ${err.message}`);
        }
        if (!response.ok) {
            const body = await response.text().catch(() => '');
            throw new FanvueMcpError('UPLOAD_FAILED', `Fanvue image PUT failed: ${response.status} ${response.statusText}`, response.status, body);
        }
        const etag = response.headers.get('etag') ?? '';
        if (!etag) {
            throw new FanvueMcpError('UPLOAD_FAILED', 'Fanvue image PUT returned no ETag header', response.status);
        }
        return etag;
    }
    /**
     * Step 3 of the documented image-post flow: custom__create-image-post.
     * Publishes a post carrying the uploaded image. Requires write:media,
     * read:media and write:post scopes. The post is created once the image is
     * ready to display. Returns the created post (same shape as POST /posts).
     */
    async createImagePost(args) {
        const result = await this.callTool('custom__create-image-post', args);
        const unwrapped = this.unwrap(result, 'uuid');
        if (typeof unwrapped.uuid !== 'string') {
            throw new FanvueMcpError('POST_FAILED', 'Fanvue MCP create-image-post returned no uuid', undefined, result);
        }
        return {
            uuid: unwrapped.uuid,
            createdAt: unwrapped.createdAt ?? new Date().toISOString(),
            text: unwrapped.text ?? null,
            price: unwrapped.price ?? null,
            mediaPreviewUuid: unwrapped.mediaPreviewUuid ?? null,
            audience: unwrapped.audience ?? 'followers-and-subscribers',
            publishAt: unwrapped.publishAt ?? null,
            publishedAt: unwrapped.publishedAt ?? null,
            expiresAt: unwrapped.expiresAt ?? null,
        };
    }
    // ── Documented REST endpoints (api.fanvue.com) ──
    // The MCP server mirrors the Fanvue API, but the docs document the REST
    // surface precisely, so chats/insights operations go through the real API
    // with the required X-Fanvue-API-Version header.
    /** Authenticated REST headers for api.fanvue.com. */
    restHeaders() {
        const h = {
            'Content-Type': 'application/json',
            'X-Fanvue-API-Version': FANVUE_API_VERSION,
        };
        const bearer = this.token || this.apiKey;
        if (bearer)
            h['Authorization'] = `Bearer ${bearer}`;
        return h;
    }
    async restGet(path) {
        this.assertConnected();
        let response;
        try {
            response = await fetch(`${FANVUE_API_BASE}${path}`, {
                method: 'GET',
                headers: this.restHeaders(),
                signal: AbortSignal.timeout(DEFAULT_TOOL_TIMEOUT_MS),
            });
        }
        catch (err) {
            throw new FanvueMcpError('NETWORK_ERROR', `Fanvue REST request failed: ${err.message}`, undefined, { path });
        }
        if (!response.ok) {
            const body = await this.safeJson(response);
            throw new FanvueMcpError('HTTP_ERROR', `Fanvue REST GET ${path} failed: ${response.status} ${response.statusText}`, response.status, body);
        }
        return response.json();
    }
    async restPost(path, body) {
        this.assertConnected();
        let response;
        try {
            response = await fetch(`${FANVUE_API_BASE}${path}`, {
                method: 'POST',
                headers: this.restHeaders(),
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(DEFAULT_TOOL_TIMEOUT_MS),
            });
        }
        catch (err) {
            throw new FanvueMcpError('NETWORK_ERROR', `Fanvue REST request failed: ${err.message}`, undefined, { path });
        }
        if (!response.ok) {
            const body = await this.safeJson(response);
            throw new FanvueMcpError('HTTP_ERROR', `Fanvue REST POST ${path} failed: ${response.status} ${response.statusText}`, response.status, body);
        }
        return response.json();
    }
    /** GET /insights/earnings/summary (documented; read:insights scope). */
    async getEarningsSummary() {
        return this.restGet('/insights/earnings/summary');
    }
    /** GET /chats — paginated chat list (documented; read:chat scope). */
    async getInbox(query = '') {
        const qs = query ? `?${query}` : '';
        return this.restGet(`/chats${qs}`);
    }
    /**
     * POST /chats/{userUuid}/message — send a message in an existing chat
     * (documented; write:chat scope). Accepts text, media attachments, optional
     * pricing, or a single third-party GIF.
     */
    async replyToDM(userUuid, text, options = {}) {
        return this.restPost(`/chats/${userUuid}/message`, {
            text,
            ...options,
        });
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