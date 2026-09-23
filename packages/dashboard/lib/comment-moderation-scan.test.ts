import { describe, expect, it } from 'vitest';
import { moderationScanRequest, nextModerationScanProgress } from './comment-moderation-scan.js';

describe('comment moderation scan pagination', () => {
  it('starts a scan at the first provider page', () => {
    expect(moderationScanRequest('connection-1', ' post-1 ', null)).toEqual({
      key: 'connection-1\u001fpost-1',
      body: { connectionId: 'connection-1', postId: 'post-1' },
    });
  });

  it('sends the saved opaque cursor only for the same connection and post', () => {
    const progress = { key: 'connection-1\u001fpost-1', cursor: 'provider-cursor-2' };
    expect(moderationScanRequest('connection-1', 'post-1', progress).body).toEqual({
      connectionId: 'connection-1', postId: 'post-1', cursor: 'provider-cursor-2',
    });
    expect(moderationScanRequest('connection-2', 'post-1', progress).body).toEqual({
      connectionId: 'connection-2', postId: 'post-1',
    });
    expect(moderationScanRequest('connection-1', 'post-2', progress).body).toEqual({
      connectionId: 'connection-1', postId: 'post-2',
    });
  });

  it('clears continuation state when the provider has no next page', () => {
    expect(nextModerationScanProgress('connection-1\u001fpost-1', 'provider-cursor-2')).toEqual({
      key: 'connection-1\u001fpost-1', cursor: 'provider-cursor-2',
    });
    expect(nextModerationScanProgress('connection-1\u001fpost-1', null)).toBeNull();
    expect(nextModerationScanProgress('connection-1\u001fpost-1', '')).toBeNull();
  });
});
