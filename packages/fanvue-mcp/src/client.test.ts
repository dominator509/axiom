// ─── FanvueMcpClient — Vitest Suite ───
import { describe, it, expect, vi, afterEach } from 'vitest';
import { FanvueMcpClient, FanvueMcpError } from './client.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const CREDS = {
  endpoint: 'https://mcp.fanvue.test/',
  apiKey: 'test-api-key-123',
  modelId: 'model-1',
};

afterEach(() => vi.unstubAllGlobals());

async function connectedClient(): Promise<FanvueMcpClient> {
  const c = new FanvueMcpClient();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
    jsonResponse({ connected: true, modelId: 'model-1', token: 'tok-123', expiresAt: '2099-01-01T00:00:00Z' }),
  ));
  await c.connect(CREDS);
  vi.unstubAllGlobals();
  return c;
}

describe('connect', () => {
  it('rejects invalid credentials before any network call', async () => {
    const c = new FanvueMcpClient();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(c.connect({ endpoint: 'not-a-url', apiKey: 'k' })).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('connects, stores the token, and strips trailing slashes from endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({ connected: true, modelId: 'model-1', token: 'tok-123', expiresAt: '2099-01-01T00:00:00Z' }),
    ));
    const c = new FanvueMcpClient();
    const result = await c.connect(CREDS);
    expect(result.connected).toBe(true);
    expect(c['token']).toBe('tok-123');
    expect(c['connected']).toBe(true);

    const [url, init] = (vi.mocked(fetch).mock.calls[0] as unknown as [string, RequestInit]);
    expect(url).toBe('https://mcp.fanvue.test/auth/connect');
    expect(init.headers).toMatchObject({ 'X-API-Key': 'test-api-key-123' });
    expect(JSON.parse(init.body as string)).toEqual({ model_id: 'model-1' });
  });

  it('throws FanvueMcpError with code AUTH_FAILED on non-ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'bad' }, 401)));
    const c = new FanvueMcpClient();
    const err = await c.connect(CREDS).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FanvueMcpError);
    expect((err as FanvueMcpError).code).toBe('AUTH_FAILED');
    expect((err as FanvueMcpError).statusCode).toBe(401);
  });
});

describe('authenticated calls', () => {
  it('uploadImage requires an active connection', async () => {
    const c = new FanvueMcpClient();
    const err = await c.uploadImage('aGVsbG8=', 'x.jpg').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FanvueMcpError);
    expect((err as FanvueMcpError).code).toBe('NOT_CONNECTED');
  });

  it('uploadImage posts base64 to /assets/upload with bearer auth', async () => {
    const c = await connectedClient();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({ asset_id: 'a1', url: 'https://cdn.test/a1.jpg', width: 10, height: 10, size_bytes: 100 }),
    ));
    const result = await c.uploadImage('aGVsbG8=', 'x.jpg');
    expect(result.asset_id).toBe('a1');
    const [url, init] = (vi.mocked(fetch).mock.calls[0] as unknown as [string, RequestInit]);
    expect(url).toBe('https://mcp.fanvue.test/assets/upload');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tok-123' });
    expect(JSON.parse(init.body as string)).toMatchObject({ filename: 'x.jpg' });
  });

  it('createPost posts to /posts', async () => {
    const c = await connectedClient();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({ post_id: 'p1', url: 'https://fanvue.test/p1', platform: 'fanvue', created_at: '2026-07-31T00:00:00Z' }),
    ));
    const result = await c.createPost('a1', 'hello #test');
    expect(result.post_id).toBe('p1');
    const [, init] = (vi.mocked(fetch).mock.calls[0] as unknown as [string, RequestInit]);
    expect(JSON.parse(init.body as string)).toMatchObject({ asset_id: 'a1', caption: 'hello #test' });
  });

  it('getAnalytics GETs /analytics and returns the summary', async () => {
    const c = await connectedClient();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({
        model_id: 'model-1',
        timeframe: '7d',
        summary: { total_views: 10, total_likes: 2, total_comments: 3, total_shares: 4, avg_engagement_rate: 0.05 },
      }),
    ));
    const result = await c.getAnalytics('p1');
    expect(result.summary.total_views).toBe(10);
  });

  it('getInbox GETs the inbox for a model', async () => {
    const c = await connectedClient();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({ messages: [{ id: 'm1' }] }),
    ));
    const result = await c.getInbox('model-1');
    expect(result.messages).toHaveLength(1);
  });

  it('replyToDM POSTs a reply', async () => {
    const c = await connectedClient();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({ message_id: 'm2', status: 'sent' }),
    ));
    const result = await c.replyToDM('model-1', 'm1', 'Thanks!');
    expect((result as { message_id?: string }).message_id).toBe('m2');
  });
});
