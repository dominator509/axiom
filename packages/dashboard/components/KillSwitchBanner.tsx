'use client';

import { useEffect, useState } from 'react';
import { fetchWithTimeout } from '@/lib/request';
import { readDashboardJson } from '@/lib/response';

interface KillSwitchState {
  enabled: boolean;
  reason: string;
}

/** Global kill switch banner (F-12) — shown when publishing is halted. */
export default function KillSwitchBanner() {
  const [state, setState] = useState<KillSwitchState | 'unavailable' | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let next: ReturnType<typeof setTimeout> | undefined;
    async function check() {
      let retry = true;
      try {
        const response = await fetchWithTimeout('/api/v1/killswitch', {
          cache: 'no-store', signal: controller.signal,
        }, 10_000);
        if (response.status === 401 || response.status === 403) retry = false;
        if (!response.ok) throw new Error('Safety status unavailable');
        const body = await readDashboardJson<{ data?: { enabled?: unknown; reason?: unknown } }>(response);
        if (typeof body?.data?.enabled !== 'boolean' || typeof body.data.reason !== 'string'
          || body.data.reason.length > 500) throw new Error('Invalid safety status');
        if (!controller.signal.aborted) setState({ enabled: body.data.enabled, reason: body.data.reason });
      } catch {
        if (!controller.signal.aborted) setState('unavailable');
      } finally {
        // Refresh sequentially: slow requests must not create overlapping polls.
        if (retry && !controller.signal.aborted) next = setTimeout(() => void check(), 15_000);
      }
    }
    void check();
    return () => { controller.abort(); clearTimeout(next); };
  }, []);

  if (state === null) return <div className="banner" role="status">Checking workspace safety status…</div>;
  if (state === 'unavailable') return (
    <div className="banner" role="alert">
      <strong>Safety status unavailable</strong>
      <span>Publishing permission could not be confirmed. Reload or sign in again if this persists.</span>
    </div>
  );
  if (!state.enabled) return null;

  return (
    <div className="banner" role="alert">
      <strong>⚠ GLOBAL KILL SWITCH ENABLED</strong>
      <span>Publishing is halted{state.reason ? ` — ${state.reason}` : ''}.</span>
    </div>
  );
}
