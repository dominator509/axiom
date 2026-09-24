import {
  Tier,
  type AgentPermission,
  authenticateAgent,
  authenticateAgentAsync,
  tierAtLeast,
  type TokenRevocationChecker,
  type TokenPermissionChecker,
} from './auth.js';
import { getManifest, allTools, type ToolDescriptor } from './manifest.js';

// ─── MCP Protocol types ─────────────────────────────────────────────────────

/** A JSON-RPC 2.0 request. */
export interface McpRequest {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
  id?: string | number | null;
}

/** A JSON-RPC 2.0 success response. */
export interface McpSuccess {
  jsonrpc: '2.0';
  result: unknown;
  id: string | number | null;
}

/** A JSON-RPC 2.0 error response. */
export interface McpError {
  jsonrpc: '2.0';
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
  id: string | number | null;
}

export type McpResponse = McpSuccess | McpError | null;

export const SUPPORTED_MCP_PROTOCOL_VERSIONS = [
  '2025-06-18',
  '2025-11-25',
  '2026-07-28',
] as const;
export const CURRENT_MCP_PROTOCOL_VERSION = '2026-07-28';

/** Durable audit event emitted before an MCP tool executes. */
export interface McpToolAuditEvent {
  agentId: string;
  modelId: string;
  tier: Tier;
  toolName: string;
  requestId: string | number | null;
}

export interface McpServerOptions {
  /**
   * The API supplies the persistence-backed sink. Keeping the sink injected
   * leaves the MCP package transport/domain focused while ensuring production
   * dispatch cannot run before its audit reservation succeeds.
   */
  onToolCall?: (event: McpToolAuditEvent) => Promise<void> | void;
  /** Durable denylist lookup used by the production HTTP transport. */
  isTokenRevoked?: TokenRevocationChecker;
  /** Durable grant lookup used by the production HTTP transport. */
  isTokenAllowed?: TokenPermissionChecker;
}

// ─── Server ─────────────────────────────────────────────────────────────────

/**
 * CRM MCP Server — tiered agent tool dispatch.
 *
 * Implements the Model Context Protocol (MCP) as a JSON-RPC 2.0 interface.
 * Tools are gated by the agent's permission tier:
 *   Viewer      → analytics_query
 *   Operator    → + inbox_manage, generation_photoshoot
 *   Manager     → + publishing_post (requires approval)
 *   Autonomous  → + publishing_post (requires approval), network_configure
 */
export class McpServer {
  private readonly tier: Tier;
  private readonly modelId: string;
  private readonly permission: AgentPermission;
  private readonly onToolCall?: McpServerOptions['onToolCall'];

  constructor(permission: AgentPermission, options: McpServerOptions = {}) {
    this.permission = permission;
    this.tier = permission.tier;
    this.modelId = permission.modelId;
    this.onToolCall = options.onToolCall;
  }

  /**
   * Return the permission bound to this server instance.
   */
  getPermission(): AgentPermission {
    return this.permission;
  }

  /**
   * Return the tier this server is operating under.
   */
  getTier(): Tier {
    return this.tier;
  }

  /**
   * Return the model ID this server is scoped to.
   */
  getModelId(): string {
    return this.modelId;
  }

  /**
   * List tools available to the current tier.
   */
  listTools(): ToolDescriptor[] {
    return getManifest(this.tier, this.modelId);
  }

  /**
   * Handle a single MCP request (JSON-RPC 2.0).
   * Dispatches to the appropriate method handler.
   */
  async handleRequest(request: McpRequest): Promise<McpResponse> {
    const { method, params } = request;
    const id = typeof request.id === 'string' || typeof request.id === 'number' ? request.id : null;

    // Notifications have no JSON-RPC id and must not receive a response.
    if (!Object.hasOwn(request, 'id')) return null;

    try {
      switch (method) {
        case 'initialize': {
          const requestedVersion = params?.protocolVersion;
          const protocolVersion =
            typeof requestedVersion === 'string' &&
            (SUPPORTED_MCP_PROTOCOL_VERSIONS as readonly string[]).includes(requestedVersion)
              ? requestedVersion
              : CURRENT_MCP_PROTOCOL_VERSION;
          return this._respond(id, {
            protocolVersion,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'axiom-crm', version: '0.1.0' },
          });
        }

        case 'listTools':
        case 'tools/list': {
          const tools = this.listTools().map(({ name, description, inputSchema }) => ({
            name,
            description,
            inputSchema,
          }));
          return this._respond(id, { tools });
        }

        case 'callTool':
        case 'tools/call': {
          if (!params || typeof params.name !== 'string') {
            return this._error(id, -32602, 'Invalid params: tool name required');
          }
          try {
            const result = await this.callTool(
              params.name as string,
              (params.arguments ?? {}) as Record<string, unknown>,
              id,
            );
            return this._respond(id, {
              content: [{ type: 'text', text: JSON.stringify(result) }],
              isError: false,
            });
          } catch (error) {
            if (error instanceof Error && error.message.startsWith('Unknown tool:')) {
              return this._error(id, -32602, 'Unknown tool');
            }
            // Tool internals can contain provider, database, or tenant details.
            // MCP clients receive a safe tool error without leaking that data.
            return this._respond(id, {
              content: [{ type: 'text', text: 'Tool call failed. Check the AXIOM dashboard for status.' }],
              isError: true,
            });
          }
        }

        case 'ping':
          return this._respond(id, {});

        default:
          return this._error(id, -32601, `Method not found: ${method}`);
      }
    } catch {
      return this._error(id, -32603, 'Internal error');
    }
  }

  /**
   * Call a specific tool by name with the given arguments.
   * Permission checks are delegated to the tool's handle() method.
   */
  async callTool(
    toolName: string,
    args: Record<string, unknown>,
    requestId: string | number | null = null,
  ): Promise<unknown> {
    await this.onToolCall?.({
      agentId: this.permission.agentId,
      modelId: this.modelId,
      tier: this.tier,
      toolName,
      requestId,
    });

    const tool = allTools[toolName];
    if (!tool) {
      throw new Error(`Unknown tool: ${toolName}`);
    }

    // Gate by tier
    if (!tierAtLeast(this.tier, tool.tier)) {
      throw new Error(`Tool "${toolName}" requires tier "${tool.tier}", agent has "${this.tier}"`);
    }

    // Validate input schema
    const parsed = tool.inputSchema.safeParse(args);
    if (!parsed.success) {
      throw new Error(`Invalid arguments for "${toolName}": ${parsed.error.message}`);
    }

    // Execute the tool handler
    return (tool as { handle: (args: unknown, perm: AgentPermission) => Promise<unknown> }).handle(
      parsed.data as unknown,
      this.permission,
    );
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private _respond(id: string | number | null, result: unknown): McpSuccess {
    return { jsonrpc: '2.0', result, id };
  }

  private _error(
    id: string | number | null,
    code: number,
    message: string,
    data?: unknown,
  ): McpError {
    return { jsonrpc: '2.0', error: { code, message, data }, id };
  }
}

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Create an McpServer instance by authenticating the incoming request.
 *
 * @param request - The HTTP request (or simulated object) containing
 *   authentication credentials.
 * @param options - Optional production hooks for durable request accounting.
 * @returns A new McpServer scoped to the authenticated agent's tier and model.
 * @throws If authentication fails.
 */
export function createMcpServer(
  request: {
    headers?: Record<string, string>;
    params?: Record<string, unknown>;
  },
  options: McpServerOptions = {},
): McpServer {
  const permission = authenticateAgent(request);
  return new McpServer(permission, options);
}

/** Async factory for transports that must enforce cross-instance revocation. */
export async function createMcpServerAsync(
  request: {
    headers?: Record<string, string>;
    params?: Record<string, unknown>;
  },
  options: McpServerOptions & { isTokenRevoked: TokenRevocationChecker },
): Promise<McpServer> {
  const permission = await authenticateAgentAsync(request, options.isTokenRevoked, options.isTokenAllowed);
  return new McpServer(permission, options);
}
