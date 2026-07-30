import { authenticateAgent, tierAtLeast } from './auth.js';
import { getManifest, allTools } from './manifest.js';
// ─── Server ─────────────────────────────────────────────────────────────────
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
export class McpServer {
    tier;
    modelId;
    permission;
    constructor(permission) {
        this.permission = permission;
        this.tier = permission.tier;
        this.modelId = permission.modelId;
    }
    /**
     * Return the permission bound to this server instance.
     */
    getPermission() {
        return this.permission;
    }
    /**
     * Return the tier this server is operating under.
     */
    getTier() {
        return this.tier;
    }
    /**
     * Return the model ID this server is scoped to.
     */
    getModelId() {
        return this.modelId;
    }
    /**
     * List tools available to the current tier.
     */
    listTools() {
        return getManifest(this.tier, this.modelId);
    }
    /**
     * Handle a single MCP request (JSON-RPC 2.0).
     * Dispatches to the appropriate method handler.
     */
    async handleRequest(request) {
        const { method, params, id } = request;
        try {
            switch (method) {
                case 'listTools':
                case 'tools/list':
                    return this._respond(id, { tools: this.listTools() });
                case 'callTool':
                case 'tools/call': {
                    if (!params || typeof params.name !== 'string') {
                        return this._error(id, -32602, 'Invalid params: tool name required');
                    }
                    const result = await this.callTool(params.name, (params.arguments ?? {}));
                    return this._respond(id, result);
                }
                case 'ping':
                    return this._respond(id, { status: 'pong' });
                default:
                    return this._error(id, -32601, `Method not found: ${method}`);
            }
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return this._error(id, -32603, `Internal error: ${message}`);
        }
    }
    /**
     * Call a specific tool by name with the given arguments.
     * Permission checks are delegated to the tool's handle() method.
     */
    async callTool(toolName, args) {
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
        return tool.handle(parsed.data, this.permission);
    }
    // ── Private helpers ───────────────────────────────────────────────────────
    _respond(id, result) {
        return { jsonrpc: '2.0', result, id };
    }
    _error(id, code, message, data) {
        return { jsonrpc: '2.0', error: { code, message, data }, id };
    }
}
// ─── Factory ────────────────────────────────────────────────────────────────
/**
 * Create an McpServer instance by authenticating the incoming request.
 *
 * @param request - The HTTP request (or simulated object) containing
 *   authentication credentials.
 * @returns A new McpServer scoped to the authenticated agent's tier and model.
 * @throws If authentication fails.
 */
export function createMcpServer(request) {
    const permission = authenticateAgent(request);
    return new McpServer(permission);
}
//# sourceMappingURL=server.js.map