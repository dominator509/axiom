import { describe, expect, it, vi } from 'vitest';
import type { Platform } from '@axiom/core';
import { createConnector } from './factory.js';

const scopeCases: Array<{ platform: Platform; publish: string; metrics: string }> = [
  { platform: 'tiktok', publish: 'video.publish', metrics: 'video.list' },
  { platform: 'x', publish: 'tweet.write', metrics: 'tweet.read' },
  { platform: 'youtube', publish: 'https://www.googleapis.com/auth/youtube.upload', metrics: 'https://www.googleapis.com/auth/yt-analytics.readonly' },
  { platform: 'reddit', publish: 'submit', metrics: 'read' },
  { platform: 'instagram', publish: 'instagram_content_publish', metrics: 'instagram_manage_insights' },
  { platform: 'facebook', publish: 'pages_manage_posts', metrics: 'pages_read_engagement' },
  { platform: 'threads', publish: 'threads_content_publish', metrics: 'threads_manage_insights' },
];

describe('OAuth granted-scope enforcement', () => {
  it.each(scopeCases)('$platform hides unavailable capability and blocks direct calls', async ({ platform }) => {
    const fetchMock = vi.fn<typeof fetch>();
    const connector = createConnector(platform, {
      accessToken: 'fixture-token',
      extra: { grantedScopes: [] },
    }, fetchMock);

    expect(connector.capability().media).toEqual([]);
    expect(connector.capability().metrics).toEqual([]);
    expect(connector.capability().publish).toBe(false);

    const result = await connector.publish({
      idempotencyKey: `scope-denied-${platform}`,
      caption: 'fixture',
      mediaUrls: ['https://media.example.test/fixture.jpg'],
      options: { mediaType: 'image', subreddit: 'test' },
    });
    expect(result.state).toBe('failed');
    expect(result.error).toMatch(/required permission was not granted/);
    expect(fetchMock).not.toHaveBeenCalled();

    await expect(connector.fetchMetrics('fixture-id')).rejects.toThrow(/required permission was not granted/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(scopeCases)('$platform enables only permissions present in the consent response', ({ platform, publish, metrics }) => {
    const connector = createConnector(platform, {
      accessToken: 'fixture-token',
      extra: { grantedScopes: [publish, metrics] },
    });
    expect(connector.capability().media.length).toBeGreaterThan(0);
    expect(connector.capability().metrics.length).toBeGreaterThan(0);
  });

  it('preserves legacy non-OAuth/manual connector behavior when no scope manifest exists', () => {
    const connector = createConnector('x', { accessToken: 'legacy-token' });
    expect(connector.capability().media).toContain('text');
    expect(connector.capability().metrics).toContain('likes');
  });
});
