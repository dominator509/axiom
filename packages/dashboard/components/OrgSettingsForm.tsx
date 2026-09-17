'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';
export default function OrgSettingsForm({ initial }: { initial: { viralSharing: boolean; publishingEnabled: boolean; weeklyDigestEnabled?: boolean } }) {
  const router = useRouter(); const [viralSharing, setViralSharing] = useState(initial.viralSharing); const [publishingEnabled, setPublishingEnabled] = useState(initial.publishingEnabled);
  const [weeklyDigestEnabled, setWeeklyDigestEnabled] = useState(initial.weeklyDigestEnabled ?? false);
  const [busy, setBusy] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const active = useRef(false), intent = useRef<{ body: string; key: string } | null>(null);
  async function save() {
    if (active.current) return; setError(''); setMessage('');
    const body = JSON.stringify({ viralSharing, publishingEnabled, weeklyDigestEnabled });
    intent.current ??= { body, key: createIdempotencyKey() };
    active.current = true; setBusy(true); setPending(true);
    try {
      const request = intent.current; const response = await mutationFetch('/api/v1/org-settings', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: request.body }, { idempotencyKey: request.key });
      if (!response.ok) { const d = await readDashboardError(response); if ([400, 401, 403, 404, 409, 422].includes(response.status)) { intent.current = null; setPending(false); } setError(d?.error?.message ?? 'Settings save not confirmed.'); return; }
      const result = await readDashboardJson<{ data?: { viralSharing?: unknown; publishingEnabled?: unknown; weeklyDigestEnabled?: unknown } }>(response);
      if (result.data?.viralSharing !== viralSharing || result.data?.publishingEnabled !== publishingEnabled || result.data?.weeklyDigestEnabled !== weeklyDigestEnabled) throw new Error('Unconfirmed settings');
      intent.current = null; setPending(false); setMessage('Workspace settings saved. Publishing safety is also controlled by the Safety page.'); router.refresh();
    } catch { setError('Settings save not confirmed. Retry without changing the choices.'); }
    finally { active.current = false; setBusy(false); }
  }
  return <form className="card stack" aria-label="Workspace settings" onSubmit={event => { event.preventDefault(); void save(); }}>
    <h2>Workspace settings</h2>
    <fieldset disabled={busy || pending}>
      <label className="checkbox-option"><input type="checkbox" checked={viralSharing} onChange={event => setViralSharing(event.target.checked)} /><span>Enable viral-sharing analysis</span></label>
      <p className="subtle">Controls analytics/exemplar sharing behavior. It does not publish content.</p>
      <label className="checkbox-option"><input type="checkbox" checked={weeklyDigestEnabled} onChange={event => setWeeklyDigestEnabled(event.target.checked)} /><span>Generate weekly workspace digests</span></label>
      <p className="subtle">Opt in to Monday 00:00 UTC summaries in Weekly digests, starting next Monday. The workspace worker must be running and permitted by Safety. Missed weeks are not replayed. Disabling stops future automatic summaries; manual generation remains available. This does not send an external message or publish content.</p>
      <label className="checkbox-option"><input type="checkbox" checked={publishingEnabled} onChange={event => setPublishingEnabled(event.target.checked)} /><span>Allow publishing workers to operate</span></label>
      <p className="subtle">This is a workspace-level permission. The separate Safety control can still halt publishing immediately.</p>
    </fieldset>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    <button type="submit" disabled={busy}>{busy ? 'Saving…' : pending ? 'Retry same settings' : 'Save workspace settings'}</button>
  </form>;
}
