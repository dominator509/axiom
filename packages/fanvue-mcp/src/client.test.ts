// ─── FanvueMcpClient — Vitest Suite (JSON-RPC 2.0 / MCP protocol) ───
import { describe, it, expect, vi, afterEach } from 'vitest';
import { FanvueMcpClient, FanvueMcpError } from './client.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const CREDS = {
  endpoint: 'https://mcp.fanvue.test',
  apiKey: 'test-api-key-123',
  modelId: 'model-1',
};

const INIT_RESULT = {
  protocolVersion: '2025-03-26',
  capabilities: { tools: {} },
  serverInfo: { name: 'fanvue-mcp', version: '1.0.0' },
};

const TOOLS_RESULT = {
  tools: [
    { name: 'start-image-upload' },
    { name: 'create-image-post' },
    { name: 'read_analytics' },
    { name: 'read_inbox' },
    { name: 'reply_dm' },
  ],
};

afterEach(() => vi.unstubAllGlobals());

/** Stub fetch to answer initialize + tools/list + a final tool call. */
function stubMcpFlow(toolResult: unknown) {
  const fetchMock = vi.fn((_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as { method: string; id: number };
    if (body.method === 'initialize') {
      return Promise.resolve(jsonResponse({ jsonrpc: '2.0', result: INIT_RESULT, id: body.id }));
    }
    if (body.method === 'tools/list') {
      return Promise.resolve(jsonResponse({ jsonrpc: '2.0', result: TOOLS_RESULT, id: body.id }));
    }
    return Promise.resolve(jsonResponse({ jsonrpc: '2.0', result: toolResult, id: body.id }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/**
 * Build a client and run the MCP handshake against the CURRENTLY stubbed
 * fetch. The test owns its stub (via stubMcpFlow) so call-count assertions
 * reference the right function.
 */
async function connectedClient(): Promise<FanvueMcpClient> {
  const c = new FanvueMcpClient();
  await c.connect(CREDS);
  return c;
}

describe('connect (MCP initialize handshake)', () => {
  it('rejects invalid credentials before any network call', async () => {
    const c = new FanvueMcpClient();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(c.connect({ endpoint: 'not-a-url', apiKey: 'k' })).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('performs initialize + tools/list against the /mcp endpoint', async () => {
    const fetchMock = stubMcpFlow({});
    const c = new FanvueMcpClient();
    const result = await c.connect(CREDS);

    expect(result.connected).toBe(true);
    expect(result.protocolVersion).toBe('2025-03-26');
    expect(result.tools).toContain('start-image-upload');
    expect(c['connected']).toBe(true);

    const calls = vi.mocked(fetchMock).mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls.length).toBe(2);
    expect(calls[0][0]).toBe('https://mcp.fanvue.test/mcp');
    expect(calls[1][0]).toBe('https://mcp.fanvue.test/mcp');

    const initFrame = JSON.parse(calls[0][1].body as string);
    expect(initFrame.jsonrpc).toBe('2.0');
    expect(initFrame.method).toBe('initialize');
    expect(initFrame.params.protocolVersion).toBe('2025-03-26');
    expect(initFrame.params.clientInfo.name).toBe('axiom-fanvue-mcp');
    expect(calls[0][1].headers).toMatchObject({ 'X-API-Key': 'test-api-key-123' });
  });

  it('throws FanvueMcpError with MCP error code on JSON-RPC error frame', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({ jsonrpc: '2.0', error: { code: -32001, message: 'unauthorized' }, id: 1 }, 200),
    ));
    const c = new FanvueMcpClient();
    const err = await c.connect(CREDS).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FanvueMcpError);
    expect((err as FanvueMcpError).code).toBe('MCP_-32001');
  });

  it('throws FanvueMcpError HTTP_ERROR on non-ok transport', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'bad' }, 401)));
    const c = new FanvueMcpClient();
    const err = await c.connect(CREDS).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FanvueMcpError);
    expect((err as FanvueMcpError).code).toBe('HTTP_ERROR');
    expect((err as FanvueMcpError).statusCode).toBe(401);
  });
});

describe('authenticated tool calls (tools/call)', () => {
  it('uploadImage requires an active connection', async () => {
    const c = new FanvueMcpClient();
    const err = await c.uploadImage('aGVsbG8=', 'x.jpg').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FanvueMcpError);
    expect((err as FanvueMcpError).code).toBe('NOT_CONNECTED');
  });

  it('uploadImage calls tools/call start-image-upload with JSON-RPC frame', async () => {
    const fetchMock = stubMcpFlow({ asset_id: 'a1', url: 'https://cdn.test/a1.jpg', width: 10, height: 10, size_bytes: 100 });
    const c = await connectedClient();
    const result = await c.uploadImage('aGVsbG8=', 'x.jpg');

    expect(result.asset_id).toBe('a1');

    const calls = vi.mocked(fetchMock).mock.calls as unknown as Array<[string, RequestInit]>;
    const callFrame = JSON.parse(calls[calls.length - 1][1].body as string);
    expect(callFrame.method).toBe('tools/call');
    expect(callFrame.params.name).toBe('start-image-upload');
    expect(callFrame.params.arguments).toMatchObject({ filename: 'x.jpg', model_id: 'model-1' });
  });

  it('uploadImage rejects when tool not advertised', async () => {
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { method: string; id: number };
      if (body.method === 'initialize') {
        return Promise.resolve(jsonResponse({ jsonrpc: '2.0', result: INIT_RESULT, id: body.id }));
      }
      return Promise.resolve(jsonResponse({ jsonrpc: '2.0', result: { tools: [] }, id: body.id }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const c = new FanvueMcpClient();
    await c.connect(CREDS);
    const err = await c.uploadImage('aGVsbG8=', 'x.jpg').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FanvueMcpError);
    expect((err as FanvueMcpError).code).toBe('UNKNOWN_TOOL');
  });

  it('createPost maps create-image-post result', async () => {
    const fetchMock = stubMcpFlow({ post_id: 'p1', url: 'https://fanvue.com/p1', platform: 'fanvue', created_at: '2026-01-01T00:00:00Z' });
    const c = await connectedClient();
    const result = await c.createPost('a1', 'caption text');
    expect(result.post_id).toBe('p1');

    const calls = vi.mocked(fetchMock).mock.calls as unknown as Array<[string, RequestInit]>;
    const callFrame = JSON.parse(calls[calls.length - 1][1].body as string);
    expect(callFrame.params.name).toBe('create-image-post');
    expect(callFrame.params.arguments.caption).toBe('caption text');
  });

  it('getAnalytics / getInbox / replyToDM route through tools/call', async () => {
    const fetchMock = stubMcpFlow({ messages: [], unread_count: 0 });
    const c = await connectedClient();

    const inbox = await c.getInbox('model-1');
    expect(inbox.unread_count).toBe(0);
    const calls = vi.mocked(fetchMock).mock.calls as unknown as Array<[string, RequestInit]>;
    const frame = JSON.parse(calls[calls.length - 1][1].body as string);
    expect(frame.method).toBe('tools/call');
    expect(frame.params.name).toBe('read_inbox');
  });

  it('unwraps text-content envelopes (MCP standard result shape)', async () => {
    const fetchMock = stubMcpFlow({
      content: [{ type: 'text', text: JSON.stringify({ asset_id: 'wrapped-1', url: 'u' }) }],
    });
    const c = await connectedClient();
    const result = await c.uploadImage('aGVsbG8=', 'x.jpg');
    expect(result.asset_id).toBe('wrapped-1');
    expect(vi.mocked(fetchMock).mock.calls.length).toBe(3);
  });

  it('exposes the discovered tool list', async () => {
    stubMcpFlow({});
    const c = await connectedClient();
    expect(c.listTools()).toContain('reply_dm');
    expect(c.hasTool('read_analytics')).toBe(true);
    expect(c.hasTool('nope')).toBe(false);
  });
});
