// ─── Discord Connector — Vitest Suite ───
// Covers: capability(), validate(), publish() embed construction (caption
// truncation, linkUrl, image/video media), missing webhook, fetchMetrics()
// empty metrics, revoke() parsing + deletion.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { DiscordConnector } from './discord.js';
import type { ConnectorAuth, ConnectorPublishInput } from './types.js';

const AUTH: ConnectorAuth = {
  accessToken: 'discord-token',
  extra: { webhookUrl: 'https://discord.com/api/webhooks/12345/secret-token' },
};

function input(overrides: Partial<ConnectorPublishInput> = {}): ConnectorPublishInput {
  return {
    idempotencyKey: `dk-${Math.random().toString(36).slice(2)}`,
    caption: 'Check this out',
    mediaUrls: ['https://cdn.example.com/photo.jpg'],
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DiscordConnector', () => {
  it('declares discord capabilities (link_share, no refresh metrics)', () => {
    const c = new DiscordConnector(AUTH);
    expect(c.platform).toBe('discord');
    expect(c.publishMode).toBe('link_share');
    const cap = c.capability();
    expect(cap.media).toEqual(['image', 'video']);
    expect(cap.maxCaptionLength).toBe(2000);
    expect(cap.metrics).toEqual([]);
    expect(cap.refreshMetrics).toBe(false);
  });

  it('validates via validatePublish', async () => {
    const c = new DiscordConnector(AUTH);
    expect((await c.validate(input())).valid).toBe(true);
    expect((await c.validate(input({ mediaUrls: [] }))).valid).toBe(false);
  });
});

describe('publish', () => {
  it('sends an embed with caption, image, and footer', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ id: 'msg-1', type: 1, channel_id: 'chan-1', guild_id: 'guild-1' }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const c = new DiscordConnector(AUTH);
    const result = await c.publish(input());

    expect(result.state).toBe('published');
    expect(result.remoteId).toBe('msg-1');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://discord.com/api/webhooks/12345/secret-token?wait=true');
    expect(init.method).toBe('POST');

    const payload = JSON.parse(init.body as string) as { embeds: Array<Record<string, unknown>> };
    const embed = payload.embeds[0];
    expect(embed.title).toBe('Check this out');
    expect(embed.color).toBe(0x5865f2);
    expect(embed.footer).toEqual({ text: 'Posted via Axiom' });
    expect(embed.image).toEqual({ url: 'https://cdn.example.com/photo.jpg' });
    expect(embed.description).toBeUndefined();
  });

  it('truncates captions over 256 chars into the title and keeps full text in description', async () => {
    const longCaption = 'x'.repeat(300);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ id: 'msg-2', type: 1, channel_id: 'c' }));
    vi.stubGlobal('fetch', fetchMock);

    const c = new DiscordConnector(AUTH);
    await c.publish(input({ caption: longCaption }));

    const payload = JSON.parse(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
    ) as {
      embeds: Array<Record<string, string>>;
    };
    const embed = payload.embeds[0];
    expect(embed.title).toBe('x'.repeat(253) + '...');
    expect(embed.description).toBe(longCaption);
  });

  it('uses linkUrl as embed url and rewrites the title when truncated', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ id: 'msg-3', type: 1, channel_id: 'c' }));
    vi.stubGlobal('fetch', fetchMock);

    const c = new DiscordConnector(AUTH);
    await c.publish(
      input({
        caption: 'y'.repeat(300),
        options: { linkUrl: 'https://fanvue.com/post/9' },
      }),
    );

    const payload = JSON.parse(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
    ) as {
      embeds: Array<Record<string, string>>;
    };
    const embed = payload.embeds[0];
    expect(embed.url).toBe('https://fanvue.com/post/9');
    expect(embed.description).toBe('y'.repeat(300));
    expect(embed.title).toBe('Shared via Axiom');
  });

  it('attaches video media as embed.video', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ id: 'msg-4', type: 1, channel_id: 'c' }));
    vi.stubGlobal('fetch', fetchMock);

    const c = new DiscordConnector(AUTH);
    await c.publish(input({ mediaUrls: ['https://cdn.example.com/clip.mp4'] }));

    const payload = JSON.parse(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
    ) as {
      embeds: Array<{ video?: { url: string }; image?: { url: string } }>;
    };
    const embed = payload.embeds[0];
    expect(embed.video).toEqual({ url: 'https://cdn.example.com/clip.mp4' });
    expect(embed.image).toEqual({ url: 'https://cdn.example.com/clip.mp4' });
  });

  it('fails fast when no webhook URL is configured', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const c = new DiscordConnector({ accessToken: 't' });
    const result = await c.publish(input());
    expect(result.state).toBe('failed');
    expect(result.error).toContain('webhook URL in auth.extra.webhookUrl');
  });

  it('returns failed when the webhook call fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ message: 'Unknown Webhook' }, 404)),
    );
    const c = new DiscordConnector(AUTH);
    const result = await c.publish(input());
    expect(result.state).toBe('failed');
    expect(result.error).toContain('404');
  });

  it('treats a successful 204 webhook response as published without retrying', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    const c = new DiscordConnector(AUTH);
    const result = await c.publish(input({ idempotencyKey: 'discord-204' }));

    expect(result).toMatchObject({ state: 'published', remoteId: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('fetchMetrics', () => {
  it('returns an empty metric set for webhook-based posting', async () => {
    const c = new DiscordConnector(AUTH);
    const metrics = await c.fetchMetrics('msg-1');
    expect(metrics.postId).toBe('msg-1');
    expect(metrics.metrics).toEqual({ views: 0, likes: 0, comments: 0, shares: 0 });
  });
});

describe('revoke', () => {
  it('parses the webhook id from the URL and deletes it', async () => {
    // 204 responses must have no body — Response rejects a body on 204
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    const c = new DiscordConnector(AUTH);
    await c.revoke();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://discord.com/api/webhooks/12345/secret-token');
    expect(init.method).toBe('DELETE');
    expect(c.auth.accessToken).toBe('');
    expect(c.auth.refreshToken).toBeUndefined();
    expect(c.auth.expiresAt).toBe(0);
  });

  it('skips when there is no webhook URL', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const c = new DiscordConnector({ accessToken: 't' });
    await expect(c.revoke()).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips when the webhook id cannot be parsed', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const c = new DiscordConnector({
      accessToken: 't',
      extra: { webhookUrl: 'https://discord.com/api/not-a-webhook' },
    });
    await expect(c.revoke()).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('logs a warning but still clears auth when deletion fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 500)));
    const c = new DiscordConnector(AUTH);
    await c.revoke();
    expect(c.auth.accessToken).toBe('');
    expect(
      c.getLogs().some((l) => l.level === 'warn' && l.message.includes('deletion warned')),
    ).toBe(true);
  });
});
