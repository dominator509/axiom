'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale } from './LocaleProvider';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';

export default function ViralPatternSharingControl({ modelId, initialEnabled, canManage }: {
  modelId: string;
  initialEnabled: boolean | null;
  canManage: boolean;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [draft, setDraft] = useState(initialEnabled);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const intent = useRef<{ enabled: boolean; key: string } | null>(null);
  const active = useRef(false);

  if (!canManage) return null;
  if (enabled === null || draft === null) return <p role="alert" className="subtle">{t('dashboard.performance.sharingLoadFailed')}</p>;

  async function save() {
    if (active.current || draft === null) return;
    active.current = true;
    setBusy(true);
    setMessage('');
    intent.current ??= { enabled: draft, key: createIdempotencyKey() };
    try {
      const request = intent.current;
      const response = await mutationFetch(
        `/api/v1/models/${encodeURIComponent(modelId)}/viral/pattern-sharing`,
        { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: request.enabled }) },
        { idempotencyKey: request.key, retries: 0 },
      );
      if (!response.ok) {
        const data = await readDashboardError(response);
        if ([400, 401, 403, 404, 409, 422].includes(response.status)) {
          intent.current = null;
          setPending(false);
        }
        setMessage(data?.error?.message ?? t('dashboard.performance.sharingFailed'));
        return;
      }
      const body = await readDashboardJson<{ data?: { enabled?: unknown } }>(response);
      if (body.data?.enabled !== request.enabled) throw new Error('pattern sharing state was not confirmed');
      setEnabled(request.enabled);
      setDraft(request.enabled);
      intent.current = null;
      setPending(false);
      setMessage(t('dashboard.performance.sharingSaved'));
      router.refresh();
    } catch {
      setPending(true);
      setMessage(t('dashboard.performance.sharingFailed'));
    } finally {
      active.current = false;
      setBusy(false);
    }
  }

  return <form className="card stack" aria-label={t('dashboard.performance.sharingTitle')} onSubmit={event => { event.preventDefault(); void save(); }}>
    <h3>{t('dashboard.performance.sharingTitle')}</h3>
    <p className="subtle">{t('dashboard.performance.sharingDescription')}</p>
    <fieldset disabled={busy || pending} style={{ border: 0, padding: 0, margin: 0 }}>
      <label className="checkbox-option">
        <input type="checkbox" checked={draft} onChange={event => setDraft(event.target.checked)} />
        <span>{draft ? t('dashboard.performance.sharingEnabled') : t('dashboard.performance.sharingDisabled')}</span>
      </label>
    </fieldset>
    {message && <p role="status" className="subtle">{message}</p>}
    <button type="submit" className="btn secondary" disabled={busy || (!pending && draft === enabled)}>
      {busy ? t('dashboard.performance.sharingSaving') : t('dashboard.performance.sharingSave')}
    </button>
  </form>;
}
