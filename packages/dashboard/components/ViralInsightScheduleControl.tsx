'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';
import { useLocale } from './LocaleProvider';

export default function ViralInsightScheduleControl({
  modelId,
  initialEnabled,
  canManage,
}: {
  modelId: string;
  initialEnabled: boolean | null;
  canManage: boolean;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const intent = useRef<{ enabled: boolean; key: string } | null>(null);
  const active = useRef(false);

  if (!canManage) return null;
  if (enabled === null) return <p role="alert" className="subtle">{t('dashboard.viralInsight.scheduleLoadError')}</p>;

  async function save() {
    if (active.current || enabled === null) return;
    active.current = true;
    setBusy(true);
    setMessage('');
    intent.current ??= { enabled, key: createIdempotencyKey() };
    try {
      const request = intent.current;
      const response = await mutationFetch(
        `/api/v1/models/${encodeURIComponent(modelId)}/viral/insight-schedule`,
        { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: request.enabled }) },
        { idempotencyKey: request.key, retries: 0 },
      );
      if (!response.ok) {
        const data = await readDashboardError(response);
        if ([400, 401, 403, 404, 409, 422].includes(response.status)) {
          intent.current = null;
          setPending(false);
        }
        setMessage(data?.error?.message ?? t('dashboard.viralInsight.scheduleNotConfirmed'));
        return;
      }
      const body = await readDashboardJson<{ data?: { enabled?: unknown } }>(response);
      if (body.data?.enabled !== request.enabled) throw new Error('schedule state was not confirmed');
      setEnabled(request.enabled);
      intent.current = null;
      setPending(false);
      setMessage(t('dashboard.viralInsight.scheduleSaved'));
      router.refresh();
    } catch {
      setPending(true);
      setMessage(t('dashboard.viralInsight.scheduleRetry'));
    } finally {
      active.current = false;
      setBusy(false);
    }
  }

  return (
    <form className="card stack" aria-label={t('dashboard.viralInsight.scheduleTitle')} onSubmit={event => { event.preventDefault(); void save(); }}>
      <h3>{t('dashboard.viralInsight.scheduleTitle')}</h3>
      <p className="subtle">{t('dashboard.viralInsight.scheduleDescription')}</p>
      <fieldset disabled={busy || pending} style={{ border: 0, padding: 0, margin: 0 }}>
        <label className="checkbox-option">
          <input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />
          <span>{enabled ? t('dashboard.viralInsight.scheduleEnabled') : t('dashboard.viralInsight.scheduleDisabled')}</span>
        </label>
      </fieldset>
      {message && <p role="status" className="subtle">{message}</p>}
      <button type="submit" className="btn secondary" disabled={busy}>
        {busy ? t('dashboard.viralInsight.scheduleSaving') : pending ? t('dashboard.viralInsight.scheduleRetry') : t('dashboard.viralInsight.scheduleSave')}
      </button>
    </form>
  );
}
