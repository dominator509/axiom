'use client';

import { useRef, useState } from 'react';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';
import { promptDiff } from '@/lib/prompt-diff';

type Suggestion = {
  prompt: string; explanation: string; lastTriedPrompt: string; provider: string;
  characterLockPrompt: string; characterLockVersion: number;
};

export default function MediaPromptSuggestion({ modelId, bundleId, disabled, onUse }: {
  modelId: string; bundleId: string; disabled: boolean; onUse: (prompt: string) => void;
}) {
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
        setError(typeof message === 'string' ? message : 'Suggestion unavailable. No media was queued.');
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
      setError('Suggestion outcome unconfirmed. Check the same request before asking again. No media retry was submitted here.');
    } finally { active.current = false; setBusy(false); }
  }
  const diff = suggestion ? promptDiff(suggestion.lastTriedPrompt, suggestion.prompt) : null;
  return <section aria-label="Media prompt suggestion">
    <p>Ask the generating provider for the smallest effective change to the last tried prompt while preserving the remaining intent. Acceptance is not guaranteed. This requests text only; providers without a supported text-revision path cannot supply a suggestion.</p>
    <label><input type="checkbox" checked={approved} disabled={disabled || busy || !!key.current}
      onChange={event => setApproved(event.target.checked)} /> I approve a text request to the generating provider and possible usage charges.</label>
    <button type="button" disabled={disabled || busy || !approved || !!suggestion} onClick={() => void ask()}>
      {busy ? 'Requesting revision…' : key.current ? 'Check same suggestion request' : 'Ask provider for a minimal revision'}
    </button>
    {error && <p role="alert">{error}</p>}
    {suggestion && <div>
      <h4>Last tried prompt</h4><p style={{ whiteSpace: 'pre-wrap' }}>{suggestion.lastTriedPrompt}</p>
      <h4>Proposed prompt ({suggestion.provider})</h4><p style={{ whiteSpace: 'pre-wrap' }}>{suggestion.prompt}</p>
      <h4>Provider’s explanation</h4><p>{suggestion.explanation}</p>
      <button type="button" disabled={disabled || busy} onClick={() => { if (!disabled && !busy) onUse(suggestion.prompt); }}>Use this proposal in the editor</button>
      <p>Review the editor, then separately approve a generation retry. If that attempt is rejected, its saved prompt becomes the starting point for the next proposal.</p>
      {diff && <div aria-label="Exact prompt comparison">
        <p>Removed text is struck through; added text is underlined. Scattered edits are grouped into one changed span.</p>
        <p style={{ whiteSpace: 'pre-wrap' }}>{diff.prefix}<del>{diff.removed}</del><ins>{diff.added}</ins>{diff.suffix}</p>
      </div>}
      <section aria-label="Saved character lock">
        <h4>Character lock used by this attempt (revision {suggestion.characterLockVersion})</h4>
        <p style={{ whiteSpace: 'pre-wrap' }}>{suggestion.characterLockPrompt || 'No character lock was saved with this attempt.'}</p>
        <p>The retry keeps this saved identity, even if the model profile has changed. The proposal edits the scene only.</p>
      </section>
    </div>}
  </section>;
}
