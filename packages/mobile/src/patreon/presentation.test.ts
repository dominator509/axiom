import { describe, expect, it } from 'vitest';

import type { MobileModelProfile, MobilePatreonRecord } from '../api/endpoints';
import {
  boundedRecordList,
  canManagePatreon,
  capabilityBoundaryCopy,
  selectVisibleModel,
  syncButtonLabel,
} from './presentation';

const models: MobileModelProfile[] = [
  { id: 'model-1', displayName: 'D James', handle: 'djames', avatarUrl: null, isActive: true },
  { id: 'model-2', displayName: 'Nova', handle: 'nova', avatarUrl: null, isActive: true },
];

describe('mobile Patreon presentation contract', () => {
  it('keeps model selection inside the server-returned visible list', () => {
    expect(selectVisibleModel(models, 'model-2')?.id).toBe('model-2');
    expect(selectVisibleModel(models, 'not-visible')?.id).toBe('model-1');
    expect(selectVisibleModel([], 'not-visible')).toBeNull();
  });

  it('allows connect/sync controls only to managing roles', () => {
    expect(canManagePatreon('owner')).toBe(true);
    expect(canManagePatreon('operator')).toBe(true);
    expect(canManagePatreon('chatter')).toBe(false);
    expect(capabilityBoundaryCopy(false)).toContain('cannot connect');
    expect(capabilityBoundaryCopy(true)).toContain('unavailable by design');
  });

  it('shows continuation state and bounds rendered records', () => {
    expect(syncButtonLabel('members', null, false)).toBe('Sync members');
    expect(syncButtonLabel('members', 'cursor-2', false)).toBe('Sync next members page');
    expect(syncButtonLabel('posts', null, true)).toBe('Syncing…');
    const records = Array.from({ length: 40 }, (_, index): MobilePatreonRecord => ({
      id: `row-${index}`,
      providerRef: '••••',
      title: 'Post',
      detail: 'safe',
      updatedAt: null,
      isPublic: null,
    }));
    expect(boundedRecordList(records)).toHaveLength(25);
  });
});
