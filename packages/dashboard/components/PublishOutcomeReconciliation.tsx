'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError } from '@/lib/response';
import { useLocale } from './LocaleProvider';

export default function PublishOutcomeReconciliation({ jobId }: { jobId: string }) {
  const { t } = useLocale();
  const router = useRouter();
  const [remoteId, setRemoteId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef(false);
  const intent = useRef<{ jobId: string; body: string; key: string } | null>(null);

  async function reconcile(outcome: 'published' | 'not_published') {
    const confirmation = outcome === 'published'
      ? t('incidents.reconcileConfirmPublished')
      : t('incidents.reconcileConfirmNotPublished');
    if (inFlight.current || !globalThis.confirm(confirmation)) return;

    const body = JSON.stringify({
      outcome,
      confirmed: true,
      ...(outcome === 'published' && remoteId.trim() ? { remoteId: remoteId.trim() } : {}),
    });
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    try {
      if (intent.current?.jobId !== jobId || intent.current.body !== body) {
        intent.current = { jobId, body, key: createIdempotencyKey() };
      }
      const response = await mutationFetch(`/api/v1/incidents/${encodeURIComponent(jobId)}/reconcile`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: intent.current.body,
      }, { idempotencyKey: intent.current.key, retries: 0 });
      if (!response.ok) {
        const result = await readDashboardError(response);
        setMessage(result?.error?.message ?? t('incidents.reconcileFailed'));
      } else {
        intent.current = null;
        setMessage(outcome === 'published'
          ? t('incidents.reconcilePublishedSaved')
          : t('incidents.reconcileNotPublishedSaved'));
        router.refresh();
      }
    } catch {
      setMessage(t('incidents.reconcileNotConfirmed'));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="stack" aria-label={t('incidents.reconcileHeading')}>
      <p>{t('incidents.reconcileDescription')}</p>
      <label>
        {t('incidents.reconcileRemoteId')}
        <input value={remoteId} onChange={event => setRemoteId(event.target.value)} disabled={busy} maxLength={500} />
      </label>
      <div className="action-row">
        <button className="btn secondary" type="button" disabled={busy} onClick={() => reconcile('published')}>
          {busy ? '…' : t('incidents.reconcilePublished')}
        </button>
        <button className="btn secondary" type="button" disabled={busy} onClick={() => reconcile('not_published')}>
          {busy ? '…' : t('incidents.reconcileNotPublished')}
        </button>
      </div>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
