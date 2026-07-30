import { z } from 'zod';
import { type Platform } from '@axiom/core';
declare const FanvueCredentialsSchema: z.ZodObject<{
    endpoint: z.ZodString;
    apiKey: z.ZodString;
    modelId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    endpoint: string;
    apiKey: string;
    modelId?: string | undefined;
}, {
    endpoint: string;
    apiKey: string;
    modelId?: string | undefined;
}>;
export type FanvueCredentials = z.infer<typeof FanvueCredentialsSchema>;
export interface ConnectResult {
    connected: boolean;
    modelId: string;
    token: string;
    expiresAt: string;
}
export interface UploadResult {
    asset_id: string;
    url: string;
    width: number;
    height: number;
    size_bytes: number;
}
export interface PostResult {
    post_id: string;
    url: string;
    platform: Platform;
    created_at: string;
}
export interface AnalyticsDataPoint {
    date: string;
    views: number;
    likes: number;
    comments: number;
    shares: number;
    engagement_rate: number;
    revenue_cents: number;
}
export interface AnalyticsResult {
    model_id: string;
    timeframe: string;
    summary: {
        total_views: number;
        total_likes: number;
        total_comments: number;
        total_shares: number;
        avg_engagement_rate: number;
        total_revenue_cents: number;
    };
    daily: AnalyticsDataPoint[];
}
export interface InboxMessage {
    id: string;
    from: string;
    from_display: string;
    subject: string;
    body_preview: string;
    received_at: string;
    is_read: boolean;
    thread_id: string;
}
export interface InboxResult {
    model_id: string;
    messages: InboxMessage[];
    unread_count: number;
}
export interface ReplyResult {
    message_id: string;
    sent_at: string;
    status: 'sent' | 'queued' | 'failed';
    error?: string;
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
    constructor();
    /**
     * Authenticate with the Fanvue MCP endpoint.
     */
    connect(credentials: FanvueCredentials): Promise<ConnectResult>;
    /**
     * Ensure the client is authenticated before making API calls.
     */
    private assertConnected;
    /**
     * Build authenticated headers for MCP API requests.
     */
    private authHeaders;
    /**
     * Upload an image asset to Fanvue MCP.
     */
    uploadImage(base64: string, filename: string): Promise<UploadResult>;
    /**
     * Create a post using an uploaded asset.
     */
    createPost(assetId: string, caption: string): Promise<PostResult>;
    /**
     * Fetch analytics for a model over a given timeframe.
     */
    getAnalytics(modelId: string, timeframe?: '7d' | '30d' | '90d'): Promise<AnalyticsResult>;
    /**
     * Fetch inbox / DMs for a model.
     */
    getInbox(modelId: string): Promise<InboxResult>;
    /**
     * Reply to a DM/inbox message.
     */
    replyToDM(modelId: string, messageId: string, text: string): Promise<ReplyResult>;
    /**
     * Safely parse JSON from a failed response. Returns null if parsing fails.
     */
    private safeJson;
}
export {};
//# sourceMappingURL=client.d.ts.map