import { z } from 'zod';
declare const FanvueCredentialsSchema: z.ZodObject<{
    endpoint: z.ZodString;
    apiKey: z.ZodOptional<z.ZodString>;
    accessToken: z.ZodOptional<z.ZodString>;
    modelId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    endpoint: string;
    accessToken?: string | undefined;
    apiKey?: string | undefined;
    modelId?: string | undefined;
}, {
    endpoint: string;
    accessToken?: string | undefined;
    apiKey?: string | undefined;
    modelId?: string | undefined;
}>;
export type FanvueCredentials = z.infer<typeof FanvueCredentialsSchema>;
export interface ConnectResult {
    connected: boolean;
    modelId: string;
    token: string;
    expiresAt: string;
    protocolVersion: string;
    serverCapabilities: Record<string, unknown>;
    tools: string[];
}
/** Result of custom__start-image-upload (documented MCP custom tool). */
export interface StartImageUploadResult {
    mediaUuid: string;
    uploadId: string;
    uploadUrl: string;
    instructions: string;
}
/** Result of custom__create-image-post — same shape as POST /posts. */
export interface PostResult {
    uuid: string;
    createdAt: string;
    text: string | null;
    price: number | null;
    mediaPreviewUuid: string | null;
    audience: 'subscribers' | 'followers-and-subscribers';
    publishAt: string | null;
    publishedAt: string | null;
    expiresAt: string | null;
}
/** Arguments for custom__create-image-post (documented). */
export interface CreateImagePostArgs {
    image: {
        mediaUuid: string;
        uploadId: string;
        etag: string;
    };
    audience: 'subscribers' | 'followers-and-subscribers';
    text?: string;
    price?: number;
    publishAt?: string;
    expiresAt?: string;
    previewImage?: {
        mediaUuid: string;
        uploadId: string;
        etag: string;
    };
    collectionUuids?: string[];
}
/** GET /insights/earnings/summary — pre-aggregated earnings (documented). */
export interface AnalyticsResult {
    [key: string]: unknown;
}
/** GET /chats — paginated chat list (documented REST endpoint). */
export interface InboxResult {
    [key: string]: unknown;
}
/** POST /chats/{userUuid}/message — send a message (documented). */
export interface ReplyResult {
    [key: string]: unknown;
}
export interface McpJsonRpcRequest {
    jsonrpc: '2.0';
    method: string;
    params?: Record<string, unknown>;
    id: number;
}
export interface McpJsonRpcSuccess {
    jsonrpc: '2.0';
    result: unknown;
    id: number | null;
}
export interface McpJsonRpcError {
    jsonrpc: '2.0';
    error: {
        code: number;
        message: string;
        data?: unknown;
    };
    id: number | null;
}
export type McpJsonRpcResponse = McpJsonRpcSuccess | McpJsonRpcError;
export interface McpToolDefinition {
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
}
export declare class FanvueMcpError extends Error {
    readonly code: string;
    readonly statusCode?: number | undefined;
    readonly details?: unknown | undefined;
    constructor(code: string, message: string, statusCode?: number | undefined, details?: unknown | undefined);
}
export declare class FanvueMcpClient {
    private endpoint;
    private apiKey;
    private token;
    private modelId;
    private connected;
    private protocolVersion;
    private serverCapabilities;
    private toolNames;
    /** True once tools/list has been discovered (even if it returned zero tools). */
    private toolsDiscovered;
    private requestCounter;
    constructor();
    /** Resolve the JSON-RPC endpoint URL (append /mcp when missing). */
    private mcpUrl;
    /** Authenticated headers for MCP frames (OAuth Bearer per Fanvue docs). */
    private headers;
    /**
     * Perform the MCP initialize handshake against the Fanvue endpoint,
     * then discover the tool surface via tools/list.
     */
    connect(credentials: FanvueCredentials): Promise<ConnectResult>;
    /** Return the discovered tool surface. */
    listTools(): string[];
    /** Whether the server advertises a specific tool. */
    hasTool(name: string): boolean;
    /**
     * Core JSON-RPC 2.0 request over HTTP POST. Handles both batched and
     * single-frame responses; raises FanvueMcpError on protocol errors.
     */
    private request;
    /** Call an MCP tool by name with typed arguments. */
    private callTool;
    /** Extract a named field from a tools/call result (result envelope). */
    private unwrap;
    /**
     * Ensure the client has completed the MCP handshake.
     */
    private assertConnected;
    /**
     * Step 1 of the documented image-post flow: custom__start-image-upload.
     * Takes no arguments; reserves an upload slot and returns everything the
     * PUT step needs. Requires the write:media scope.
     */
    startImageUpload(): Promise<StartImageUploadResult>;
    /**
     * Step 2 of the documented image-post flow: HTTP PUT the raw image bytes
     * (not base64) to the uploadUrl with no Authorization header, then return
     * the ETag response header which confirms the upload.
     */
    uploadImageBytes(uploadUrl: string, bytes: Uint8Array): Promise<string>;
    /**
     * Step 3 of the documented image-post flow: custom__create-image-post.
     * Publishes a post carrying the uploaded image. Requires write:media,
     * read:media and write:post scopes. The post is created once the image is
     * ready to display. Returns the created post (same shape as POST /posts).
     */
    createImagePost(args: CreateImagePostArgs): Promise<PostResult>;
    /** Authenticated REST headers for api.fanvue.com. */
    private restHeaders;
    private restGet;
    private restPost;
    /** GET /insights/earnings/summary (documented; read:insights scope). */
    getEarningsSummary(): Promise<AnalyticsResult>;
    /** GET /chats — paginated chat list (documented; read:chat scope). */
    getInbox(query?: string): Promise<InboxResult>;
    /**
     * POST /chats/{userUuid}/message — send a message in an existing chat
     * (documented; write:chat scope). Accepts text, media attachments, optional
     * pricing, or a single third-party GIF.
     */
    replyToDM(userUuid: string, text: string, options?: Record<string, unknown>): Promise<ReplyResult>;
    /**
     * Safely parse JSON from a failed response. Returns null if parsing fails.
     */
    private safeJson;
}
export {};
//# sourceMappingURL=client.d.ts.map