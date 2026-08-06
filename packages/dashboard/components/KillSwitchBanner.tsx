'use client';

import { useEffect, useState } from 'react';

interface KillSwitchState {
  enabled: boolean;
  reason: string;
}

/** Global kill switch banner (F-12) — shown when publishing is halted. */
export default function KillSwitchBanner() {
  const [state, setState] = useState<KillSwitchState | null>(null);

  useEffect(() => {
    fetch('/api/v1/killswitch', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (body?.data) setState({ enabled: body.data.enabled, reason: body.data.reason ?? '' });
      })
      .catch(() => {});
  }, []);

  if (!state?.enabled) return null;

  return (
    <div className="banner" role="alert">
      <strong>⚠ GLOBAL KILL SWITCH ENABLED</strong>
      <span>Publishing is halted{state.reason ? ` — ${state.reason}` : ''}.</span>
    </div>
  );
}
