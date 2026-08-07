// ─── FanvueMcpClient — Vitest Suite (official Fanvue MCP + REST contracts) ───
// Covers: connect handshake, the documented custom__ image-post flow
// (custom__start-image-upload → PUT bytes → custom__create-image-post), the
// documented REST endpoints (insights/earnings/summary, /chats,
// /chats/{userUuid}/message), and error handling.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { FanvueMcpClient, FanvueMcpError } from './client.js';
function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
const CREDS = {
    endpoint: 'https://mcp.fanvue.test',
    accessToken: 'test-oauth-token',
    modelId: 'model-1',
};
const INIT_RESULT = {
    protocolVersion: '2025-03-26',
    capabilities: { tools: {} },
    serverInfo: { name: 'fanvue-mcp', version: '1.0.0' },
};
const TOOLS_RESULT = {
    tools: [
        { name: 'custom__start-image-upload' },
        { name: 'custom__create-image-post' },
    ],
};
afterEach(() => vi.unstubAllGlobals());
/** Stub fetch to answer initialize + tools/list + a final MCP tool call. */
function stubMcpFlow(toolResult) {
    const fetchMock = vi.fn((url, init) => {
        if (String(url).startsWith('https://api.fanvue.com')) {
            return Promise.resolve(jsonResponse(toolResult));
        }
        const body = JSON.parse(init.body);
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
async function connectedClient() {
    const c = new FanvueMcpClient();
    await c.connect(CREDS);
    return c;
}
describe('connect (MCP initialize handshake)', () => {
    it('rejects invalid credentials before any network call', async () => {
        const c = new FanvueMcpClient();
        const fetchSpy = vi.fn();
        vi.stubGlobal('fetch', fetchSpy);
        await expect(c.connect({ endpoint: 'not-a-url', accessToken: 'k' })).rejects.toThrow();
        expect(fetchSpy).not.toHaveBeenCalled();
    });
    it('performs initialize + tools/list against the /mcp endpoint', async () => {
        const fetchMock = stubMcpFlow({});
        const c = new FanvueMcpClient();
        const result = await c.connect(CREDS);
        expect(result.connected).toBe(true);
        expect(result.protocolVersion).toBe('2025-03-26');
        expect(result.tools).toContain('custom__start-image-upload');
        expect(c['connected']).toBe(true);
        const calls = vi.mocked(fetchMock).mock.calls;
        expect(calls.length).toBe(2);
        expect(calls[0][0]).toBe('https://mcp.fanvue.test/mcp');
        expect(calls[1][0]).toBe('https://mcp.fanvue.test/mcp');
        const initFrame = JSON.parse(calls[0][1].body);
        expect(initFrame.jsonrpc).toBe('2.0');
        expect(initFrame.method).toBe('initialize');
        expect(initFrame.params.protocolVersion).toBe('2025-03-26');
        expect(initFrame.params.clientInfo.name).toBe('axiom-fanvue-mcp');
        expect(calls[0][1].headers).toMatchObject({ Authorization: 'Bearer test-oauth-token' });
    });
    it('throws FanvueMcpError with MCP error code on JSON-RPC error frame', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ jsonrpc: '2.0', error: { code: -32001, message: 'unauthorized' }, id: 1 }, 200)));
        const c = new FanvueMcpClient();
        const err = await c.connect(CREDS).catch((e) => e);
        expect(err).toBeInstanceOf(FanvueMcpError);
        expect(err.code).toBe('MCP_-32001');
    });
    it('throws FanvueMcpError HTTP_ERROR on non-ok transport', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'bad' }, 401)));
        const c = new FanvueMcpClient();
        const err = await c.connect(CREDS).catch((e) => e);
        expect(err).toBeInstanceOf(FanvueMcpError);
        expect(err.code).toBe('HTTP_ERROR');
        expect(err.statusCode).toBe(401);
    });
});
describe('documented custom__ image-post flow', () => {
    it('startImageUpload requires an active connection', async () => {
        const c = new FanvueMcpClient();
        const err = await c.startImageUpload().catch((e) => e);
        expect(err).toBeInstanceOf(FanvueMcpError);
        expect(err.code).toBe('NOT_CONNECTED');
    });
    it('startImageUpload calls custom__start-image-upload with NO arguments', async () => {
        const uploadResult = {
            mediaUuid: 'b8c47a91-3f2d-4a55-b7e8-1c9d2e4f5a6b',
            uploadId: 'dXBsb2FkLXNlc3Npb24tZXhhbXBsZQ',
            uploadUrl: 'https://storage.example.com/uploads/b8c47a91?signature=abc',
            instructions: 'PUT the raw image bytes (not base64) to uploadUrl...',
        };
        const fetchMock = stubMcpFlow(uploadResult);
        const c = await connectedClient();
        const result = await c.startImageUpload();
        expect(result.mediaUuid).toBe('b8c47a91-3f2d-4a55-b7e8-1c9d2e4f5a6b');
        expect(result.uploadUrl).toContain('storage.example.com');
        const calls = vi.mocked(fetchMock).mock.calls;
        const callFrame = JSON.parse(calls[calls.length - 1][1].body);
        expect(callFrame.method).toBe('tools/call');
        expect(callFrame.params.name).toBe('custom__start-image-upload');
        expect(callFrame.params.arguments).toEqual({});
    });
    it('startImageUpload rejects when tool not advertised', async () => {
        const fetchMock = vi.fn((_url, init) => {
            const body = JSON.parse(init.body);
            if (body.method === 'initialize') {
                return Promise.resolve(jsonResponse({ jsonrpc: '2.0', result: INIT_RESULT, id: body.id }));
            }
            return Promise.resolve(jsonResponse({ jsonrpc: '2.0', result: { tools: [] }, id: body.id }));
        });
        vi.stubGlobal('fetch', fetchMock);
        const c = new FanvueMcpClient();
        await c.connect(CREDS);
        const err = await c.startImageUpload().catch((e) => e);
        expect(err).toBeInstanceOf(FanvueMcpError);
        expect(err.code).toBe('UNKNOWN_TOOL');
    });
    it('uploadImageBytes PUTs raw bytes with no Authorization header and returns ETag', async () => {
        const putMock = vi.fn().mockResolvedValue(new Response(null, { status: 200, headers: { etag: '"etag-1"' } }));
        vi.stubGlobal('fetch', putMock);
        const c = new FanvueMcpClient();
        const etag = await c.uploadImageBytes('https://storage.example.com/up?sig=1', new Uint8Array([1, 2, 3]));
        expect(etag).toBe('"etag-1"');
        const [url, init] = putMock.mock.calls[0];
        expect(url).toBe('https://storage.example.com/up?sig=1');
        expect(init.method).toBe('PUT');
        expect(init.headers?.Authorization).toBeUndefined();
    });
    it('uploadImageBytes throws when the PUT fails', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 403 })));
        const c = new FanvueMcpClient();
        const err = await c.uploadImageBytes('https://storage.example.com/up', new Uint8Array([1])).catch((e) => e);
        expect(err).toBeInstanceOf(FanvueMcpError);
        expect(err.code).toBe('UPLOAD_FAILED');
    });
    it('createImagePost calls custom__create-image-post with the documented args', async () => {
        const postResult = {
            uuid: '123e4567-e89b-12d3-a456-426614174000',
            createdAt: '2026-06-12T18:00:00.000Z',
            text: "Tonight's drop 🔥",
            price: 999,
            mediaPreviewUuid: null,
            audience: 'subscribers',
            publishAt: null,
            publishedAt: '2026-06-12T18:00:00.000Z',
            expiresAt: null,
        };
        const fetchMock = stubMcpFlow(postResult);
        const c = await connectedClient();
        const result = await c.createImagePost({
            image: { mediaUuid: 'm1', uploadId: 'up1', etag: '"etag-1"' },
            audience: 'subscribers',
            text: "Tonight's drop 🔥",
            price: 999,
        });
        expect(result.uuid).toBe('123e4567-e89b-12d3-a456-426614174000');
        expect(result.price).toBe(999);
        expect(result.audience).toBe('subscribers');
        const calls = vi.mocked(fetchMock).mock.calls;
        const callFrame = JSON.parse(calls[calls.length - 1][1].body);
        expect(callFrame.method).toBe('tools/call');
        expect(callFrame.params.name).toBe('custom__create-image-post');
        expect(callFrame.params.arguments).toMatchObject({
            image: { mediaUuid: 'm1', uploadId: 'up1', etag: '"etag-1"' },
            audience: 'subscribers',
            text: "Tonight's drop 🔥",
            price: 999,
        });
    });
    it('unwraps text-content envelopes (MCP standard result shape)', async () => {
        const fetchMock = stubMcpFlow({
            content: [{ type: 'text', text: JSON.stringify({ mediaUuid: 'wrapped-1', uploadUrl: 'u' }) }],
        });
        const c = await connectedClient();
        const result = await c.startImageUpload();
        expect(result.mediaUuid).toBe('wrapped-1');
        expect(vi.mocked(fetchMock).mock.calls.length).toBe(3);
    });
});
describe('documented REST endpoints (chats + insights)', () => {
    it('getEarningsSummary hits GET /insights/earnings/summary with version header', async () => {
        const fetchMock = stubMcpFlow({ totals: { gross: 1000 }, period: 'all' });
        const c = await connectedClient();
        const result = await c.getEarningsSummary();
        expect(result).toMatchObject({ totals: { gross: 1000 } });
        const calls = vi.mocked(fetchMock).mock.calls;
        const [url, init] = calls[calls.length - 1];
        expect(url).toBe('https://api.fanvue.com/insights/earnings/summary');
        expect(init.method).toBe('GET');
        expect(init.headers['X-Fanvue-API-Version']).toBe('2025-06-26');
        expect(init.headers.Authorization).toBe('Bearer test-oauth-token');
    });
    it('getInbox hits GET /chats (documented endpoint)', async () => {
        const fetchMock = stubMcpFlow({ items: [], page: 1 });
        const c = await connectedClient();
        const result = await c.getInbox();
        expect(result).toMatchObject({ page: 1 });
        const calls = vi.mocked(fetchMock).mock.calls;
        const [url] = calls[calls.length - 1];
        expect(url).toBe('https://api.fanvue.com/chats');
    });
    it('replyToDM posts to /chats/{userUuid}/message (documented endpoint)', async () => {
        const fetchMock = stubMcpFlow({ messageUuid: 'm-9' });
        const c = await connectedClient();
        const result = await c.replyToDM('fan-123', 'Hey!', { price: 500 });
        expect(result).toMatchObject({ messageUuid: 'm-9' });
        const calls = vi.mocked(fetchMock).mock.calls;
        const [url, init] = calls[calls.length - 1];
        expect(url).toBe('https://api.fanvue.com/chats/fan-123/message');
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body)).toEqual({ text: 'Hey!', price: 500 });
    });
    it('rest endpoint failure surfaces as HTTP_ERROR with status', async () => {
        const fetchMock = vi.fn((url, init) => {
            if (String(url).startsWith('https://api.fanvue.com')) {
                return Promise.resolve(jsonResponse({ error: 'Insufficient scopes' }, 403));
            }
            const body = JSON.parse(init.body);
            if (body.method === 'initialize') {
                return Promise.resolve(jsonResponse({ jsonrpc: '2.0', result: INIT_RESULT, id: body.id }));
            }
            if (body.method === 'tools/list') {
                return Promise.resolve(jsonResponse({ jsonrpc: '2.0', result: TOOLS_RESULT, id: body.id }));
            }
            return Promise.resolve(jsonResponse({ jsonrpc: '2.0', result: {}, id: body.id }));
        });
        vi.stubGlobal('fetch', fetchMock);
        const c = await connectedClient();
        const err = await c.getEarningsSummary().catch((e) => e);
        expect(err).toBeInstanceOf(FanvueMcpError);
        expect(err.code).toBe('HTTP_ERROR');
        expect(err.statusCode).toBe(403);
    });
});
describe('tool surface', () => {
    it('exposes the discovered tool list', async () => {
        stubMcpFlow({});
        const c = await connectedClient();
        expect(c.listTools()).toContain('custom__start-image-upload');
        expect(c.hasTool('custom__create-image-post')).toBe(true);
        expect(c.hasTool('nope')).toBe(false);
    });
});
//# sourceMappingURL=client.test.js.map