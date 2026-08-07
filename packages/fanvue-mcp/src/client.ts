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
  image: { mediaUuid: string; uploadId: string; etag: string };
  audience: 'subscribers' | 'followers-and-subscribers';
  text?: string;
  price?: number;
  publishAt?: string;
  expiresAt?: string;
  previewImage?: { mediaUuid: string; uploadId: string; etag: string };
  collectionUuids?: string[];
}

/** GET /insights/earnings/summary — pre-aggregated earnings (documented). */
export interface AnalyticsResult {
  // Keys mirror the documented summary fields; keep permissive because the
  // exact JSON shape is versioned by X-Fanvue-API-Version.
  [key: string]: unknown;
}

/** GET /chats — paginated chat list (documented REST endpoint). */
export interface InboxResult {
  // Keys mirror the documented chat list; permissive for versioned shape.
  [key: string]: unknown;
}

/** POST /chats/{userUuid}/message — send a message (documented). */
export interface ReplyResult {
  // Documented result shape for a sent message.
  [key: string]: unknown;
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

  /** Authenticated headers for MCP frames (OAuth Bearer per Fanvue docs). */
  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    };
    if (this.token) h['Authorization'] = `Bearer ${this.token}`;
    else if (this.apiKey) h['X-API-Key'] = this.apiKey;
    return h;
  }

  /**
   * Perform the MCP initialize handshake against the Fanvue endpoint,
   * then discover the tool surface via tools/list.
   */
  async connect(credentials: FanvueCredentials): Promise<ConnectResult> {
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
    // provided access token (or apiKey) is used for subsequent frames.
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

  // ── Documented MCP custom tools: the image-post flow ──

  /**
   * Step 1 of the documented image-post flow: custom__start-image-upload.
   * Takes no arguments; reserves an upload slot and returns everything the
   * PUT step needs. Requires the write:media scope.
   */
  async startImageUpload(): Promise<StartImageUploadResult> {
    const result = await this.callTool('custom__start-image-upload', {});
    const unwrapped = this.unwrap(result, 'mediaUuid');
    if (typeof unwrapped.mediaUuid !== 'string' || typeof unwrapped.uploadUrl !== 'string') {
      throw new FanvueMcpError(
        'UPLOAD_FAILED',
        'Fanvue MCP start-image-upload returned no mediaUuid/uploadUrl',
        undefined,
        result,
      );
    }
    return {
      mediaUuid: unwrapped.mediaUuid as string,
      uploadId: (unwrapped.uploadId as string) ?? '',
      uploadUrl: unwrapped.uploadUrl as string,
      instructions: (unwrapped.instructions as string) ?? '',
    };
  }

  /**
   * Step 2 of the documented image-post flow: HTTP PUT the raw image bytes
   * (not base64) to the uploadUrl with no Authorization header, then return
   * the ETag response header which confirms the upload.
   */
  async uploadImageBytes(uploadUrl: string, bytes: Uint8Array): Promise<string> {
    let response: Response;
    try {
      response = await fetch(uploadUrl, {
        method: 'PUT',
        body: bytes,
        signal: AbortSignal.timeout(DEFAULT_TOOL_TIMEOUT_MS),
      });
    } catch (err) {
      throw new FanvueMcpError(
        'NETWORK_ERROR',
        `Fanvue image upload failed: ${(err as Error).message}`,
      );
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new FanvueMcpError(
        'UPLOAD_FAILED',
        `Fanvue image PUT failed: ${response.status} ${response.statusText}`,
        response.status,
        body,
      );
    }
    const etag = response.headers.get('etag') ?? '';
    if (!etag) {
      throw new FanvueMcpError(
        'UPLOAD_FAILED',
        'Fanvue image PUT returned no ETag header',
        response.status,
      );
    }
    return etag;
  }

  /**
   * Step 3 of the documented image-post flow: custom__create-image-post.
   * Publishes a post carrying the uploaded image. Requires write:media,
   * read:media and write:post scopes. The post is created once the image is
   * ready to display. Returns the created post (same shape as POST /posts).
   */
  async createImagePost(args: CreateImagePostArgs): Promise<PostResult> {
    const result = await this.callTool('custom__create-image-post', args as unknown as Record<string, unknown>);
    const unwrapped = this.unwrap(result, 'uuid');
    if (typeof unwrapped.uuid !== 'string') {
      throw new FanvueMcpError(
        'POST_FAILED',
        'Fanvue MCP create-image-post returned no uuid',
        undefined,
        result,
      );
    }
    return {
      uuid: unwrapped.uuid as string,
      createdAt: (unwrapped.createdAt as string) ?? new Date().toISOString(),
      text: (unwrapped.text as string | null) ?? null,
      price: (unwrapped.price as number | null) ?? null,
      mediaPreviewUuid: (unwrapped.mediaPreviewUuid as string | null) ?? null,
      audience: (unwrapped.audience as PostResult['audience']) ?? 'followers-and-subscribers',
      publishAt: (unwrapped.publishAt as string | null) ?? null,
      publishedAt: (unwrapped.publishedAt as string | null) ?? null,
      expiresAt: (unwrapped.expiresAt as string | null) ?? null,
    };
  }

  // ── Documented REST endpoints (api.fanvue.com) ──
  // The MCP server mirrors the Fanvue API, but the docs document the REST
  // surface precisely, so chats/insights operations go through the real API
  // with the required X-Fanvue-API-Version header.

  /** Authenticated REST headers for api.fanvue.com. */
  private restHeaders(): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Fanvue-API-Version': FANVUE_API_VERSION,
    };
    const bearer = this.token || this.apiKey;
    if (bearer) h['Authorization'] = `Bearer ${bearer}`;
    return h;
  }

  private async restGet<T>(path: string): Promise<T> {
    this.assertConnected();
    let response: Response;
    try {
      response = await fetch(`${FANVUE_API_BASE}${path}`, {
        method: 'GET',
        headers: this.restHeaders(),
        signal: AbortSignal.timeout(DEFAULT_TOOL_TIMEOUT_MS),
      });
    } catch (err) {
      throw new FanvueMcpError(
        'NETWORK_ERROR',
        `Fanvue REST request failed: ${(err as Error).message}`,
        undefined,
        { path },
      );
    }
    if (!response.ok) {
      const body = await this.safeJson(response);
      throw new FanvueMcpError(
        'HTTP_ERROR',
        `Fanvue REST GET ${path} failed: ${response.status} ${response.statusText}`,
        response.status,
        body,
      );
    }
    return response.json() as Promise<T>;
  }

  private async restPost<T>(path: string, body: unknown): Promise<T> {
    this.assertConnected();
    let response: Response;
    try {
      response = await fetch(`${FANVUE_API_BASE}${path}`, {
        method: 'POST',
        headers: this.restHeaders(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(DEFAULT_TOOL_TIMEOUT_MS),
      });
    } catch (err) {
      throw new FanvueMcpError(
        'NETWORK_ERROR',
        `Fanvue REST request failed: ${(err as Error).message}`,
        undefined,
        { path },
      );
    }
    if (!response.ok) {
      const body = await this.safeJson(response);
      throw new FanvueMcpError(
        'HTTP_ERROR',
        `Fanvue REST POST ${path} failed: ${response.status} ${response.statusText}`,
        response.status,
        body,
      );
    }
    return response.json() as Promise<T>;
  }

  /** GET /insights/earnings/summary (documented; read:insights scope). */
  async getEarningsSummary(): Promise<AnalyticsResult> {
    return this.restGet<AnalyticsResult>('/insights/earnings/summary');
  }

  /** GET /chats — paginated chat list (documented; read:chat scope). */
  async getInbox(query = ''): Promise<InboxResult> {
    const qs = query ? `?${query}` : '';
    return this.restGet<InboxResult>(`/chats${qs}`);
  }

  /**
   * POST /chats/{userUuid}/message — send a message in an existing chat
   * (documented; write:chat scope). Accepts text, media attachments, optional
   * pricing, or a single third-party GIF.
   */
  async replyToDM(userUuid: string, text: string, options: Record<string, unknown> = {}): Promise<ReplyResult> {
    return this.restPost<ReplyResult>(`/chats/${userUuid}/message`, {
      text,
      ...options,
    });
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
