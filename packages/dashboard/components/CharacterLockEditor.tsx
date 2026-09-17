'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';

export default function CharacterLockEditor({ modelId, initialPrompt, initialVersion }: {
  modelId: string; initialPrompt: string; initialVersion: number;
}) {
  const router = useRouter();
  const [prompt, setPrompt] = useState(initialPrompt);
  const [version, setVersion] = useState(initialVersion);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const active = useRef(false);
  const intent = useRef<{ body: string; key: string; prompt: string; version: number } | null>(null);
  async function save() {
    if (active.current || conflict || prompt.length > 2000) return;
    active.current = true; setBusy(true); setMessage(null);
    intent.current ??= { body: JSON.stringify({ characterLockPrompt: prompt.trim(), characterLockVersion: version }),
      key: createIdempotencyKey(), prompt: prompt.trim(), version };
    try {
      const response = await mutationFetch(`/api/v1/models/${encodeURIComponent(modelId)}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: intent.current.body,
      }, { idempotencyKey: intent.current.key, retries: 0 });
      if (!response.ok) {
        const error = await readDashboardError(response);
        if (error.code === 'CHARACTER_LOCK_CONFLICT') setConflict(true);
        setMessage(typeof error.detail === 'string' ? error.detail : 'Save was not confirmed. Check the same request before editing again.');
        return;
      }
      const { data } = await readDashboardJson<{ data: { id: string; characterLockPrompt: string; characterLockVersion: number } }>(response);
      if (data?.id !== modelId || data.characterLockPrompt !== intent.current.prompt
        || data.characterLockVersion !== intent.current.version + 1) throw new Error('Unexpected saved revision');
      setPrompt(data.characterLockPrompt); setVersion(data.characterLockVersion);
      intent.current = null;
      setMessage('Character lock saved. Existing generations and retries retain their previous snapshot.');
    } catch {
      setMessage('Save outcome unconfirmed. Check the same save request; the editor stays locked to prevent overwriting another revision.');
    } finally { active.current = false; setBusy(false); }
  }
  return <section aria-label="Character lock editor" className="stack">
    <label htmlFor={`character-lock-${modelId}`}>Character / persona lock prompt</label>
    <textarea id={`character-lock-${modelId}`} rows={8} maxLength={2000} value={prompt}
      disabled={busy || conflict || !!intent.current} onChange={event => setPrompt(event.target.value)} />
    <p>Revision {version}. Describe consistent appearance and persona here. New image/video jobs snapshot this text; scene instructions remain separate. Clear the field and save to disable it for new jobs.</p>
    <button type="button" disabled={busy || conflict || prompt.length > 2000} onClick={() => void save()}>
      {busy ? 'Saving…' : intent.current ? 'Check same save request' : 'Save character lock'}
    </button>
    {conflict && <button type="button" onClick={() => router.refresh()}>Reload current profile</button>}
    {message && <p role="status">{message}</p>}
  </section>;
}
