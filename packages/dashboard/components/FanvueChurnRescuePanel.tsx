'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatDate } from '@axiom/core';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';
import { useLocale } from './LocaleProvider';

interface Rescue {
  id: string;
  subscriptionId: string;
  status: 'ready' | 'sending' | 'sent' | 'unknown' | 'failed' | 'dismissed';
  sentAt: string | null;
  remoteMessageId: string | null;
  createdAt: string;
}

interface Snapshot {
  data: Rescue[];
  setup: { webhookConfigured: boolean; endpoints: string[] };
}

type Draft = { message: string; offerText: string };
type Intent = { key: string; body: string };

function statusCopy(status: Rescue['status'], t: (key: string) => string): string {
  switch (status) {
    case 'ready': return t('modelSurface.churnReady');
    case 'sending': return t('modelSurface.churnSending');
    case 'sent': return t('modelSurface.churnSent');
    case 'unknown': return t('modelSurface.churnUnknown');
    case 'failed': return t('modelSurface.churnUnknown');
    case 'dismissed': return t('modelSurface.churnSent');
  }
}

export default function FanvueChurnRescuePanel({ modelId, canEdit }: { modelId: string; canEdit: boolean }) {
  const { locale = 'en', t } = useLocale();
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [origin, setOrigin] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const intents = useRef(new Map<string, Intent>());

  const load = useCallback(async () => {
    setLoadState('loading');
    try {
      const response = await fetch(`/api/v1/models/${encodeURIComponent(modelId)}/fanvue/churn-rescues`, { cache: 'no-store' });
      if (!response.ok) throw new Error('load failed');
      const parsed = await readDashboardJson<Snapshot>(response);
      if (!Array.isArray(parsed.data) || !parsed.setup || !Array.isArray(parsed.setup.endpoints)) throw new Error('invalid response');
      setSnapshot(parsed);
      setLoadState('ready');
    } catch {
      setLoadState('failed');
    }
  }, [modelId]);

  useEffect(() => {
    setOrigin(window.location.origin);
    void load();
  }, [load]);

  async function send(rescue: Rescue) {
    if (busyId) return;
    const current = drafts[rescue.id] ?? { message: '', offerText: '' };
    let intent = intents.current.get(rescue.id);
    if (!intent) {
      if (!current.message.trim() || !current.offerText.trim()) {
        setMessage(t('modelSurface.churnDescription'));
        return;
      }
      intent = {
        key: createIdempotencyKey(),
        body: JSON.stringify({ message: current.message.trim(), offerText: current.offerText.trim() }),
      };
      intents.current.set(rescue.id, intent);
    }
    setBusyId(rescue.id);
    setMessage('');
    try {
      const response = await mutationFetch(`/api/v1/models/${encodeURIComponent(modelId)}/fanvue/churn-rescues/${encodeURIComponent(rescue.id)}/send`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: intent.body,
      }, { idempotencyKey: intent.key, retries: 0 });
      if (!response.ok) {
        const error = await readDashboardError(response);
        if ([400, 401, 403, 404, 409, 422].includes(response.status)) intents.current.delete(rescue.id);
        setMessage(error?.error?.message ?? t('modelSurface.churnUnknownNotice'));
        await load();
        return;
      }
      const result = await readDashboardJson<{ data?: { status?: string } }>(response);
      intents.current.delete(rescue.id);
      setMessage(result.data?.status === 'unknown' ? t('modelSurface.churnUnknownNotice') : t('modelSurface.churnSentNotice'));
      setDrafts(currentDrafts => ({ ...currentDrafts, [rescue.id]: { message: '', offerText: '' } }));
      await load();
      router.refresh();
    } catch {
      setMessage(t('modelSurface.churnUnknownNotice'));
    } finally {
      setBusyId(null);
    }
  }

  const statusLabel = (status: Rescue['status']) => statusCopy(status, t);
  return <section className="card stack" aria-labelledby="fanvue-churn-title">
    <div>
      <h3 id="fanvue-churn-title">{t('modelSurface.churnTitle')}</h3>
      <p className="subtle">{t('modelSurface.churnDescription')}</p>
    </div>
    {loadState === 'failed' && <p role="alert">{t('modelSurface.churnLoadFailed')}</p>}
    {snapshot && <div className="stack">
      {!snapshot.setup.webhookConfigured && <p role="alert">{t('modelSurface.fanvueWebhookMissing')}</p>}
      {snapshot.setup.endpoints.map((endpoint) => <p key={endpoint} className="subtle">
        {t('modelSurface.fanvueWebhookUrl')}: <code>{origin ? new URL(endpoint, origin).toString() : endpoint}</code>
      </p>)}
      {snapshot.data.length === 0 && loadState === 'ready' && <p>{t('modelSurface.churnEmpty')}</p>}
      {snapshot.data.map((rescue) => {
        const draft = drafts[rescue.id] ?? { message: '', offerText: '' };
        const intent = intents.current.has(rescue.id);
        return <article className="card stack" key={rescue.id}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <strong>{rescue.subscriptionId}</strong>
              <p className="subtle">{formatDate(new Date(rescue.createdAt), locale)}</p>
            </div>
            <span className={`badge ${rescue.status === 'sent' ? 'good' : rescue.status === 'ready' ? 'warn' : 'mute'}`}>{statusLabel(rescue.status)}</span>
          </div>
          {canEdit && rescue.status === 'ready' && <div className="stack">
            <label>{t('modelSurface.churnMessage')}
              <textarea rows={3} maxLength={3500} value={draft.message} disabled={busyId === rescue.id || intent} onChange={event => setDrafts(current => ({
                ...current, [rescue.id]: { ...draft, message: event.target.value },
              }))} />
            </label>
            <label>{t('modelSurface.churnOffer')}
              <textarea rows={2} maxLength={500} value={draft.offerText} disabled={busyId === rescue.id || intent} onChange={event => setDrafts(current => ({
                ...current, [rescue.id]: { ...draft, offerText: event.target.value },
              }))} />
            </label>
            <button type="button" className="btn" disabled={busyId !== null || !snapshot.setup.webhookConfigured || !draft.message.trim() || !draft.offerText.trim()} onClick={() => void send(rescue)}>
              {busyId === rescue.id ? t('modelSurface.churnSending') : t('modelSurface.churnSend')}
            </button>
            {intent && <button type="button" className="btn secondary" disabled={busyId !== null} onClick={() => void send(rescue)}>{t('linkbio.retry')}</button>}
          </div>}
        </article>;
      })}
      <button type="button" className="btn secondary" disabled={loadState === 'loading'} onClick={() => void load()}>{t('linkbio.retry')}</button>
    </div>}
    {message && <p role="status">{message}</p>}
    {!canEdit && <p className="subtle">{t('fans.accessDescription')}</p>}
  </section>;
}
