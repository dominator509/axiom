'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError } from '@/lib/response';
import { useLocale } from './LocaleProvider';

export default function DiscardButton({ jobId }: { jobId: string }) {
  const { t } = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef(false);
  const intent = useRef<{ jobId: string; key: string } | null>(null);

  async function discard() {
    if (inFlight.current || !globalThis.confirm(t('incidents.discardConfirm'))) return;
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    try {
      if (intent.current?.jobId !== jobId) {
        intent.current = { jobId, key: createIdempotencyKey() };
      }
      const response = await mutationFetch(`/api/v1/incidents/${encodeURIComponent(jobId)}/discard`, { method: 'POST' }, {
        idempotencyKey: intent.current.key,
      });
      if (!response.ok) {
        const body = await readDashboardError(response);
        setMessage(body?.error?.message ?? t('incidents.discardFailed'));
      } else {
        intent.current = null;
        setMessage(t('incidents.discarded'));
        router.refresh();
      }
    } catch {
      setMessage(t('incidents.discardNotConfirmed'));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <span>
      <button
        className="btn secondary"
        type="button"
        disabled={busy}
        onClick={discard}
        style={{ padding: '4px 10px', fontSize: 12 }}
      >
        {busy ? '…' : t('incidents.discard')}
      </button>
      {message && <span role="status" style={{ color: 'var(--muted)', marginLeft: 6, fontSize: 12 }}>{message}</span>}
    </span>
  );
}
