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
  protocolVersion: string;
  serverCapabilities: Record<string, unknown>;
  tools: string[];
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

// ─── JSON-RPC 2.0 / MCP protocol types ───

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

// ─── MCP Client (JSON-RPC 2.0) ───
//
// Speaks the Model Context Protocol to mcp.fanvue.com/mcp (L2.10, F-03/F-31):
//   1. initialize handshake (protocolVersion, clientInfo, capabilities)
//   2. tools/list  — discover the tool surface
//   3. tools/call  — invoke each operation with typed arguments
// All frames are JSON-RPC 2.0 POSTed to the MCP endpoint.

const MCP_PROTOCOL_VERSION = '2025-03-26';
const DEFAULT_TOOL_TIMEOUT_MS = 30_000;

export class FanvueMcpClient {
  private endpoint: string = '';
  private apiKey: string = '';
  private token: string = '';
  private modelId: string = '';
  private connected: boolean = false;
  private protocolVersion: string = MCP_PROTOCOL_VERSION;
  private serverCapabilities: Record<string, unknown> = {};
  private toolNames: string[] = [];
  /** True once tools/list has been discovered (even if it returned zero tools). */
  private toolsDiscovered: boolean = false;
  private requestCounter = 1;

  constructor() {
    // Configured via connect()
  }

  /** Resolve the JSON-RPC endpoint URL (append /mcp when missing). */
  private mcpUrl(): string {
    if (this.endpoint.endsWith('/mcp')) return this.endpoint;
    return `${this.endpoint}/mcp`;
  }

  /** Authenticated headers for MCP frames. */
  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    };
    if (this.token) h['Authorization'] = `Bearer ${this.token}`;
    else h['X-API-Key'] = this.apiKey;
    return h;
  }

  /**
   * Perform the MCP initialize handshake against the Fanvue endpoint,
   * then discover the tool surface via tools/list.
   */
  async connect(credentials: FanvueCredentials): Promise<ConnectResult> {
    const parsed = FanvueCredentialsSchema.parse(credentials);
    this.endpoint = parsed.endpoint.replace(/\/+$/, '');
    this.apiKey = parsed.apiKey;
    this.modelId = parsed.modelId ?? '';
    this.token = '';

    // 1. initialize handshake (JSON-RPC 2.0).
    const initResult = await this.request('initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: 'axiom-fanvue-mcp',
        version: '0.1.0',
      },
    });

    const serverInfo = (initResult ?? {}) as Record<string, unknown>;
    if (typeof serverInfo.protocolVersion === 'string') {
      this.protocolVersion = serverInfo.protocolVersion;
    }
    this.serverCapabilities = (serverInfo.capabilities ?? {}) as Record<string, unknown>;

    // 2. tools/list — discover what the server exposes.
    const listResult = (await this.request('tools/list', {})) as { tools?: McpToolDefinition[] };
    this.toolNames = (listResult.tools ?? []).map((t) => t.name);
    this.toolsDiscovered = true;

    // Accept a returned auth token if the server provides one; otherwise the
    // apiKey is used for subsequent frames (typical Bearer-capability model).
    if (typeof serverInfo.auth === 'object' && serverInfo.auth !== null) {
      const auth = serverInfo.auth as Record<string, unknown>;
      if (typeof auth.token === 'string') this.token = auth.token;
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
  listTools(): string[] {
    this.assertConnected();
    return [...this.toolNames];
  }

  /** Whether the server advertises a specific tool. */
  hasTool(name: string): boolean {
    return this.toolNames.includes(name);
  }

  /**
   * Core JSON-RPC 2.0 request over HTTP POST. Handles both batched and
   * single-frame responses; raises FanvueMcpError on protocol errors.
   */
  private async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.requestCounter++;
    const frame: McpJsonRpcRequest = {
      jsonrpc: '2.0',
      method,
      params,
      id,
    };

    let response: Response;
    try {
      response = await fetch(this.mcpUrl(), {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(frame),
        signal: AbortSignal.timeout(DEFAULT_TOOL_TIMEOUT_MS),
      });
    } catch (err) {
      throw new FanvueMcpError(
        'NETWORK_ERROR',
        `Fanvue MCP request failed: ${(err as Error).message}`,
        undefined,
        { method, endpoint: this.mcpUrl() },
      );
    }

    if (!response.ok) {
      const body = await this.safeJson(response);
      throw new FanvueMcpError(
        'HTTP_ERROR',
        `Fanvue MCP ${method} failed: ${response.status} ${response.statusText}`,
        response.status,
        body,
      );
    }

    let payload: McpJsonRpcResponse;
    try {
      payload = await response.json() as McpJsonRpcResponse;
    } catch {
      throw new FanvueMcpError(
        'BAD_RESPONSE',
        `Fanvue MCP ${method} returned non-JSON response`,
        response.status,
      );
    }

    if (payload && 'error' in payload && payload.error) {
      throw new FanvueMcpError(
        `MCP_${payload.error.code ?? 'ERROR'}`,
        payload.error.message || `MCP ${method} error`,
        response.status,
        payload.error.data,
      );
    }

    if (!payload || !('result' in payload)) {
      throw new FanvueMcpError(
        'BAD_RESPONSE',
        `Fanvue MCP ${method} returned no result`,
        response.status,
        payload,
      );
    }
    return payload.result;
  }

  /** Call an MCP tool by name with typed arguments. */
  private async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    this.assertConnected();
    // Only enforce the unknown-tool guard once the surface has been
    // discovered. An explicitly empty list means the server advertises no
    // tools — any call is unknown. A never-discovered list stays permissive.
    if (this.toolsDiscovered && !this.toolNames.includes(name)) {
      throw new FanvueMcpError(
        'UNKNOWN_TOOL',
        `Fanvue MCP tool "${name}" not advertised by server (have: ${this.toolNames.join(', ')})`,
      );
    }
    return this.request('tools/call', { name, arguments: args });
  }

  /** Extract a named field from a tools/call result (result envelope). */
  private unwrap(result: unknown, key: string): Record<string, unknown> {
    const r = (result ?? {}) as Record<string, unknown>;
    const content = r.content;
    if (Array.isArray(content) && content.length > 0) {
      const first = content[0] as Record<string, unknown>;
      if (typeof first.text === 'string') {
        try {
          const parsed = JSON.parse(first.text) as Record<string, unknown>;
          if (key in parsed) return parsed as Record<string, unknown>;
        } catch {
          // not JSON text; fall through
        }
      }
    }
    if (key in r) return r as Record<string, unknown>;
    return r as Record<string, unknown>;
  }

  /**
   * Ensure the client has completed the MCP handshake.
   */
  private assertConnected(): void {
    if (!this.connected) {
      throw new FanvueMcpError(
        'NOT_CONNECTED',
        'Fanvue MCP client is not connected. Call connect() first.',
      );
    }
  }

  /**
   * Upload an image asset via the MCP upload tool.
   */
  async uploadImage(base64: string, filename: string): Promise<UploadResult> {
    const result = await this.callTool('start-image-upload', {
      model_id: this.modelId,
      filename,
      data: base64,
    });
    const unwrapped = this.unwrap(result, 'asset_id');
    if (typeof unwrapped.asset_id !== 'string') {
      throw new FanvueMcpError(
        'UPLOAD_FAILED',
        'Fanvue MCP upload returned no asset_id',
        undefined,
        result,
      );
    }
    return {
      asset_id: unwrapped.asset_id as string,
      url: (unwrapped.url as string) ?? '',
      width: (unwrapped.width as number) ?? 0,
      height: (unwrapped.height as number) ?? 0,
      size_bytes: (unwrapped.size_bytes as number) ?? 0,
    };
  }

  /**
   * Create a post using an uploaded asset via the MCP post tool.
   */
  async createPost(assetId: string, caption: string): Promise<PostResult> {
    const result = await this.callTool('create-image-post', {
      model_id: this.modelId,
      asset_id: assetId,
      caption,
    });
    const unwrapped = this.unwrap(result, 'post_id');
    if (typeof unwrapped.post_id !== 'string') {
      throw new FanvueMcpError(
        'POST_FAILED',
        'Fanvue MCP post returned no post_id',
        undefined,
        result,
      );
    }
    return {
      post_id: unwrapped.post_id as string,
      url: (unwrapped.url as string) ?? '',
      platform: 'fanvue' as Platform,
      created_at: (unwrapped.created_at as string) ?? new Date().toISOString(),
    };
  }

  /**
   * Fetch analytics for a model via the MCP analytics tool.
   */
  async getAnalytics(
    modelId: string,
    timeframe: '7d' | '30d' | '90d' = '30d',
  ): Promise<AnalyticsResult> {
    const result = await this.callTool('read_analytics', {
      model_id: modelId,
      timeframe,
    });
    const unwrapped = this.unwrap(result, 'summary');
    return unwrapped as unknown as AnalyticsResult;
  }

  /**
   * Fetch inbox / DMs for a model via the MCP inbox tool.
   */
  async getInbox(modelId: string): Promise<InboxResult> {
    const result = await this.callTool('read_inbox', {
      model_id: modelId,
    });
    const unwrapped = this.unwrap(result, 'messages');
    return unwrapped as unknown as InboxResult;
  }

  /**
   * Reply to a DM/inbox message via the MCP reply tool.
   */
  async replyToDM(
    modelId: string,
    messageId: string,
    text: string,
  ): Promise<ReplyResult> {
    const result = await this.callTool('reply_dm', {
      model_id: modelId,
      message_id: messageId,
      text,
    });
    const unwrapped = this.unwrap(result, 'message_id');
    return {
      message_id: (unwrapped.message_id as string) ?? messageId,
      sent_at: (unwrapped.sent_at as string) ?? new Date().toISOString(),
      status: (unwrapped.status as ReplyResult['status']) ?? 'queued',
      error: unwrapped.error as string | undefined,
    };
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
