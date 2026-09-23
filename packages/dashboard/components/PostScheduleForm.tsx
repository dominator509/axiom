'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { approvalSlot } from '@/lib/schedule';
import { readDashboardError } from '@/lib/response';
import { readBoundedResponseJson } from '@axiom/core';
import { useLocale } from './LocaleProvider';

const defaultCalendarText: Record<string, string> = {
  'calendar.confirmScheduleFirst': 'Confirm the schedule change first.',
  'calendar.chooseAction': 'Choose a schedule action.',
  'calendar.futureDateTime': 'Choose a future date and time to reschedule.',
};

type CalendarTranslate = (key: string) => string;

export function postScheduleIntent(
  data: FormData,
  translate: CalendarTranslate = key => defaultCalendarText[key] ?? key,
  platform?: string,
) {
  if (data.get('confirm') !== 'on') throw new Error(translate('calendar.confirmScheduleFirst'));
  const action = data.get('action');
  if (action === 'cancel') return { method: 'DELETE' as const, body: undefined };
  if (action !== 'reschedule') throw new Error(translate('calendar.chooseAction'));
  const scheduledFor = approvalSlot(String(data.get('scheduledFor') ?? ''));
  if (!scheduledFor) throw new Error(translate('calendar.futureDateTime'));
  const deliveryMode = data.get('tiktokDeliveryMode');
  return { method: 'PATCH' as const, body: JSON.stringify({
    scheduledFor,
    ...(platform === 'tiktok' && (deliveryMode === 'direct' || deliveryMode === 'draft')
      ? { providerOptions: { tiktokDeliveryMode: deliveryMode } }
      : {}),
  }) };
}

export default function PostScheduleForm({
  postId,
  platform,
  tiktokDeliveryMode = 'direct',
}: { postId: string; platform?: string; tiktokDeliveryMode?: 'direct' | 'draft' }) {
  const { t } = useLocale();
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
      intent.current ??= { ...postScheduleIntent(new FormData(form), t, platform), key: createIdempotencyKey() };
    } catch (failure) { setError(failure instanceof Error ? failure.message : t('calendar.checkScheduleFields')); return; }
    active.current = true; setBusy(true); setPending(true);
    try {
      const request = intent.current;
      const response = await mutationFetch(`/api/v1/posts/${encodeURIComponent(postId)}`, {
        method: request.method, ...(request.body ? { headers: { 'content-type': 'application/json' }, body: request.body } : {}),
      }, { idempotencyKey: request.key, retries: 0 });
      if (!response.ok) {
        const details = await readDashboardError(response);
        if ([400, 401, 403, 404, 409, 422].includes(response.status)) { intent.current = null; setPending(false); }
        setError(details?.error?.message ?? t('calendar.changeNotConfirmed')); return;
      }
      const result = await readBoundedResponseJson(response) as { data?: { id?: unknown; state?: unknown; scheduledFor?: unknown } } | null;
      if (result?.data?.id !== postId || (request.method === 'DELETE'
        ? result.data.state !== 'canceled'
        : result.data.state !== 'pending' || result.data.scheduledFor !== JSON.parse(request.body!).scheduledFor)) {
        throw new Error(t('calendar.unconfirmedScheduleResponse'));
      }
      intent.current = null; setPending(false); form.reset(); setAction('reschedule');
      setMessage(request.method === 'DELETE' ? t('calendar.canceledNotice') : t('calendar.updatedNotice'));
      router.refresh();
    } catch { setError(t('calendar.checkCalendarRetry')); }
    finally { active.current = false; setBusy(false); }
  }
  return <details>
    <summary>{t('calendar.changeSchedule')}</summary>
    <form className="stack" aria-label={t('calendar.changeScheduleAria')} onSubmit={submit}>
      <p className="subtle">{t('calendar.pendingOnly')}</p>
      <fieldset className="stack" disabled={busy || pending} style={{ border: 0, padding: 0, minWidth: 0 }}>
        <label>{t('calendar.scheduleAction')}<select name="action" value={action} onChange={event => setAction(event.target.value)}><option value="reschedule">{t('calendar.reschedule')}</option><option value="cancel">{t('calendar.cancelScheduled')}</option></select></label>
        {action === 'reschedule' && <label>{t('calendar.newLocalTime')}<input name="scheduledFor" type="datetime-local" required /><span className="subtle">{t('calendar.dstNote')}</span></label>}
        {action === 'reschedule' && platform === 'tiktok' && <label>{t('review.tiktokDeliveryMode')}<select name="tiktokDeliveryMode" defaultValue={tiktokDeliveryMode}><option value="direct">{t('review.tiktokDirectPublish')}</option><option value="draft">{t('review.tiktokDraftUpload')}</option></select></label>}
        <label className="checkbox-option"><input name="confirm" type="checkbox" required /> {t('calendar.confirmChange')}</label>
      </fieldset>
      {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
      <button type="submit" disabled={busy}>{busy ? t('calendar.saving') : pending ? t('calendar.retryOriginal') : t('calendar.confirmSchedule')}</button>
    </form>
  </details>;
}
