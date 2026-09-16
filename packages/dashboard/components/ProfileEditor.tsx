'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { readBoundedResponseJson } from '@axiom/core';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError } from '@/lib/response';

export function profilePayload(form: FormData) {
  const displayName = String(form.get('displayName') ?? '').trim();
  const handle = String(form.get('handle') ?? '').trim();
  const bio = String(form.get('bio') ?? '').trim();
  if (!displayName || displayName.length > 100) throw new Error('Enter a creator name of 1–100 characters.');
  if (!handle || handle.length > 50) throw new Error('Enter a handle of 1–50 characters.');
  if (bio.length > 500) throw new Error('The brand note must be at most 500 characters.');
  return { displayName, handle, bio };
}

export default function ProfileEditor({ model }: { model: { id: string; displayName: string; handle: string; bio: string | null } }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false), [pending, setPending] = useState(false);
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  const active = useRef(false);
  const intent = useRef<{ body: string; key: string } | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (active.current) return;
    setError(''); setMessage('');
    try {
      intent.current ??= { body: JSON.stringify(profilePayload(new FormData(event.currentTarget))), key: createIdempotencyKey() };
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Check profile fields.'); return; }
    active.current = true; setBusy(true); setPending(true);
    try {
      const request = intent.current;
      const response = await mutationFetch(`/api/v1/models/${encodeURIComponent(model.id)}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: request.body,
      }, { idempotencyKey: request.key });
      if (!response.ok) {
        const details = await readDashboardError(response);
        if ([400, 401, 403, 404, 409, 422].includes(response.status)) { intent.current = null; setPending(false); }
        setError(details?.error?.message ?? 'Profile save not confirmed. Retry the same changes.'); return;
      }
      const result = await readBoundedResponseJson(response) as { data?: Record<string, unknown> } | null;
      const expected = JSON.parse(request.body) as Record<string, string>;
      if (result?.data?.id !== model.id || Object.entries(expected).some(([key, value]) => result.data?.[key] !== value)) {
        throw new Error('Unconfirmed profile response');
      }
      intent.current = null; setPending(false); setMessage('Profile saved. Character lock and connected accounts were not changed.'); router.refresh();
    } catch { setError('Profile save not confirmed. Retry the same changes before editing again.'); }
    finally { active.current = false; setBusy(false); }
  }
  return <details>
    <summary>Edit profile details</summary>
    <form className="stack" aria-label="Edit talent profile" onSubmit={submit}>
      <p className="subtle">These fields describe this workspace profile; they do not rename connected social accounts.</p>
      <fieldset className="stack" disabled={busy || pending} style={{ border: 0, padding: 0, minWidth: 0 }}>
        <label>Creator name<input name="displayName" defaultValue={model.displayName} maxLength={100} required /></label>
        <label>Handle<input name="handle" defaultValue={model.handle} maxLength={50} required /></label>
        <label>Brand note<textarea name="bio" defaultValue={model.bio ?? ''} maxLength={500} rows={4} /></label>
      </fieldset>
      {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
      <button type="submit" disabled={busy}>{busy ? 'Saving…' : pending ? 'Retry same profile changes' : 'Save profile details'}</button>
    </form>
  </details>;
}
