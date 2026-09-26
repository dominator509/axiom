'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';
import { useLocale } from './LocaleProvider';

export default function TosRescan({ modelId, bundleId, assetId, expectedRevisionId }: {
  modelId: string; bundleId: string; assetId: string; expectedRevisionId: string | null;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(false);
  const intent = useRef<{ body: string; key: string } | null>(null);

  async function requestRescan() {
    if (active.current || receipt) return;
    active.current = true;
    setBusy(true);
    setError(null);
    const body = JSON.stringify({ modelId, assetId, expectedRevisionId });
    if (!intent.current) intent.current = { body, key: createIdempotencyKey() };
    try {
      const response = await mutationFetch(`/api/v1/bundles/${encodeURIComponent(bundleId)}/tos-rescan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: intent.current.body,
      }, { idempotencyKey: intent.current.key });
      if (!response.ok) {
        const failure = await readDashboardError(response);
        const message = failure?.error?.message ?? failure.detail;
        setError(typeof message === 'string' ? message : t('review.tosRescanError'));
        if ([400, 403, 404, 409, 422].includes(response.status)) intent.current = null;
        return;
      }
      const result = await readDashboardJson<{ data: {
        bundleId: string; modelId: string; scanJobId: string; state: string; approvalBlocked: boolean;
      } }>(response);
      const data = result?.data;
      if (data?.bundleId !== bundleId || data.modelId !== modelId || data.state !== 'queued'
        || data.approvalBlocked !== true
        || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(data.scanJobId ?? ''))
        throw new Error('Invalid ToS rescan receipt');
      setReceipt(data.scanJobId.slice(0, 8));
      router.refresh();
    } catch {
      setError(t('review.tosRescanUnconfirmed'));
    } finally {
      active.current = false;
      setBusy(false);
    }
  }

  return <section aria-label={t('review.tosRescanAction')}>
    {receipt ? (
      <p role="status">{t('review.tosRescanQueued')} <span className="mono">{receipt}</span></p>
    ) : <>
      <p>{t('review.tosRescanHelp')}</p>
      <button type="button" disabled={busy} onClick={() => void requestRescan()}>
        {t('review.tosRescanAction')}
      </button>
      {error && <p role="alert">{error}</p>}
    </>}
  </section>;
}
