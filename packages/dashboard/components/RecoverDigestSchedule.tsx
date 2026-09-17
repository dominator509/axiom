'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardJson } from '@/lib/response';

export default function RecoverDigestSchedule({ scheduleId }: { scheduleId?: string | null }) {
  const router = useRouter();
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [pending, setPending] = useState(false), [message, setMessage] = useState('');
  const active = useRef(false), intent = useRef<{ key: string; replacement: string; body: string } | null>(null);
  async function recover() {
    if (active.current || !scheduleId || (!confirmed && !intent.current)) return;
    active.current = true; setBusy(true); setPending(true); setMessage('');
    try {
      const replacement = intent.current?.replacement ?? crypto.randomUUID();
      intent.current ??= { replacement, key: createIdempotencyKey(), body: JSON.stringify({ weeklyDigestRecovery: { expectedScheduleId: scheduleId, replacementScheduleId: replacement } }) };
      const request = intent.current;
      const response = await mutationFetch('/api/v1/org-settings', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: request.body }, { idempotencyKey: request.key });
      if ([400, 401, 403, 404, 409, 422].includes(response.status)) {
        intent.current = null; setPending(false); setConfirmed(false); setMessage('Recovery rejected. Refresh settings before trying again.'); return;
      }
      if (!response.ok) throw new Error('Unconfirmed');
      const result = await readDashboardJson<{ data?: { weeklyDigestScheduleId?: string } }>(response);
      if (result.data?.weeklyDigestScheduleId !== request.replacement) throw new Error('Unconfirmed');
      intent.current = null; setPending(false); setConfirmed(false);
      setMessage('New weekly schedule saved, starting next Monday at 00:00 UTC. Existing digest cards were not replayed.'); router.refresh();
    } catch { setMessage('Recovery not confirmed. Retry the same recovery; do not start a new one.'); }
    finally { active.current = false; setBusy(false); }
  }
  if (!scheduleId && !pending) return null;
  return <section className="card stack" aria-label="Recover weekly digests">
    <h2>Recover weekly digests</h2>
    <p>If automatic summaries have stopped, replace the schedule. This starts next Monday, invalidates unstarted work from the old schedule and never replays missed weeks or sends an external message. It does not enable publishing or override Safety.</p>
    <label className="checkbox-option"><input type="checkbox" checked={confirmed} disabled={busy || pending} onChange={event => setConfirmed(event.target.checked)} /><span>Replace the current weekly schedule</span></label>
    <button type="button" disabled={busy || (!confirmed && !pending)} onClick={() => void recover()}>{busy ? 'Saving recovery…' : pending ? 'Retry same recovery' : 'Start a fresh weekly schedule'}</button>
    {message && <p role="status">{message}</p>}
  </section>;
}
