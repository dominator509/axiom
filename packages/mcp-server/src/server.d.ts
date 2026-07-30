import { Tier, type AgentPermission } from './auth.js';
import { type ToolDescriptor } from './manifest.js';
/** A JSON-RPC 2.0 request. */
export interface McpRequest {
    jsonrpc: '2.0';
    method: string;
    params?: Record<string, unknown>;
    id: string | number;
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
export type McpResponse = McpSuccess | McpError;
/**
 * CRM MCP Server — tiered agent tool dispatch.
 *
 * Implements the Model Context Protocol (MCP) as a JSON-RPC 2.0 interface.
 * Tools are gated by the agent's permission tier:
 *   Viewer      → analytics_query
 *   Operator    → + inbox_manage, generation_photoshoot
 *   Manager     → + publishing_post (requires approval)
 *   Autonomous  → + publishing_post (no approval), network_configure
 */
export declare class McpServer {
    private readonly tier;
    private readonly modelId;
    private readonly permission;
    constructor(permission: AgentPermission);
    /**
     * Return the permission bound to this server instance.
     */
    getPermission(): AgentPermission;
    /**
     * Return the tier this server is operating under.
     */
    getTier(): Tier;
    /**
     * Return the model ID this server is scoped to.
     */
    getModelId(): string;
    /**
     * List tools available to the current tier.
     */
    listTools(): ToolDescriptor[];
    /**
     * Handle a single MCP request (JSON-RPC 2.0).
     * Dispatches to the appropriate method handler.
     */
    handleRequest(request: McpRequest): Promise<McpResponse>;
    /**
     * Call a specific tool by name with the given arguments.
     * Permission checks are delegated to the tool's handle() method.
     */
    callTool(toolName: string, args: Record<string, unknown>): Promise<unknown>;
    private _respond;
    private _error;
}
/**
 * Create an McpServer instance by authenticating the incoming request.
 *
 * @param request - The HTTP request (or simulated object) containing
 *   authentication credentials.
 * @returns A new McpServer scoped to the authenticated agent's tier and model.
 * @throws If authentication fails.
 */
export declare function createMcpServer(request: {
    headers?: Record<string, string>;
    params?: Record<string, unknown>;
}): McpServer;
//# sourceMappingURL=server.d.ts.map