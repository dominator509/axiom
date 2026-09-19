'use client';

import { useEffect, useState } from 'react';
import { watchGeneration, type GenerationStatus } from '@/lib/generation-status';
import BundleMedia from './BundleMedia';
import GenerationRetry from './GenerationRetry';

export default function GenerationProgress({ bundleId, modelId, operatorControls = true }: { bundleId: string; modelId: string; operatorControls?: boolean }) {
  const [retryBundleId, setRetryBundleId] = useState<string | null>(null);
  const [status, setStatus] = useState<GenerationStatus | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    setStatus(null);
    setUnavailable(false);
    return watchGeneration(bundleId, modelId, setStatus, () => setUnavailable(true));
  }, [bundleId, modelId]);
  const message = unavailable
    ? `Live status unavailable. Generation may still be running; ${operatorControls ? 'check Approvals or Incidents' : 'check Review drafts or contact an operator'} before submitting again.`
    : status?.scanFailed
      ? `ToS scanning failed. Your generated media is saved, but approval remains blocked. ${operatorControls ? 'Open Incidents' : 'Contact an operator'} for details; do not generate again just to retry the scan.`
    : status?.state === 'hold'
      ? `Bundle is on hold. ${operatorControls ? 'Inspect Incidents' : 'Contact an operator'} before retrying generation.`
      : status?.state === 'rejected'
        ? 'Bundle was rejected.'
        : !status?.assetReady
          ? status?.generationPaused
            ? 'Media generation is paused by the workspace kill switch. No generated asset is attached yet. An operator must review the workspace safety setting before work can resume.'
            : 'Grok generation queued or running. No generated asset is attached yet.'
          : status.verdict === 'pending'
            ? 'Generated media is attached. ToS scanning is pending; approval is not available yet.'
            : status.verdict === 'pass'
              ? 'Generated media is attached and ToS scanning passed. Review the bundle before approval.'
              : status.verdict === 'review'
                ? `Generated media is attached but requires review. ${operatorControls ? 'Open Approvals to inspect the scan and complete any required full-video review.' : 'Open Review drafts to inspect the scan; an operator must complete any required full-video review.'}`
                : 'Generated media is attached but blocked by ToS. It cannot be approved.';
  if (retryBundleId) return <GenerationProgress key={retryBundleId} bundleId={retryBundleId} modelId={modelId} operatorControls={operatorControls} />;
  return <div>
    <p role="status">{message}</p>
    {status?.assetReady && <BundleMedia bundleId={bundleId} />}
    {status?.sanitization?.selected && <p>Embedded metadata sanitization completed. Exact-file SHA-256 {status.sanitization.exactFileHashChanged ? 'changed' : 'unchanged'}. This does not prevent perceptual matching.</p>}
    {operatorControls && !unavailable && status && (status.state === 'hold' || (status.assetReady && ['block', 'review'].includes(status.verdict)))
      && ['generated', 'hold'].includes(status.state) && <GenerationRetry key={bundleId} modelId={modelId} bundleId={bundleId}
        blocked={status.verdict === 'block'} onQueued={setRetryBundleId} />}
    <a href={`/models/${encodeURIComponent(modelId)}/approvals`}>{operatorControls ? 'Open Approvals' : 'Open Review drafts'}</a>
    {operatorControls && status?.scanFailed && <p><a href="/incidents">Open Incidents</a></p>}
  </div>;
}
