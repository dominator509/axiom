'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';
import { useLocale } from './LocaleProvider';
export default function OrgSettingsForm({ initial }: { initial: { viralSharing: boolean; publishingEnabled: boolean; weeklyDigestEnabled?: boolean } }) {
  const { t } = useLocale();
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
      if (!response.ok) { const d = await readDashboardError(response); if ([400, 401, 403, 404, 409, 422].includes(response.status)) { intent.current = null; setPending(false); } setError(d?.error?.message ?? t('settings.saveNotConfirmed')); return; }
      const result = await readDashboardJson<{ data?: { viralSharing?: unknown; publishingEnabled?: unknown; weeklyDigestEnabled?: unknown } }>(response);
      if (result.data?.viralSharing !== viralSharing || result.data?.publishingEnabled !== publishingEnabled || result.data?.weeklyDigestEnabled !== weeklyDigestEnabled) throw new Error('Unconfirmed settings');
      intent.current = null; setPending(false); setMessage(t('settings.saved')); router.refresh();
    } catch { setError(t('settings.retrySameSettings')); }
    finally { active.current = false; setBusy(false); }
  }
  return <form className="card stack" aria-label={t('settings.workspaceAria')} onSubmit={event => { event.preventDefault(); void save(); }}>
    <h2>{t('settings.workspaceTitle')}</h2>
    <fieldset disabled={busy || pending}>
      <label className="checkbox-option"><input type="checkbox" checked={viralSharing} onChange={event => setViralSharing(event.target.checked)} /><span>{t('settings.viralSharing')}</span></label>
      <p className="subtle">{t('settings.viralSharingDescription')}</p>
      <label className="checkbox-option"><input type="checkbox" checked={weeklyDigestEnabled} onChange={event => setWeeklyDigestEnabled(event.target.checked)} /><span>{t('settings.weeklyDigest')}</span></label>
      <p className="subtle">{t('settings.weeklyDigestDescription')}</p>
      <label className="checkbox-option"><input type="checkbox" checked={publishingEnabled} onChange={event => setPublishingEnabled(event.target.checked)} /><span>{t('settings.publishingWorkers')}</span></label>
      <p className="subtle">{t('settings.publishingWorkersDescription')}</p>
    </fieldset>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    <button type="submit" disabled={busy}>{busy ? t('settings.savingWorkspace') : pending ? t('settings.retrySameSettings') : t('settings.saveWorkspace')}</button>
  </form>;
}
