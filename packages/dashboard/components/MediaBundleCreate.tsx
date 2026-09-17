'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';
import { approvalSlot } from '@/lib/schedule';

const platforms = ['instagram', 'tiktok', 'x', 'youtube', 'reddit', 'threads', 'discord', 'telegram', 'facebook', 'snapchat', 'fanvue'];

export default function MediaBundleCreate({ modelId, assetId, mimeType }: { modelId: string; assetId: string; mimeType: string }) {
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
    if (!intent.current && !caption.trim()) { setMessage('Write a caption before creating a review bundle.'); return; }
    let scheduledAt: string | undefined;
    if (!intent.current) {
      try { scheduledAt = approvalSlot(requestedSlot); }
      catch (error) { setMessage(error instanceof Error ? error.message : 'Choose a valid future time.'); return; }
    }
    active.current = true; setBusy(true); setPending(true); setMessage('');
    intent.current ??= { key: createIdempotencyKey(), body: JSON.stringify({ modelId, assetId, captions: { [platform]: caption.trim() }, hashtags: [], ...(scheduledAt ? { scheduleRequest: { platform, scheduledAt } } : {}) }) };
    try {
      const response = await mutationFetch('/api/v1/bundles', { method: 'POST', headers: { 'content-type': 'application/json' }, body: intent.current.body },
        { idempotencyKey: intent.current.key, retries: 0 });
      if (!response.ok) {
        const error = await readDashboardError(response);
        setMessage(error?.error?.message ?? 'Bundle creation was not confirmed.');
        if ([400, 401, 403, 404, 422].includes(response.status)) { intent.current = null; setPending(false); }
        return;
      }
      const result = await readDashboardJson<{ data?: { id?: string; publishIntent?: { action?: string; platform?: string; scheduledAt?: string } } }>(response);
      if (!result.data?.id || !/^[0-9a-f-]{36}$/i.test(result.data.id)) throw new Error('Unconfirmed bundle');
      const requested = JSON.parse(intent.current.body).scheduleRequest;
      if (requested && (result.data.publishIntent?.action !== 'schedule' || result.data.publishIntent.platform !== requested.platform || result.data.publishIntent.scheduledAt !== requested.scheduledAt)) throw new Error('Unconfirmed requested schedule');
      intent.current = null; setPending(false); setCreated(true);
      setMessage('Review bundle saved. A fresh media and caption scan is queued. Nothing was published.');
    } catch { setMessage('Outcome unconfirmed. Check the same request to avoid creating another bundle.'); }
    finally { active.current = false; setBusy(false); }
  }
  if (!['image/jpeg', 'image/png', 'video/mp4'].includes(mimeType)) return <p className="subtle">To prepare this video for approval, transcode it to MP4 first.</p>;
  return <details><summary>Create post from this media</summary><div className="stack">
    <p>Choose a destination and write a caption. This creates a new review bundle, without generating media or publishing.</p>
    {!created && <><fieldset className="stack" disabled={busy || pending}>
      <label>Destination<select value={platform} onChange={event => setPlatform(event.target.value)}>{platforms.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>Caption<textarea maxLength={10000} value={caption} onChange={event => setCaption(event.target.value)} /></label>
      <label>Requested posting time (optional, your local time)<input type="datetime-local" value={requestedSlot} onChange={event => setRequestedSlot(event.target.value)} /></label>
      <p className="subtle">This is a request for the approver, not a scheduled publication. Leave blank to let them choose. During a repeated daylight-saving hour, the first occurrence is used.</p>
    </fieldset><button type="button" className="btn secondary" disabled={busy} onClick={() => void submit()}>{busy ? 'Saving review bundle…' : pending ? 'Check same request' : 'Create review bundle'}</button></>}
    {message && <p role="status">{message}</p>}
    {created && <Link className="btn secondary" href={`/models/${encodeURIComponent(modelId)}/approvals`}>Open approvals</Link>}
  </div></details>;
}
