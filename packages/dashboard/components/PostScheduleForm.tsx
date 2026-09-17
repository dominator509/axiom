'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { approvalSlot } from '@/lib/schedule';
import { readDashboardError } from '@/lib/response';
import { readBoundedResponseJson } from '@axiom/core';

export function postScheduleIntent(data: FormData) {
  if (data.get('confirm') !== 'on') throw new Error('Confirm the schedule change first.');
  const action = data.get('action');
  if (action === 'cancel') return { method: 'DELETE' as const, body: undefined };
  if (action !== 'reschedule') throw new Error('Choose a schedule action.');
  const scheduledFor = approvalSlot(String(data.get('scheduledFor') ?? ''));
  if (!scheduledFor) throw new Error('Choose a future date and time to reschedule.');
  return { method: 'PATCH' as const, body: JSON.stringify({ scheduledFor }) };
}

export default function PostScheduleForm({ postId }: { postId: string }) {
  const router = useRouter();
  const [action, setAction] = useState('reschedule');
  const [busy, setBusy] = useState(false), [pending, setPending] = useState(false);
  const [message, setMessage] = useState(''), [error, setError] = useState('');
  const active = useRef(false);
  const intent = useRef<ReturnType<typeof postScheduleIntent> & { key: string } | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (active.current) return;
    const form = event.currentTarget;
    setError(''); setMessage('');
    try {
      intent.current ??= { ...postScheduleIntent(new FormData(form)), key: createIdempotencyKey() };
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Check the schedule fields.'); return; }
    active.current = true; setBusy(true); setPending(true);
    try {
      const request = intent.current;
      const response = await mutationFetch(`/api/v1/posts/${encodeURIComponent(postId)}`, {
        method: request.method, ...(request.body ? { headers: { 'content-type': 'application/json' }, body: request.body } : {}),
      }, { idempotencyKey: request.key, retries: 0 });
      if (!response.ok) {
        const details = await readDashboardError(response);
        if ([400, 401, 403, 404, 409, 422].includes(response.status)) { intent.current = null; setPending(false); }
        setError(details?.error?.message ?? 'Change not confirmed. Refresh the calendar to check the post before retrying.'); return;
      }
      const result = await readBoundedResponseJson(response) as { data?: { id?: unknown; state?: unknown; scheduledFor?: unknown } } | null;
      if (result?.data?.id !== postId || (request.method === 'DELETE'
        ? result.data.state !== 'canceled'
        : result.data.state !== 'pending' || result.data.scheduledFor !== JSON.parse(request.body!).scheduledFor)) {
        throw new Error('Unconfirmed schedule response');
      }
      intent.current = null; setPending(false); form.reset(); setAction('reschedule');
      setMessage(request.method === 'DELETE' ? 'Scheduled post canceled. This does not delete anything already published.' : 'Schedule updated. Check the selected month if the post moves out of this view.');
      router.refresh();
    } catch { setError('Change not confirmed. Check the calendar before retrying; retry sends the same original request.'); }
    finally { active.current = false; setBusy(false); }
  }
  return <details>
    <summary>Change schedule or cancel</summary>
    <form className="stack" aria-label="Change scheduled post" onSubmit={submit}>
      <p className="subtle">Only pending posts can be changed. The server will refuse changes once publication begins or its outcome is uncertain.</p>
      <fieldset className="stack" disabled={busy || pending} style={{ border: 0, padding: 0, minWidth: 0 }}>
        <label>Action<select name="action" value={action} onChange={event => setAction(event.target.value)}><option value="reschedule">Reschedule</option><option value="cancel">Cancel scheduled post</option></select></label>
        {action === 'reschedule' && <label>New time (your local time)<input name="scheduledFor" type="datetime-local" required /><span className="subtle">During a repeated daylight-saving hour, the first occurrence is used.</span></label>}
        <label className="checkbox-option"><input name="confirm" type="checkbox" required /> I confirm this schedule change.</label>
      </fieldset>
      {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
      <button type="submit" disabled={busy}>{busy ? 'Saving…' : pending ? 'Retry original change' : 'Confirm schedule change'}</button>
    </form>
  </details>;
}
