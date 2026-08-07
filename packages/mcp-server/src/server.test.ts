// ─── McpServer: JSON-RPC dispatch / createMcpServer — Vitest Suite ───
import { describe, it, expect } from 'vitest';
import { McpServer, createMcpServer, type McpRequest, type McpResponse } from './server.js';
import { Tier, createCapabilityToken, authenticateAgent, type AgentPermission } from './auth.js';

// A model that exists in the live DB — the tools are DB-backed (H-2), so the
// success-path tests exercise real resolve_model_org + org-scoped queries.
const MODEL = '9283b927-b95d-461c-90d0-729bc2d13852';

function permissionFor(tier: Tier, modelId: string = MODEL, agentId = 'agent-1'): AgentPermission {
  const token = createCapabilityToken(modelId, tier, agentId);
  return authenticateAgent({ headers: { authorization: `Bearer ${token}` } });
}

function makeServer(tier: Tier, modelId: string = MODEL): McpServer {
  return new McpServer(permissionFor(tier, modelId));
}

describe('McpServer construction', () => {
  it('exposes permission, tier and modelId', () => {
    const perm = permissionFor(Tier.Manager, MODEL, 'agent-7');
    const server = new McpServer(perm);
    expect(server.getPermission()).toBe(perm);
    expect(server.getTier()).toBe(Tier.Manager);
    expect(server.getModelId()).toBe(MODEL);
  });

  it('listTools returns the manifest for the bound tier', () => {
    expect(makeServer(Tier.Viewer).listTools().map(t => t.name)).toEqual(['analytics_query']);
    expect(makeServer(Tier.Autonomous).listTools()).toHaveLength(5);
  });
});

describe('McpServer.handleRequest — protocol surface', () => {
  it('responds to ping with pong', async () => {
    const res = await makeServer(Tier.Viewer).handleRequest({
      jsonrpc: '2.0', method: 'ping', id: 1,
    });
    expect(res).toEqual({ jsonrpc: '2.0', result: { status: 'pong' }, id: 1 });
  });

  it('lists tools for listTools and tools/list', async () => {
    const server = makeServer(Tier.Operator);
    const a = await server.handleRequest({ jsonrpc: '2.0', method: 'listTools', id: 'x' });
    expect(a).toMatchObject({ jsonrpc: '2.0', id: 'x' });
    expect((a as { result: { tools: unknown[] } }).result.tools).toHaveLength(3);

    const b = await server.handleRequest({ jsonrpc: '2.0', method: 'tools/list', id: 2 });
    expect((b as { result: { tools: unknown[] } }).result.tools).toHaveLength(3);
  });

  it('returns -32601 for unknown methods', async () => {
    const res = await makeServer(Tier.Viewer).handleRequest({
      jsonrpc: '2.0', method: 'flyToMoon', id: 9,
    });
    expect(res).toMatchObject({
      jsonrpc: '2.0',
      error: { code: -32601, message: 'Method not found: flyToMoon' },
      id: 9,
    });
  });

  it('returns -32602 when callTool lacks a name', async () => {
    const res = await makeServer(Tier.Viewer).handleRequest({
      jsonrpc: '2.0', method: 'callTool', params: { arguments: {} }, id: 3,
    });
    expect(res).toMatchObject({
      error: { code: -32602, message: 'Invalid params: tool name required' },
      id: 3,
    });
  });

  it('wraps unexpected errors as -32603 internal errors', async () => {
    const res = await makeServer(Tier.Viewer).handleRequest({
      jsonrpc: '2.0', method: 'callTool', params: { name: 'nope' }, id: 4,
    });
    expect(res).toMatchObject({
      jsonrpc: '2.0',
      error: { code: -32603, message: 'Internal error: Unknown tool: nope' },
      id: 4,
    });
  });
});

describe('McpServer.callTool — success paths', () => {
  it('executes analytics_query for a viewer', async () => {
    const server = makeServer(Tier.Viewer);
    const result = await server.callTool('analytics_query', { modelId: MODEL });
    expect(result).toMatchObject({
      success: true,
      tool: 'analytics_query',
      modelId: MODEL,
      data: { metric: 'all', dateRange: { from: 'all', to: 'all' } },
    });
  });

  it('executes inbox_manage read for an operator', async () => {
    const server = makeServer(Tier.Operator);
    const result = await server.callTool('inbox_manage', { modelId: MODEL, action: 'read' });
    expect(result).toMatchObject({ success: true, action: 'read', messages: [] });
  });

  it('executes generation_photoshoot with default count of 4 for an operator', async () => {
    const server = makeServer(Tier.Operator);
    const result = (await server.callTool('generation_photoshoot', {
      modelId: MODEL,
      prompt: 'beach editorial',
    })) as { bundleId: string; count: number; status: string; requiresApproval: boolean };
    expect(result.count).toBe(4);
    expect(result.status).toBe('pending_approval');
    expect(result.requiresApproval).toBe(true);
    expect(result.bundleId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('executes publishing_post for an autonomous agent without approval', async () => {
    const server = makeServer(Tier.Autonomous);
    const result = await server.callTool('publishing_post', {
      modelId: MODEL,
      action: 'publish',
      post: { text: 'hello world', platform: 'x' },
    });
    expect(result).toMatchObject({
      success: true,
      requiresApproval: false,
      action: 'publish',
      platform: 'x',
      status: 'queued',
    });
  });

  it('executes publishing_post for a manager with approval required', async () => {
    const server = makeServer(Tier.Manager);
    const result = await server.callTool('publishing_post', {
      modelId: MODEL,
      action: 'schedule',
      post: { text: 'later post', platform: 'fanvue', scheduledAt: '2026-08-02T10:00:00Z' },
    });
    expect(result).toMatchObject({
      success: true,
      requiresApproval: true,
      status: 'pending_approval',
      scheduledAt: '2026-08-02T10:00:00Z',
    });
  });

  it('executes network_configure for an autonomous agent', async () => {
    const server = makeServer(Tier.Autonomous);
    const result = await server.callTool('network_configure', {
      modelId: MODEL,
      config: { crossPosting: true, autoReplyThreshold: 0.8, repostCadenceHours: 12 },
    });
    expect(result).toMatchObject({
      success: true,
      requiresApproval: true,
      status: 'pending_approval',
      config: { crossPosting: true, autoReplyThreshold: 0.8, repostCadenceHours: 12 },
    });
  });

  it('validates inbox reply requirements through the server', async () => {
    const server = makeServer(Tier.Operator);
    await expect(
      server.callTool('inbox_manage', { modelId: MODEL, action: 'reply' }),
    ).rejects.toThrow('messageId and content are required for reply action');
  });
});

describe('McpServer.callTool — permission and validation failures', () => {
  it('rejects a tool above the agent tier', async () => {
    const server = makeServer(Tier.Viewer);
    await expect(
      server.callTool('inbox_manage', { modelId: MODEL, action: 'read' }),
    ).rejects.toThrow('requires tier "operator", agent has "viewer"');
  });

  it('rejects publishing for an operator', async () => {
    const server = makeServer(Tier.Operator);
    await expect(
      server.callTool('publishing_post', {
        modelId: MODEL,
        action: 'publish',
        post: { platform: 'x' },
      }),
    ).rejects.toThrow('requires tier "manager", agent has "operator"');
  });

  it('rejects network_configure below autonomous', async () => {
    const server = makeServer(Tier.Manager);
    await expect(
      server.callTool('network_configure', { modelId: MODEL, config: {} }),
    ).rejects.toThrow('requires tier "autonomous", agent has "manager"');
  });

  it('throws for unknown tools', async () => {
    await expect(makeServer(Tier.Autonomous).callTool('ghost_tool', {})).rejects.toThrow(
      'Unknown tool: ghost_tool',
    );
  });

  it('rejects arguments that fail schema validation', async () => {
    const server = makeServer(Tier.Viewer);
    await expect(server.callTool('analytics_query', { modelId: 'not-a-uuid' })).rejects.toThrow(
      'Invalid arguments for "analytics_query"',
    );
  });

  it('rejects missing required arguments', async () => {
    const server = makeServer(Tier.Viewer);
    await expect(server.callTool('analytics_query', {})).rejects.toThrow(
      'Invalid arguments for "analytics_query"',
    );
  });

  it('rejects a model mismatch with the token scope', async () => {
    const server = makeServer(Tier.Viewer, MODEL);
    await expect(
      server.callTool('analytics_query', { modelId: '22222222-2222-4222-8222-222222222222' }),
    ).rejects.toThrow('Model mismatch');
  });

  it('checks tier before schema validation', async () => {
    const server = makeServer(Tier.Viewer);
    await expect(
      server.callTool('generation_photoshoot', { prompt: 12345 }),
    ).rejects.toThrow('requires tier "operator"');
  });
});

describe('McpServer.handleRequest — callTool end to end', () => {
  it('dispatches a full callTool request with arguments', async () => {
    const server = makeServer(Tier.Viewer);
    const req: McpRequest = {
      jsonrpc: '2.0',
      method: 'callTool',
      params: { name: 'analytics_query', arguments: { modelId: MODEL, metric: 'views' } },
      id: 'req-42',
    };
    const res = await server.handleRequest(req);
    expect(res).toMatchObject({ jsonrpc: '2.0', id: 'req-42' });
    const result = (res as { result: { data: { metric: string } } }).result;
    expect(result.data.metric).toBe('views');
  });

  it('surfaces validation failures as -32603 internal errors', async () => {
    const server = makeServer(Tier.Viewer);
    const res = (await server.handleRequest({
      jsonrpc: '2.0',
      method: 'callTool',
      params: { name: 'analytics_query', arguments: { modelId: 'bad' } },
      id: 5,
    })) as McpResponse;
    expect(res).toMatchObject({
      error: { code: -32603, message: expect.stringContaining('Invalid arguments for "analytics_query"') },
      id: 5,
    });
  });

  it('treats missing arguments as an empty object', async () => {
    const server = makeServer(Tier.Viewer);
    const res = (await server.handleRequest({
      jsonrpc: '2.0',
      method: 'callTool',
      params: { name: 'analytics_query' },
      id: 6,
    })) as McpResponse;
    expect(res).toMatchObject({ error: { code: -32603 } });
  });

  it('preserves numeric request ids in responses', async () => {
    const server = makeServer(Tier.Viewer);
    const res = await server.handleRequest({ jsonrpc: '2.0', method: 'ping', id: 123 });
    expect(res.id).toBe(123);
  });
});

describe('createMcpServer', () => {
  it('builds a server scoped to the authenticated agent', () => {
    const token = createCapabilityToken(MODEL, Tier.Autonomous, 'agent-zz');
    const server = createMcpServer({ headers: { authorization: `Bearer ${token}` } });
    expect(server).toBeInstanceOf(McpServer);
    expect(server.getTier()).toBe(Tier.Autonomous);
    expect(server.getModelId()).toBe(MODEL);
    expect(server.getPermission().agentId).toBe('agent-zz');
  });

  it('authenticates via params.token', () => {
    const token = createCapabilityToken(MODEL, Tier.Manager, 'agent-param');
    const server = createMcpServer({ params: { token } });
    expect(server.getTier()).toBe(Tier.Manager);
  });

  it('throws when authentication fails', () => {
    expect(() => createMcpServer({})).toThrow('Authentication required');
    expect(() => createMcpServer({ headers: { authorization: 'Bearer bogus' } })).toThrow(
      'Authentication failed',
    );
  });
});
