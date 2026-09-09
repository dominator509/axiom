'use client';

import { useEffect, useState } from 'react';
import { fetchWithTimeout } from '@/lib/request';

interface KillSwitchState {
  enabled: boolean;
  reason: string;
}

/** Global kill switch banner (F-12) — shown when publishing is halted. */
export default function KillSwitchBanner() {
  const [state, setState] = useState<KillSwitchState | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetchWithTimeout('/api/v1/killswitch', { cache: 'no-store', signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (body?.data) setState({ enabled: body.data.enabled, reason: body.data.reason ?? '' });
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  if (!state?.enabled) return null;

  return (
    <div className="banner" role="alert">
      <strong>⚠ GLOBAL KILL SWITCH ENABLED</strong>
      <span>Publishing is halted{state.reason ? ` — ${state.reason}` : ''}.</span>
    </div>
  );
}
