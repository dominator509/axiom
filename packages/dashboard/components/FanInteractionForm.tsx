'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError } from '@/lib/response';

export function interactionPayload(fanId: string, data: FormData) {
  const value = (key: string) => String(data.get(key) ?? '').trim();
  const platform = value('platform'), kind = value('kind'), direction = value('direction'), content = value('content');
  if (!platform || platform.length > 50 || !kind || kind.length > 50) throw new Error('Enter a platform and interaction type (up to 50 characters each).');
  if (!['inbound', 'outbound'].includes(direction)) throw new Error('Choose an interaction direction.');
  if (content.length > 4000) throw new Error('Interaction text must be at most 4,000 characters.');
  return { fanId, platform, kind, direction, ...(content ? { content } : {}) };
}

export default function FanInteractionForm({ fanId, platform }: { fanId: string; platform: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false), [pending, setPending] = useState(false);
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  const active = useRef(false);
  const intent = useRef<{ body: string; key: string } | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (active.current) return;
    const form = event.currentTarget;
    setError(''); setMessage('');
    try {
      if (!intent.current) intent.current = { body: JSON.stringify(interactionPayload(fanId, new FormData(form))), key: createIdempotencyKey() };
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Check interaction fields.'); return; }
    active.current = true; setBusy(true); setPending(true);
    try {
      const response = await mutationFetch(`/api/v1/fans/${encodeURIComponent(fanId)}/touchpoints`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: intent.current.body,
      }, { idempotencyKey: intent.current.key });
      if (!response.ok) {
        const details = await readDashboardError(response);
        if ([400, 401, 403, 404, 422].includes(response.status)) { intent.current = null; setPending(false); }
        setError(details?.error?.message ?? 'Save not confirmed. Retry this same entry.'); return;
      }
      intent.current = null; setPending(false); form.reset();
      setMessage('Interaction recorded. No message was sent.'); router.refresh();
    } catch { setError('Save not confirmed. Retry this same entry before recording another.'); }
    finally { active.current = false; setBusy(false); }
  }
  return <form className="stack" aria-label="Record fan interaction" onSubmit={submit}>
    <h4>Record an interaction</h4>
    <p className="subtle">Save an interaction that already happened. This does not send a message. The record is timestamped when saved.</p>
    <fieldset disabled={busy || pending} className="stack" style={{ border: 0, padding: 0, minWidth: 0 }}>
      <label>Platform<input name="platform" defaultValue={platform} required maxLength={50} /></label>
      <label>Interaction type<input name="kind" required maxLength={50} placeholder="message, comment, purchase…" /></label>
      <label>Direction<select name="direction" defaultValue="inbound"><option value="inbound">From fan</option><option value="outbound">To fan (already sent)</option></select></label>
      <label>Details<textarea name="content" maxLength={4000} rows={4} /></label>
    </fieldset>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    <button type="submit" disabled={busy}>{busy ? 'Saving…' : pending ? 'Retry same entry' : 'Record interaction'}</button>
  </form>;
}
