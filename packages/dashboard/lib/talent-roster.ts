import type { ModelProfile } from './api';

export type TalentRosterProfile = Pick<ModelProfile, 'id' | 'displayName' | 'handle' | 'bio' | 'isActive'>;

export const TALENT_PROFILE_CREATED_EVENT = 'axiom:talent-profile-created';

export function parseTalentRosterProfile(value: unknown): TalentRosterProfile | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const profile = value as Record<string, unknown>;
  if (typeof profile.id !== 'string' || !profile.id
    || typeof profile.displayName !== 'string'
    || typeof profile.handle !== 'string'
    || !(typeof profile.bio === 'string' || profile.bio === null)
    || typeof profile.isActive !== 'boolean') return null;
  return {
    id: profile.id,
    displayName: profile.displayName,
    handle: profile.handle,
    bio: profile.bio,
    isActive: profile.isActive,
  };
}

export function mergeTalentRosterProfiles(
  serverProfiles: TalentRosterProfile[],
  createdProfiles: TalentRosterProfile[],
): TalentRosterProfile[] {
  const seen = new Set<string>();
  return [...createdProfiles, ...serverProfiles].filter(profile => {
    if (seen.has(profile.id)) return false;
    seen.add(profile.id);
    return true;
  });
}

export function publishTalentProfileCreated(profile: TalentRosterProfile): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<TalentRosterProfile>(TALENT_PROFILE_CREATED_EVENT, { detail: profile }));
}
