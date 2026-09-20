'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';
import { approvalSlot } from '@/lib/schedule';
import { useLocale } from './LocaleProvider';

const platforms = ['instagram', 'tiktok', 'x', 'youtube', 'reddit', 'threads', 'discord', 'telegram', 'facebook', 'snapchat', 'fanvue'];

export default function MediaBundleCreate({ modelId, assetId, mimeType }: { modelId: string; assetId: string; mimeType: string }) {
  const { t } = useLocale();
  const [platform, setPlatform] = useState('instagram');
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState(false);
  const [message, setMessage] = useState('');
  const [requestedSlot, setRequestedSlot] = useState('');
  const active = useRef(false);
  const intent = useRef<{ body: string; key: string } | null>(null);
  async function submit() {
    if (active.current || created) return;
    if (!intent.current && !caption.trim()) { setMessage(t('review.writeCaption')); return; }
    let scheduledAt: string | undefined;
    if (!intent.current) {
      try { scheduledAt = approvalSlot(requestedSlot); }
      catch (error) { setMessage(error instanceof Error ? error.message : t('review.invalidSchedule')); return; }
    }
    active.current = true; setBusy(true); setPending(true); setMessage('');
    intent.current ??= { key: createIdempotencyKey(), body: JSON.stringify({ modelId, assetId, captions: { [platform]: caption.trim() }, hashtags: [], ...(scheduledAt ? { scheduleRequest: { platform, scheduledAt } } : {}) }) };
    try {
      const response = await mutationFetch('/api/v1/bundles', { method: 'POST', headers: { 'content-type': 'application/json' }, body: intent.current.body },
        { idempotencyKey: intent.current.key, retries: 0 });
      if (!response.ok) {
        const error = await readDashboardError(response);
        setMessage(error?.error?.message ?? t('review.bundleCreationUnconfirmed'));
        if ([400, 401, 403, 404, 422].includes(response.status)) { intent.current = null; setPending(false); }
        return;
      }
      const result = await readDashboardJson<{ data?: { id?: string; publishIntent?: { action?: string; platform?: string; scheduledAt?: string } } }>(response);
      if (!result.data?.id || !/^[0-9a-f-]{36}$/i.test(result.data.id)) throw new Error('Unconfirmed bundle');
      const requested = JSON.parse(intent.current.body).scheduleRequest;
      if (requested && (result.data.publishIntent?.action !== 'schedule' || result.data.publishIntent.platform !== requested.platform || result.data.publishIntent.scheduledAt !== requested.scheduledAt)) throw new Error('Unconfirmed requested schedule');
      intent.current = null; setPending(false); setCreated(true);
      setMessage(t('review.reviewBundleSaved'));
    } catch { setMessage(t('review.outcomeUnconfirmed')); }
    finally { active.current = false; setBusy(false); }
  }
  if (!['image/jpeg', 'image/png', 'video/mp4'].includes(mimeType)) return <p className="subtle">{t('review.transcodeMp4')}</p>;
  return <details><summary>{t('review.createPostFromMedia')}</summary><div className="stack">
    <p>{t('review.bundleDescription')}</p>
    {!created && <><fieldset className="stack" disabled={busy || pending}>
      <label>{t('review.destination')}<select value={platform} onChange={event => setPlatform(event.target.value)}>{platforms.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>{t('review.caption')}<textarea maxLength={10000} value={caption} onChange={event => setCaption(event.target.value)} /></label>
      <label>{t('review.requestedPostingTime')}<input type="datetime-local" value={requestedSlot} onChange={event => setRequestedSlot(event.target.value)} /></label>
      <p className="subtle">{t('review.scheduleRequestHelp')}</p>
    </fieldset><button type="button" className="btn secondary" disabled={busy} onClick={() => void submit()}>{busy ? t('review.savingReviewBundle') : pending ? t('review.checkSameRequest') : t('review.createReviewBundle')}</button></>}
    {message && <p role="status">{message}</p>}
    {created && <Link className="btn secondary" href={`/models/${encodeURIComponent(modelId)}/approvals`}>{t('review.openApprovals')}</Link>}
  </div></details>;
}
