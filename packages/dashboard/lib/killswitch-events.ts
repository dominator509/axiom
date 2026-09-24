// Shared client signal so KillSwitchControl can wake KillSwitchBanner after
// engage/restore. router.refresh() only re-renders server components; the
// layout-mounted banner is a client component that would otherwise keep its
// mount-time fetch result until a full reload.

export const KILLSWITCH_CHANGED_EVENT = 'axiom:killswitch-changed';

export type KillSwitchChangedDetail = {
  enabled: boolean;
  reason?: string;
};

export function notifyKillSwitchChanged(detail: KillSwitchChangedDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<KillSwitchChangedDetail>(KILLSWITCH_CHANGED_EVENT, { detail }),
  );
}
