import { z } from 'zod';
import { type Platform } from '@axiom/core';

// ─── Credential Schema ───

const FanvueCredentialsSchema = z.object({
  endpoint: z.string().url(),
  apiKey: z.string().min(1),
  modelId: z.string().optional(),
});

export type FanvueCredentials = z.infer<typeof FanvueCredentialsSchema>;

// ─── Response Types ───

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

// ─── Error Type ───

export class FanvueMcpError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode?: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'FanvueMcpError';
  }
}

// ─── MCP Client ───

export class FanvueMcpClient {
  private endpoint: string = '';
  private apiKey: string = '';
  private token: string = '';
  private modelId: string = '';
  private connected: boolean = false;

  constructor() {
    // Configured via connect()
  }

  /**
   * Authenticate with the Fanvue MCP endpoint.
   */
  async connect(credentials: FanvueCredentials): Promise<ConnectResult> {
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
      throw new FanvueMcpError(
        'AUTH_FAILED',
        `Fanvue MCP connect failed: ${response.status} ${response.statusText}`,
        response.status,
        body,
      );
    }

    const result: ConnectResult = await response.json() as ConnectResult;
    this.token = result.token;
    this.modelId = result.modelId;
    this.connected = true;
    return result;
  }

  /**
   * Ensure the client is authenticated before making API calls.
   */
  private assertConnected(): void {
    if (!this.connected || !this.token) {
      throw new FanvueMcpError(
        'NOT_CONNECTED',
        'Fanvue MCP client is not connected. Call connect() first.',
      );
    }
  }

  /**
   * Build authenticated headers for MCP API requests.
   */
  private authHeaders(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Upload an image asset to Fanvue MCP.
   */
  async uploadImage(base64: string, filename: string): Promise<UploadResult> {
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
      throw new FanvueMcpError(
        'UPLOAD_FAILED',
        `Image upload failed: ${response.status} ${response.statusText}`,
        response.status,
        body,
      );
    }

    return response.json() as Promise<UploadResult>;
  }

  /**
   * Create a post using an uploaded asset.
   */
  async createPost(assetId: string, caption: string): Promise<PostResult> {
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
      throw new FanvueMcpError(
        'POST_FAILED',
        `Create post failed: ${response.status} ${response.statusText}`,
        response.status,
        body,
      );
    }

    return response.json() as Promise<PostResult>;
  }

  /**
   * Fetch analytics for a model over a given timeframe.
   */
  async getAnalytics(
    modelId: string,
    timeframe: '7d' | '30d' | '90d' = '30d',
  ): Promise<AnalyticsResult> {
    this.assertConnected();

    const response = await fetch(
      `${this.endpoint}/analytics/${encodeURIComponent(modelId)}?timeframe=${timeframe}`,
      {
        method: 'GET',
        headers: this.authHeaders(),
      },
    );

    if (!response.ok) {
      const body = await this.safeJson(response);
      throw new FanvueMcpError(
        'ANALYTICS_FAILED',
        `Get analytics failed: ${response.status} ${response.statusText}`,
        response.status,
        body,
      );
    }

    return response.json() as Promise<AnalyticsResult>;
  }

  /**
   * Fetch inbox / DMs for a model.
   */
  async getInbox(modelId: string): Promise<InboxResult> {
    this.assertConnected();

    const response = await fetch(
      `${this.endpoint}/inbox/${encodeURIComponent(modelId)}`,
      {
        method: 'GET',
        headers: this.authHeaders(),
      },
    );

    if (!response.ok) {
      const body = await this.safeJson(response);
      throw new FanvueMcpError(
        'INBOX_FAILED',
        `Get inbox failed: ${response.status} ${response.statusText}`,
        response.status,
        body,
      );
    }

    return response.json() as Promise<InboxResult>;
  }

  /**
   * Reply to a DM/inbox message.
   */
  async replyToDM(
    modelId: string,
    messageId: string,
    text: string,
  ): Promise<ReplyResult> {
    this.assertConnected();

    const response = await fetch(
      `${this.endpoint}/inbox/${encodeURIComponent(modelId)}/reply`,
      {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({
          message_id: messageId,
          text,
        }),
      },
    );

    if (!response.ok) {
      const body = await this.safeJson(response);
      throw new FanvueMcpError(
        'REPLY_FAILED',
        `Reply to DM failed: ${response.status} ${response.statusText}`,
        response.status,
        body,
      );
    }

    return response.json() as Promise<ReplyResult>;
  }

  /**
   * Safely parse JSON from a failed response. Returns null if parsing fails.
   */
  private async safeJson(response: Response): Promise<unknown | null> {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }
}
