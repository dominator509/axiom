'use client';

import { useEffect, useState } from 'react';
import {
  KILLSWITCH_CHANGED_EVENT,
  type KillSwitchChangedDetail,
} from '@/lib/killswitch-events';

interface KillSwitchState {
  enabled: boolean;
  reason: string;
}

/** Global kill switch banner (F-12) — shown when publishing is halted. */
export default function KillSwitchBanner() {
  const [state, setState] = useState<KillSwitchState | null>(null);

  useEffect(() => {
    let cancelled = false;

    function apply(enabled: boolean, reason: string) {
      if (!cancelled) setState({ enabled, reason });
    }

    function refresh() {
      fetch('/api/v1/killswitch', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((body) => {
          if (body?.data) apply(Boolean(body.data.enabled), body.data.reason ?? '');
        })
        .catch(() => {});
    }

    function onChanged(ev: Event) {
      const detail = (ev as CustomEvent<KillSwitchChangedDetail>).detail;
      if (detail && typeof detail.enabled === 'boolean') {
        apply(detail.enabled, detail.reason ?? '');
      }
      // Confirm against the API so banner state stays truthful if the event
      // detail is incomplete or a concurrent flip landed first.
      refresh();
    }

    refresh();
    window.addEventListener(KILLSWITCH_CHANGED_EVENT, onChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(KILLSWITCH_CHANGED_EVENT, onChanged);
    };
  }, []);

  if (!state?.enabled) return null;

  return (
    <div className="banner" role="alert">
      <strong>⚠ GLOBAL KILL SWITCH ENABLED</strong>
      <span>Publishing is halted{state.reason ? ` — ${state.reason}` : ''}.</span>
    </div>
  );
}
