'use client';

import { useEffect, useState } from 'react';
import { watchGeneration, type GenerationStatus } from '@/lib/generation-status';
import BundleMedia from './BundleMedia';
import GenerationRetry from './GenerationRetry';

export default function GenerationProgress({ bundleId, modelId }: { bundleId: string; modelId: string }) {
  const [retryBundleId, setRetryBundleId] = useState<string | null>(null);
  const [status, setStatus] = useState<GenerationStatus | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    setStatus(null);
    setUnavailable(false);
    return watchGeneration(bundleId, modelId, setStatus, () => setUnavailable(true));
  }, [bundleId, modelId]);
  const message = unavailable
    ? 'Live status unavailable. Generation may still be running; check Approvals or Incidents before submitting again.'
    : status?.state === 'hold'
      ? 'Bundle is on hold. Inspect Incidents before retrying generation.'
      : status?.state === 'rejected'
        ? 'Bundle was rejected.'
        : !status?.assetReady
          ? 'Grok generation queued or running. No generated asset is attached yet.'
          : status.verdict === 'pending'
            ? 'Generated media is attached. ToS scanning is pending; approval is not available yet.'
            : status.verdict === 'pass'
              ? 'Generated media is attached and ToS scanning passed. Review the bundle before approval.'
              : status.verdict === 'review'
                ? 'Generated media is attached but requires review. Open Approvals to inspect the scan and complete any required full-video review.'
                : 'Generated media is attached but blocked by ToS. It cannot be approved.';
  if (retryBundleId) return <GenerationProgress key={retryBundleId} bundleId={retryBundleId} modelId={modelId} />;
  return <div>
    <p role="status">{message}</p>
    {status?.assetReady && <BundleMedia bundleId={bundleId} />}
    {!unavailable && status && (status.state === 'hold' || (status.assetReady && ['block', 'review'].includes(status.verdict)))
      && ['generated', 'hold'].includes(status.state) && <GenerationRetry key={bundleId} modelId={modelId} bundleId={bundleId}
        blocked={status.verdict === 'block'} onQueued={setRetryBundleId} />}
    <a href={`/models/${encodeURIComponent(modelId)}/approvals`}>Open Approvals</a>
  </div>;
}
