'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';

const platforms = ['instagram', 'tiktok', 'x', 'youtube', 'reddit', 'threads', 'discord', 'telegram', 'facebook', 'snapchat', 'fanvue'];

export default function MediaBundleCreate({ modelId, assetId, mimeType }: { modelId: string; assetId: string; mimeType: string }) {
  const [platform, setPlatform] = useState('instagram');
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState(false);
  const [message, setMessage] = useState('');
  const active = useRef(false);
  const intent = useRef<{ body: string; key: string } | null>(null);
  async function submit() {
    if (active.current || created) return;
    if (!intent.current && !caption.trim()) { setMessage('Write a caption before creating a review bundle.'); return; }
    active.current = true; setBusy(true); setPending(true); setMessage('');
    intent.current ??= { key: createIdempotencyKey(), body: JSON.stringify({ modelId, assetId, captions: { [platform]: caption.trim() }, hashtags: [] }) };
    try {
      const response = await mutationFetch('/api/v1/bundles', { method: 'POST', headers: { 'content-type': 'application/json' }, body: intent.current.body },
        { idempotencyKey: intent.current.key, retries: 0 });
      if (!response.ok) {
        const error = await readDashboardError(response);
        setMessage(error?.error?.message ?? 'Bundle creation was not confirmed.');
        if ([400, 401, 403, 404, 422].includes(response.status)) { intent.current = null; setPending(false); }
        return;
      }
      const result = await readDashboardJson<{ data?: { id?: string } }>(response);
      if (!result.data?.id || !/^[0-9a-f-]{36}$/i.test(result.data.id)) throw new Error('Unconfirmed bundle');
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
    </fieldset><button type="button" className="btn secondary" disabled={busy} onClick={() => void submit()}>{busy ? 'Saving review bundle…' : pending ? 'Check same request' : 'Create review bundle'}</button></>}
    {message && <p role="status">{message}</p>}
    {created && <Link className="btn secondary" href={`/models/${encodeURIComponent(modelId)}/approvals`}>Open approvals</Link>}
  </div></details>;
}
