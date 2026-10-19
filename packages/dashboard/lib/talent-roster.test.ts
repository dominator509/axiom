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

describe('talent roster cursor transition (hub #35 review note)', () => {
  it('scopes a creation receipt to the first page instead of leaking it onto a later cursor', () => {
    const created = profile('created', 'New Talent');
    const pageTwo = [profile('page2-a'), profile('page2-b')];
    // TalentRoster passes [] as the created list whenever a cursor is present.
    const firstPage = mergeTalentRosterProfiles([profile('existing')], [created]);
    const laterPage = mergeTalentRosterProfiles(pageTwo, []);
    expect(firstPage.map(row => row.id)).toEqual(['created', 'existing']);
    expect(laterPage.map(row => row.id)).toEqual(['page2-a', 'page2-b']);
    expect(laterPage.some(row => row.id === 'created')).toBe(false);
  });
});
