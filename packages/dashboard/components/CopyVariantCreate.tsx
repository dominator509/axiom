'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';

export default function CopyVariantCreate({ modelId, assetId }: { modelId: string; assetId: string }) {
  const [type, setType] = useState('caption');
  const [platform, setPlatform] = useState('instagram');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [saved, setSaved] = useState(false);
  const active = useRef(false), intent = useRef<{ body: string; key: string } | null>(null);
  async function save() {
    if (active.current || saved) return;
    if (!intent.current && !text.trim()) { setMessage('Write the caption or teaser first.'); return; }
    intent.current ??= { key: createIdempotencyKey(), body: JSON.stringify({ assetId, type, platform, text: text.trim() }) };
    active.current = true; setBusy(true); setMessage('');
    try {
      const response = await mutationFetch(`/api/v1/models/${encodeURIComponent(modelId)}/variant-experiments/candidates`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: intent.current.body,
      }, { idempotencyKey: intent.current.key, retries: 0 });
      if (!response.ok) {
        const error = await readDashboardError(response);
        if ([400, 401, 403, 404, 409, 422].includes(response.status)) intent.current = null;
        setMessage(error?.error?.message ?? 'Copy variant was not accepted.'); return;
      }
      const result = await readDashboardJson<{ data?: { id?: string } }>(response);
      if (!result.data?.id || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(result.data.id)) throw new Error('Unconfirmed variant');
      intent.current = null; setSaved(true); setMessage('Copy variant saved. It has not been approved or published.');
    } catch { setMessage('Save was not confirmed. Retry the same request to avoid duplicating the variant.'); }
    finally { active.current = false; setBusy(false); }
  }
  return <details><summary>Create caption or teaser variant</summary><div className="stack">
    <p>Keep this media and test different copy. Each saved version is a separate experiment candidate; saving does not publish anything.</p>
    {!saved && <><fieldset className="stack" disabled={busy || intent.current !== null}>
      <label>Copy type<select value={type} onChange={event => setType(event.target.value)}><option value="caption">Caption</option><option value="teaser">Teaser</option></select></label>
      <label>Platform<select value={platform} onChange={event => setPlatform(event.target.value)}>{['instagram', 'tiktok', 'threads', 'x', 'youtube', 'reddit', 'discord', 'telegram', 'facebook', 'snapchat', 'fanvue'].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>Variant text<textarea value={text} maxLength={10000} onChange={event => setText(event.target.value)} /></label>
    </fieldset><button type="button" className="btn secondary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving variant…' : intent.current ? 'Retry same copy variant' : 'Save copy variant'}</button></>}
    {message && <p role="status">{message}</p>}
    {saved && <div className="action-row"><Link href={`/models/${encodeURIComponent(modelId)}/experiments`}>Open variant experiments</Link><button type="button" className="btn secondary" onClick={() => { setSaved(false); setText(''); setMessage(''); }}>Create another copy variant</button></div>}
  </div></details>;
}
