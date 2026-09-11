'use client';

import { useRef, useState } from 'react';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';

export default function GenerationRetry({ modelId, bundleId, blocked, onQueued }: {
  modelId: string; bundleId: string; blocked: boolean; onQueued: (id: string) => void;
}) {
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
        setError(typeof message === 'string' ? message : 'Retry not accepted. Check Incidents before submitting again.');
        // A conflict may be an in-flight reservation, not a rejected intent.
        // Keep its key for reconciliation; likewise timeouts/rate limits.
        if (response.status >= 400 && response.status < 500
          && ![408, 409, 429].includes(response.status)) intent.current = null;
        return;
      }
      const result = await readDashboardJson<{ data: { bundle: { id: string } } }>(response);
      if (!/^[0-9a-f-]{36}$/i.test(result.data?.bundle?.id ?? '')) throw new Error('Invalid result');
      onQueued(result.data.bundle.id);
    } catch {
      setError('Retry outcome unconfirmed. Retry again to check the same request; do not start another generation.');
    } finally { active.current = false; setBusy(false); }
  }
  return <section aria-label="Generation retry">
    <p>A retry creates a new bundle and rejects the previous bundle, retaining its evidence. Provider usage may be charged. All moderation and ToS checks run again.</p>
    <button type="button" disabled={busy || !!intent.current} onClick={() => setEditing(true)}>Review suggested modifications</button>
    {editing && <>
      <p>Make substantive changes: remove explicit sexual content or graphic violence, use a non-sexual scene with fully clothed adults, or choose a neutral product or landscape. For video, also choose a compliant source image through a new generation if needed. Do not just disguise restricted wording.</p>
      <p>These are general compliance suggestions, not a provider diagnosis or a guarantee of acceptance. Prompt edits cannot fix ZDR, storage, sign-in, or quota errors.</p>
      <label htmlFor={`retry-prompt-${bundleId}`}>Review and write the revised prompt</label>
      <textarea id={`retry-prompt-${bundleId}`} value={prompt} maxLength={4000} disabled={busy || !!intent.current} onChange={e => setPrompt(e.target.value)} />
    </>}
    <label><input type="checkbox" checked={acknowledged} disabled={busy} onChange={e => setAcknowledged(e.target.checked)} /> I approve a new generation and possible provider charges.</label>
    <button type="button" disabled={busy || !acknowledged || (blocked && !editing) || (editing && !prompt.trim())} onClick={() => void retry()}>
      {busy ? 'Checking retry…' : intent.current ? 'Check / retry same request' : editing ? 'Retry with reviewed modifications' : 'Retry generation'}
    </button>
    {blocked && !editing && <p>Blocked content requires a revised prompt before retrying.</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
