import { afterEach, describe, expect, it, vi } from 'vitest';
import { SnapchatConnector } from './snapchat.js';
import type { ConnectorAuth, ConnectorPublishInput } from './types.js';

const API_AUTH: ConnectorAuth = {
  accessToken: 'snap-token',
  externalUserId: 'snap-user',
  extra: { snapchatProfileId: 'profile-1', snapchatUsername: 'creator', grantedScopes: ['snapchat-profile-api'] },
};

function input(overrides: Partial<ConnectorPublishInput> = {}): ConnectorPublishInput {
  return { idempotencyKey: 'snap-test-key', caption: 'A snap', mediaUrls: ['https://cdn.example.test/story.jpg'], ...overrides };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function ok(body: Record<string, unknown> = {}): Response {
  return jsonResponse({ request_status: 'SUCCESS', ...body });
}

afterEach(() => vi.restoreAllMocks());

describe('Snapchat Public Profile API and manual assist', () => {
  it('advertises API Story posting and metrics only when an approved profile is configured', () => {
    const connector = new SnapchatConnector(API_AUTH);
    expect(connector.publishMode).toBe('api');
    expect(connector.capability()).toMatchObject({ media: ['image', 'video', 'story'], maxMediaCount: 1, metrics: ['views', 'reach', 'favorites'], refreshMetrics: true });
  });

  it('creates a typed, honest manual handoff when there is no approved API profile', async () => {
    const fetchMock = vi.fn();
    const connector = new SnapchatConnector({ accessToken: '', extra: { snapchatProfileUrl: 'https://www.snapchat.com/add/creator' } }, fetchMock);
    const result = await connector.publish(input());
    expect(connector.publishMode).toBe('assisted');
    expect(result).toMatchObject({ state: 'manual_assist', remoteId: null, handoff: {
      platform: 'snapchat', type: 'assisted_publish', caption: 'A snap', assets: ['https://cdn.example.test/story.jpg'], handoffUrl: 'https://www.snapchat.com/add/creator',
    } });
    expect(result.error).toContain('Human action required');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not enable API publishing from a token/profile without the Public Profile scope manifest', async () => {
    const fetchMock = vi.fn();
    const connector = new SnapchatConnector({
      accessToken: 'unscoped-token',
      extra: { snapchatProfileId: 'profile-1' },
    }, fetchMock);

    const result = await connector.publish(input());

    expect(connector.publishMode).toBe('assisted');
    expect(result.state).toBe('manual_assist');
    expect(result.handoff?.type).toBe('assisted_publish');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('blocks automatic videos outside Snap Story format, duration, and resolution constraints', async () => {
    const connector = new SnapchatConnector(API_AUTH, vi.fn() as typeof fetch);
    const report = await connector.validate(input({
      mediaUrls: ['https://cdn.example.test/story.mp4'],
      options: { mediaType: 'video', mediaMimeType: 'video/webm', mediaDurationSeconds: 61, mediaWidth: 480, mediaHeight: 800 },
    }));

    expect(report.valid).toBe(false);
    expect(report.errors.map(error => error.message)).toEqual(expect.arrayContaining([
      'Snapchat Story video must be MP4',
      'Snapchat Story video duration must be between 5 and 60 seconds',
      'Snapchat Story video resolution must be at least 540x960',
    ]));
  });

  it('fails closed for automatic video publishing when stored eligibility metadata is incomplete', async () => {
    const connector = new SnapchatConnector(API_AUTH, vi.fn() as typeof fetch);
    const report = await connector.validate(input({
      mediaUrls: ['https://cdn.example.test/story.mp4'],
      options: { mediaType: 'video' },
    }));

    expect(report.valid).toBe(false);
    expect(report.errors[0]?.message).toContain('cannot be verified without video MIME type, video duration, video dimensions');
  });

  it('does not claim API video eligibility for manual-assist connections with unknown metadata', async () => {
    const connector = new SnapchatConnector({ accessToken: '', extra: {} }, vi.fn() as typeof fetch);
    const report = await connector.validate(input({
      mediaUrls: ['https://cdn.example.test/story.mp4'],
      options: { mediaType: 'video' },
    }));

    expect(report.valid).toBe(true);
    expect(report.infos.some(info => info.message.includes('eligibility cannot be verified'))).toBe(true);
  });

  it('rejects an actual non-MP4 video response before starting a Story upload', async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      if (String(url) === 'https://cdn.example.test/story.mp4') {
        return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'video/webm' } });
      }
      throw new Error(`unexpected provider request ${String(url)}`);
    });
    const connector = new SnapchatConnector(API_AUTH, fetchMock as typeof fetch);
    const result = await connector.publish(input({
      mediaUrls: ['https://cdn.example.test/story.mp4'],
      options: { mediaType: 'video', mediaMimeType: 'video/mp4', mediaDurationSeconds: 30, mediaWidth: 1080, mediaHeight: 1920 },
    }));

    expect(result.state).toBe('failed');
    expect(result.error).toContain('video must be MP4');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('accepts documented video metadata at the lower and upper duration bounds', async () => {
    const connector = new SnapchatConnector(API_AUTH, vi.fn() as typeof fetch);
    for (const duration of [5, 60]) {
      const report = await connector.validate(input({
        mediaUrls: ['https://cdn.example.test/story.mp4'],
        options: { mediaType: 'video', mediaMimeType: 'video/mp4', mediaDurationSeconds: duration, mediaWidth: 540, mediaHeight: 960 },
      }));
      expect(report.valid).toBe(true);
    }
  });

  it('uses the documented encrypted-media, multipart, and Story publish sequence, then waits for provider readback', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = vi.fn(async (inputUrl: string | URL, init?: RequestInit) => {
      const url = String(inputUrl);
      calls.push({ url, init });
      if (url === 'https://cdn.example.test/story.jpg') return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } });
      if (url.endsWith('/stories?limit=100')) return ok({ stories: [] });
      if (url.endsWith('/media')) return ok({ media_id: 'media-1', add_path: '/us/v1/public_profiles/profile-1/media/media-1/multipart-upload', finalize_path: '/us/v1/public_profiles/profile-1/media/media-1/multipart-upload' });
      if (url.endsWith('/multipart-upload')) return ok();
      if (url.endsWith('/stories') && init?.method === 'POST') return ok({ request_id: 'request-1' });
      throw new Error(`unexpected URL ${url}`);
    });
    const connector = new SnapchatConnector(API_AUTH, fetchMock as typeof fetch);
    const result = await connector.publish(input());

    expect(result.state).toBe('pending');
    expect(result.remoteId).toMatch(/^snap-story-pending:/);
    expect(calls.map(call => call.url)).toEqual([
      'https://cdn.example.test/story.jpg',
      'https://businessapi.snapchat.com/v1/public_profiles/profile-1/stories?limit=100',
      'https://businessapi.snapchat.com/v1/public_profiles/profile-1/media',
      'https://businessapi.snapchat.com/us/v1/public_profiles/profile-1/media/media-1/multipart-upload',
      'https://businessapi.snapchat.com/us/v1/public_profiles/profile-1/media/media-1/multipart-upload',
      'https://businessapi.snapchat.com/v1/public_profiles/profile-1/stories',
      'https://businessapi.snapchat.com/v1/public_profiles/profile-1/stories?limit=100',
    ]);
    const createBody = JSON.parse(String(calls[2]?.init?.body)) as { key: string; iv: string; type: string };
    expect(Buffer.from(createBody.key, 'base64')).toHaveLength(32);
    expect(Buffer.from(createBody.iv, 'base64')).toHaveLength(16);
    expect(createBody.type).toBe('IMAGE');
    expect((calls[3]?.init?.body as FormData).get('action')).toBe('ADD');
    expect((calls[4]?.init?.body as FormData).get('action')).toBe('FINALIZE');
  });

  it('reconciles the pending Story by provider readback without reposting', async () => {
    let postCount = 0;
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      if (init?.method === 'POST') postCount += 1;
      return ok({ stories: [{ sub_request_status: 'SUCCESS', story: { id: 'story-1', created_at: new Date().toISOString() } }] });
    });
    const connector = new SnapchatConnector(API_AUTH, fetchMock as typeof fetch);
    const result = await connector.publish(input({ options: { publishId: `snap-story-pending:${Buffer.from(JSON.stringify({ requestId: 'request-1', startedAt: new Date(Date.now() - 1000).toISOString(), knownStoryIds: [] })).toString('base64url')}` } }));
    expect(result).toMatchObject({ state: 'published', remoteId: 'story-1', postUrl: 'https://www.snapchat.com/add/creator' });
    expect(postCount).toBe(0);
  });

  it('maps only documented Story statistics and rejects a provider failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ request_status: 'SUCCESS', assets: [{ sub_request_status: 'SUCCESS', timeseries: [{ fields: [
      { field: { field_name: 'STORY_VIEWS' }, stats: [{ value: '42' }] },
      { field: { field_name: 'STORY_UNIQUES' }, stats: [{ value: '37' }] },
      { field: { field_name: 'STORY_FAVORITES' }, stats: [{ value: '3' }] },
    ] }] }] }));
    const connector = new SnapchatConnector(API_AUTH, fetchMock as typeof fetch);
    expect((await connector.fetchMetrics('story-1')).metrics).toEqual({ views: 42, reach: 37, favorites: 3 });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://businessapi.snapchat.com/v1/public_profiles/profile-1/stories/story-1/stats?assetType=STORY&granularity=LIFETIME');

    const failing = new SnapchatConnector(API_AUTH, vi.fn().mockResolvedValue(jsonResponse({ request_status: 'ERROR' }, 403)) as typeof fetch);
    await expect(failing.fetchMetrics('story-1')).rejects.toThrow('HTTP 403');
  });

  it('rejects provider-supplied upload paths outside Snapchat before forwarding authorization', async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      const value = String(url);
      if (value.startsWith('https://cdn.example.test')) return new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/jpeg' } });
      if (value.endsWith('/stories?limit=100')) return ok({ stories: [] });
      return ok({ media_id: 'media-1', add_path: 'https://attacker.example/upload', finalize_path: '/finalize' });
    });
    const connector = new SnapchatConnector(API_AUTH, fetchMock as typeof fetch);
    const result = await connector.publish(input());
    expect(result.state).toBe('failed');
    expect(result.error).toContain('unsafe upload path');
    expect(fetchMock.mock.calls.some(call => String(call[0]).startsWith('https://attacker.example'))).toBe(false);
  });

  it('revokes only with explicitly stored application credentials and does not call fake Snap Kit routes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const connector = new SnapchatConnector({ ...API_AUTH, extra: { ...API_AUTH.extra, snapchatClientId: 'app-id', snapchatClientSecret: 'app-secret' } }, fetchMock as typeof fetch);
    await connector.revoke();
    expect(fetchMock).toHaveBeenCalledWith('https://accounts.snapchat.com/login/oauth2/revoke', expect.objectContaining({ method: 'POST' }));
    expect(new URLSearchParams(String(fetchMock.mock.calls[0]?.[1]?.body)).get('token')).toBe('snap-token');
  });
});
