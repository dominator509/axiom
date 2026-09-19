import type {
  MobileModelProfile,
  MobilePatreonRecord,
  PatreonResource,
} from '../api/endpoints';

export const PATREON_MANAGE_ROLES = new Set(['owner', 'manager', 'operator']);

export function canManagePatreon(role: string | null | undefined): boolean {
  return role !== null && role !== undefined && PATREON_MANAGE_ROLES.has(role);
}

export function selectVisibleModel(models: MobileModelProfile[], selectedId: string | null): MobileModelProfile | null {
  if (selectedId) {
    const selected = models.find(model => model.id === selectedId);
    if (selected) return selected;
  }
  return models[0] ?? null;
}

export function syncButtonLabel(resource: PatreonResource, nextCursor: string | null, busy: boolean): string {
  if (busy) return 'Syncing…';
  if (nextCursor && resource !== 'campaign') return `Sync next ${resource} page`;
  return `Sync ${resource}`;
}

export function boundedRecordList(records: MobilePatreonRecord[], max = 25): MobilePatreonRecord[] {
  return records.slice(0, Math.max(0, Math.min(max, 25)));
}

export function capabilityBoundaryCopy(canManage: boolean): string {
  return canManage
    ? 'Patreon publishing, DMs, payouts, member removal and revenue analytics remain unavailable by design.'
    : 'Your role can view assigned community data, but cannot connect or synchronize Patreon.';
}
