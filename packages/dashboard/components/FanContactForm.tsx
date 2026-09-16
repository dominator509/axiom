'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError } from '@/lib/response';

export function contactPayload(modelId: string, data: FormData) {
  const value = (key: string) => String(data.get(key) ?? '').trim();
  const platform = value('platform');
  const externalId = value('externalId');
  const displayName = value('displayName');
  const tier = value('tier');
  const amount = value('lifetimeValueUsd');
  if (!platform || platform.length > 50 || !externalId || externalId.length > 200 || displayName.length > 200)
    throw new Error('Enter a platform and its fan account ID; check the field lengths.');
  if (tier && !['new', 'loyal', 'whale', 'expired'].includes(tier)) throw new Error('Choose a valid tier.');
  if (amount && (!Number.isFinite(Number(amount)) || Number(amount) < 0)) throw new Error('Lifetime value must be a nonnegative amount.');
  return { modelId, platform, externalId, ...(displayName ? { displayName } : {}),
    ...(tier ? { tier } : {}), ...(amount ? { lifetimeValueUsd: Number(amount) } : {}) };
}

export default function FanContactForm({ modelId }: { modelId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const active = useRef(false);
  const intent = useRef<{ body: string; key: string } | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (active.current) return;
    const form = event.currentTarget;
    setError(''); setMessage('');
    try {
      if (!intent.current) intent.current = {
        body: JSON.stringify(contactPayload(modelId, new FormData(form))), key: createIdempotencyKey(),
      };
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Check the contact fields.'); return; }
    active.current = true; setBusy(true); setPending(true);
    try {
      const response = await mutationFetch(`/api/v1/models/${encodeURIComponent(modelId)}/fans`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: intent.current.body,
      }, { idempotencyKey: intent.current.key });
      if (!response.ok) {
        const details = await readDashboardError(response);
        if ([400, 401, 403, 404, 422].includes(response.status)) { intent.current = null; setPending(false); }
        setError(details?.error?.message ?? 'Save could not be confirmed. Retry the same contact.');
        return;
      }
      intent.current = null; setPending(false); form.reset();
      setMessage('Contact saved.'); router.refresh();
    } catch { setError('Save could not be confirmed. Retry the same contact before entering another.'); }
    finally { active.current = false; setBusy(false); }
  }
  return <form onSubmit={submit} className="card stack" aria-label="Save fan contact">
    <h3>Add or update a fan</h3>
    <p className="subtle">The same platform and fan account ID updates the existing contact. Optional fields left blank keep existing values. This records a contact; it does not send a message.</p>
    <fieldset disabled={busy || pending} className="stack" style={{ border: 0, padding: 0, minWidth: 0 }}>
      <label>Platform<input name="platform" required maxLength={50} placeholder="fanvue" /></label>
      <label>Fan account ID<input name="externalId" required maxLength={200} /></label>
      <label>Display name<input name="displayName" maxLength={200} /></label>
      <label>Tier<select name="tier" defaultValue=""><option value="">Keep existing / new contact</option>
        {['new', 'loyal', 'whale', 'expired'].map(tier => <option key={tier} value={tier}>{tier}</option>)}
      </select></label>
      <label>Recorded lifetime value (USD)<input name="lifetimeValueUsd" type="number" min="0" step="0.01" /></label>
    </fieldset>
    {error && <p role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    <button type="submit" disabled={busy}>{busy ? 'Saving…' : pending ? 'Retry same contact' : 'Save contact'}</button>
  </form>;
}
