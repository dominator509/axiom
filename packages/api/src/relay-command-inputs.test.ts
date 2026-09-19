import { describe, expect, it } from 'vitest';
import {
  relayCaptionUpdate,
  relayConnectionIds,
  relayScheduledFor,
} from './relay-command-inputs.js';

describe('relay command input validation', () => {
  it('uses the only caption platform when no platform is supplied', () => {
    expect(relayCaptionUpdate({ caption: 'Updated copy' }, { instagram: 'Old copy' })).toEqual({
      platform: 'instagram',
      caption: 'Updated copy',
    });
  });

  it('requires an explicit platform for multiple caption variants', () => {
    expect(() =>
      relayCaptionUpdate({ caption: 'Updated copy' }, { instagram: 'Old', tiktok: 'Old' }),
    ).toThrow('requires a platform when captions are ambiguous');
  });

  it('accepts the scheduledFor alias and rejects stale timestamps', () => {
    const now = Date.parse('2026-09-07T16:00:00.000Z');
    expect(
      relayScheduledFor({ scheduledFor: '2026-09-07T17:00:00.000Z' }, 'reschedule', now),
    ).toEqual(new Date('2026-09-07T17:00:00.000Z'));
    expect(() =>
      relayScheduledFor({ scheduledFor: '2026-09-07T15:00:00.000Z' }, 'reschedule', now),
    ).toThrow('requires a valid future timestamp');
  });

  it('rejects an unsupported platform and blank captions', () => {
    expect(() => relayCaptionUpdate({ caption: ' ' }, { instagram: 'Old' })).toThrow(
      'requires a non-empty caption',
    );
    expect(() =>
      relayCaptionUpdate({ platform: 'not-a-platform', caption: 'Updated' }, {}),
    ).toThrow("unsupported caption platform 'not-a-platform'");
  });

  it('validates per-platform connection selections', () => {
    expect(relayConnectionIds({ connectionIds: { instagram: 'connection-1' } })).toEqual({
      instagram: 'connection-1',
    });
    expect(() => relayConnectionIds({ connectionIds: ['connection-1'] })).toThrow(
      'must be an object keyed by platform',
    );
    expect(() => relayConnectionIds({ connectionIds: { instagram: '' } })).toThrow(
      'must be a non-empty string',
    );
  });
});
