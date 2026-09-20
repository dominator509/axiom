'use client';

import { useRef, useState } from 'react';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';
import MediaPromptSuggestion from './MediaPromptSuggestion';
import { useLocale } from './LocaleProvider';

export default function GenerationRetry({ modelId, bundleId, blocked, onQueued }: {
  modelId: string; bundleId: string; blocked: boolean; onQueued: (id: string) => void;
}) {
  const { t } = useLocale();
  const [editing, setEditing] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(false);
  const intent = useRef<{ body: string; key: string } | null>(null);
  async function retry() {
    if (active.current || !acknowledged || (editing && !prompt.trim()) || (blocked && !editing)) return;
    active.current = true;
    setBusy(true);
    setError(null);
    const body = JSON.stringify({ acknowledgeUsage: true, ...(editing ? { prompt: prompt.trim() } : {}) });
    // Retain the exact intent after uncertain HTTP outcomes. Do not permit edits
    // until its response is resolved, even when the provider is still running.
    if (!intent.current) intent.current = { body, key: createIdempotencyKey() };
    try {
      const response = await mutationFetch(`/api/v1/models/${encodeURIComponent(modelId)}/generate/${encodeURIComponent(bundleId)}/retry`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: intent.current.body,
      }, { idempotencyKey: intent.current.key });
      if (!response.ok) {
        const failure = await readDashboardError(response);
        const message = failure?.error?.message ?? failure.detail;
        setError(typeof message === 'string' ? message : t('review.retryNotAccepted'));
        // A conflict may be an in-flight reservation, not a rejected intent.
        // Keep its key for reconciliation; likewise timeouts/rate limits.
        if ((response.status === 409 && failure.code === 'MEDIA_RETRY_NOT_QUEUED')
          || [400, 422].includes(response.status)) intent.current = null;
        return;
      }
      const result = await readDashboardJson<{ data: { bundle: { id: string; modelId: string }; mediaGeneration: string } }>(response);
      if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(result?.data?.bundle?.id ?? '')
        || result.data.bundle.modelId !== modelId || result.data.mediaGeneration !== 'queued')
        throw new Error('Invalid retry receipt');
      onQueued(result.data.bundle.id);
    } catch {
      setError(t('review.retryUnconfirmed'));
    } finally { active.current = false; setBusy(false); }
  }
  return <section aria-label={t('review.generationRetry')}>
    <p>{t('review.generationRetryDescription')}</p>
    <button type="button" disabled={busy || !!intent.current} onClick={() => setEditing(true)}>{t('review.reviewSuggestedModifications')}</button>
    {editing && <>
      <p>{t('review.retryPromptDescription')}</p>
      <p>{t('review.retryPromptLimitations')}</p>
      <label htmlFor={`retry-prompt-${bundleId}`}>{t('review.reviewRevisedPrompt')}</label>
      <textarea id={`retry-prompt-${bundleId}`} value={prompt} maxLength={4000} disabled={busy || !!intent.current} onChange={e => setPrompt(e.target.value)} />
      <MediaPromptSuggestion key={bundleId} modelId={modelId} bundleId={bundleId} disabled={busy || !!intent.current}
        onUse={proposed => { if (!active.current && !intent.current) { setPrompt(proposed); setAcknowledged(false); } }} />
    </>}
    <label><input type="checkbox" checked={acknowledged} disabled={busy} onChange={e => setAcknowledged(e.target.checked)} /> {t('review.approveNewGeneration')}</label>
    <button type="button" disabled={busy || !acknowledged || (blocked && !editing) || (editing && !prompt.trim())} onClick={() => void retry()}>
      {busy ? t('review.checkingRetry') : intent.current ? t('review.checkSameRequest') : editing ? t('review.retryWithReviewedModifications') : t('review.retryGeneration')}
    </button>
    {blocked && !editing && <p>{t('review.blockedPromptRequired')}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
