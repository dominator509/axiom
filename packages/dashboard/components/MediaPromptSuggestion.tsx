'use client';

import { useRef, useState } from 'react';
import { formatNumber } from '@axiom/core';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';
import { promptDiff } from '@/lib/prompt-diff';
import { useLocale } from './LocaleProvider';

type Suggestion = {
  prompt: string; explanation: string; lastTriedPrompt: string; provider: string;
  characterLockPrompt: string; characterLockVersion: number;
};

export default function MediaPromptSuggestion({ modelId, bundleId, disabled, onUse }: {
  modelId: string; bundleId: string; disabled: boolean; onUse: (prompt: string) => void;
}) {
  const { locale, t } = useLocale();
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const active = useRef(false);
  const key = useRef<string | null>(null);
  async function ask() {
    if (disabled || active.current || !approved || suggestion) return;
    active.current = true;
    setBusy(true);
    setError(null);
    key.current ??= createIdempotencyKey();
    try {
      const response = await mutationFetch(`/api/v1/models/${encodeURIComponent(modelId)}/generate/${encodeURIComponent(bundleId)}/suggest-prompt`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ acknowledgeUsage: true }),
      }, { idempotencyKey: key.current, retries: 0, timeoutMs: 130_000 });
      if (!response.ok) {
        const failure = await readDashboardError(response);
        const message = failure?.error?.message ?? failure.detail;
        setError(typeof message === 'string' ? message : t('review.suggestionUnavailable'));
        return;
      }
      const { data } = await readDashboardJson<{ data: Suggestion & { provider: string; requiresReview: boolean; mediaQueued: boolean } }>(response);
      if (typeof data?.provider !== 'string' || !/^[a-z][a-z0-9-]{0,49}$/.test(data.provider) || data.requiresReview !== true || data.mediaQueued !== false
        || typeof data.prompt !== 'string' || !data.prompt.trim() || data.prompt.length > 4000
        || typeof data.lastTriedPrompt !== 'string' || !data.lastTriedPrompt.trim() || data.lastTriedPrompt.length > 4000
        || typeof data.explanation !== 'string' || !data.explanation.trim() || data.explanation.length > 1000
        || typeof data.characterLockPrompt !== 'string' || data.characterLockPrompt.length > 2000
        || !Number.isInteger(data.characterLockVersion) || data.characterLockVersion < 0 || data.characterLockVersion > 2147483647
        || data.prompt === data.lastTriedPrompt) throw new Error('Invalid suggestion');
      setSuggestion(data);
    } catch {
      setError(t('review.suggestionUnconfirmed'));
    } finally { active.current = false; setBusy(false); }
  }
  const diff = suggestion ? promptDiff(suggestion.lastTriedPrompt, suggestion.prompt) : null;
  return <section aria-label={t('review.promptSuggestion')}>
    <p>{t('review.promptSuggestionDescription')}</p>
    <label><input type="checkbox" checked={approved} disabled={disabled || busy || !!key.current}
      onChange={event => setApproved(event.target.checked)} /> {t('review.approveTextRequest')}</label>
    <button type="button" disabled={disabled || busy || !approved || !!suggestion} onClick={() => void ask()}>
      {busy ? t('review.requestingRevision') : key.current ? t('review.checkSameSuggestion') : t('review.askMinimalRevision')}
    </button>
    {error && <p role="alert">{error}</p>}
    {suggestion && <div>
      <h4>{t('review.lastTriedPrompt')}</h4><p style={{ whiteSpace: 'pre-wrap' }}>{suggestion.lastTriedPrompt}</p>
      <h4>{t('review.proposedPrompt', { provider: suggestion.provider })}</h4><p style={{ whiteSpace: 'pre-wrap' }}>{suggestion.prompt}</p>
      <h4>{t('review.providerExplanation')}</h4><p>{suggestion.explanation}</p>
      <button type="button" disabled={disabled || busy} onClick={() => { if (!disabled && !busy) onUse(suggestion.prompt); }}>{t('review.useProposal')}</button>
      <p>{t('review.reviewProposal')}</p>
      {diff && <div aria-label={t('review.promptDiff')}>
        <p>{t('review.promptDiffDescription')}</p>
        <p style={{ whiteSpace: 'pre-wrap' }}>{diff.prefix}<del>{diff.removed}</del><ins>{diff.added}</ins>{diff.suffix}</p>
      </div>}
      <section aria-label={t('review.savedCharacterLock')}>
        <h4>{t('review.characterLockUsed', { revision: formatNumber(suggestion.characterLockVersion, locale) })}</h4>
        <p style={{ whiteSpace: 'pre-wrap' }}>{suggestion.characterLockPrompt || t('review.noCharacterLock')}</p>
        <p>{t('review.characterLockPreserved')}</p>
      </section>
    </div>}
  </section>;
}
