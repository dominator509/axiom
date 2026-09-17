'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError } from '@/lib/response';
import type { FanContact } from '@/lib/api';

const statuses = ['pending', 'filming', 'editing', 'delivered'];
export function requestPayload(data: FormData, modelId?: string) {
  const value = (key: string) => String(data.get(key) ?? '').trim();
  if (!modelId) {
    const status = value('status');
    if (!statuses.includes(status)) throw new Error('Choose a valid request status.');
    return { status };
  }
  const title = value('title'), description = value('description'), fanId = value('fanId'), price = value('priceUsd');
  if (!title || title.length > 200 || description.length > 4000) throw new Error('Enter a title and check the description length.');
  if (price && (!Number.isFinite(Number(price)) || Number(price) < 0)) throw new Error('Price must be a nonnegative amount.');
  return { modelId, title, ...(description ? { description } : {}), ...(fanId ? { fanId } : {}), ...(price ? { priceUsd: Number(price) } : {}) };
}

type Props = { modelId: string; fans: FanContact[] } | { requestId: string; status: string; title: string };
export default function CustomRequestForm(props: Props) {
  const create = 'modelId' in props;
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
      if (!intent.current) intent.current = {
        body: JSON.stringify(requestPayload(new FormData(form), create ? props.modelId : undefined)), key: createIdempotencyKey(),
      };
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Check the request fields.'); return; }
    active.current = true; setBusy(true); setPending(true);
    try {
      const response = await mutationFetch(create ? '/api/v1/custom-requests' : `/api/v1/custom-requests/${encodeURIComponent(props.requestId)}`, {
        method: create ? 'POST' : 'PATCH', headers: { 'content-type': 'application/json' }, body: intent.current.body,
      }, { idempotencyKey: intent.current.key });
      if (!response.ok) {
        const details = await readDashboardError(response);
        if ([400, 401, 403, 404, 422].includes(response.status)) { intent.current = null; setPending(false); }
        setError(details?.error?.message ?? 'Save not confirmed. Retry the same request.'); return;
      }
      intent.current = null; setPending(false);
      if (create) form.reset();
      setMessage(create ? 'Request created.' : 'Status saved.'); router.refresh();
    } catch { setError('Save not confirmed. Retry the same request before making another change.'); }
    finally { active.current = false; setBusy(false); }
  }
  return <form className="stack" onSubmit={submit} aria-label={create ? 'Create custom request' : `Update status for ${props.title}`}>
    <fieldset disabled={busy || pending} className="stack" style={{ border: 0, padding: 0, minWidth: 0 }}>
      {create ? <>
        <h3>Create custom request</h3>
        <label>Title<input name="title" required maxLength={200} /></label>
        <label>Description<textarea name="description" maxLength={4000} rows={3} /></label>
        <label>Fan (optional)<select name="fanId" defaultValue=""><option value="">No linked contact</option>
          {props.fans.map(fan => <option key={fan.id} value={fan.id}>{fan.displayName ?? fan.id} · {fan.platform}</option>)}
        </select></label>
        <p className="subtle">Choose from contacts loaded on this page. Creating a request records work only; it does not charge or message the fan.</p>
        <label>Price (USD, optional)<input name="priceUsd" type="number" min="0" step="0.01" /></label>
      </> : <label>Request status<select key={props.status} name="status" defaultValue={props.status}>
        {statuses.map(status => <option key={status} value={status}>{status}</option>)}
      </select></label>}
    </fieldset>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    <button type="submit" disabled={busy}>{busy ? 'Saving…' : pending ? 'Retry same request' : create ? 'Create request' : 'Save status'}</button>
  </form>;
}
