'use client';

import { useEffect, useState } from 'react';
import { watchGeneration, type GenerationStatus } from '@/lib/generation-status';
import BundleMedia from './BundleMedia';
import GenerationRetry from './GenerationRetry';
import { useLocale } from './LocaleProvider';

export default function GenerationProgress({ bundleId, modelId, operatorControls = true }: { bundleId: string; modelId: string; operatorControls?: boolean }) {
  const { t } = useLocale();
  const [retryBundleId, setRetryBundleId] = useState<string | null>(null);
  const [status, setStatus] = useState<GenerationStatus | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    setStatus(null);
    setUnavailable(false);
    return watchGeneration(bundleId, modelId, setStatus, () => setUnavailable(true));
  }, [bundleId, modelId]);
  const message = unavailable
    ? `${t('generation.statusUnavailable')} ${operatorControls ? `${t('generation.openApprovals')} or ${t('generation.openIncidents')}` : `${t('generation.openReviewDrafts')} or ${t('generation.scanFailedContact')}`} before submitting again.`
    : status?.scanFailed
      ? `${t('generation.scanFailed')} ${operatorControls ? t('generation.scanFailedOperator') : t('generation.scanFailedContact')}`
    : status?.state === 'hold'
      ? `${t('generation.onHold')} ${operatorControls ? t('generation.onHoldOperator') : t('generation.onHoldContact')}`
      : status?.state === 'rejected'
        ? t('generation.rejected')
        : !status?.assetReady
          ? status?.generationPaused
            ? t('generation.paused')
            : t('generation.queued')
          : status.verdict === 'pending'
            ? t('generation.scanPending')
            : status.verdict === 'pass'
              ? t('generation.scanPassed')
              : status.verdict === 'review'
                ? operatorControls ? t('generation.requiresReviewOperator') : t('generation.requiresReviewDraft')
                : t('generation.blocked');
  if (retryBundleId) return <GenerationProgress key={retryBundleId} bundleId={retryBundleId} modelId={modelId} operatorControls={operatorControls} />;
  return <div>
    <p role="status">{message}</p>
    {status?.assetReady && <BundleMedia bundleId={bundleId} />}
    {status?.sanitization?.selected && <p>{t('generation.sanitizationComplete', {
      hashState: status.sanitization.exactFileHashChanged
        ? t('generation.sanitizationHashChanged')
        : t('generation.sanitizationHashUnchanged'),
    })} {t('generation.sanitizationWarning')}</p>}
    {operatorControls && !unavailable && status && (status.state === 'hold' || (status.assetReady && ['block', 'review'].includes(status.verdict)))
      && ['generated', 'hold'].includes(status.state) && <GenerationRetry key={bundleId} modelId={modelId} bundleId={bundleId}
        blocked={status.verdict === 'block'} onQueued={setRetryBundleId} />}
    <a href={`/models/${encodeURIComponent(modelId)}/approvals`}>{operatorControls ? t('generation.openApprovals') : t('generation.openReviewDrafts')}</a>
    {operatorControls && status?.scanFailed && <p><a href="/incidents">{t('generation.openIncidents')}</a></p>}
  </div>;
}
