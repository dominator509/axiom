import { describe, expect, it } from 'vitest';
import { mergeTalentRosterProfiles, parseTalentRosterProfile } from './talent-roster';

const profile = (id: string, displayName = id) => ({
  id, displayName, handle: id, bio: null, isActive: true,
});

describe('talent roster creation receipts', () => {
  it('accepts only a usable profile receipt from the create endpoint', () => {
    expect(parseTalentRosterProfile(profile('new-id', 'New Talent'))).toEqual(profile('new-id', 'New Talent'));
    expect(parseTalentRosterProfile({ ...profile('new-id'), isActive: 'true' })).toBeNull();
    expect(parseTalentRosterProfile(null)).toBeNull();
  });

  it('shows a newly created profile once while refreshed server data catches up', () => {
    const created = profile('created', 'New Talent');
    const existing = profile('existing');
    expect(mergeTalentRosterProfiles([existing], [created])).toEqual([created, existing]);
    expect(mergeTalentRosterProfiles([created, existing], [created])).toEqual([created, existing]);
  });
});
