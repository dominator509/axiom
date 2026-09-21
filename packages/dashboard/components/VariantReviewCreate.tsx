'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';
import { useLocale } from './LocaleProvider';

export default function VariantReviewCreate({ modelId, variantId, assignmentId, requiresCaption = false, initialPlatform = 'instagram' }: { modelId: string; variantId: string; assignmentId?: string; requiresCaption?: boolean; initialPlatform?: string }) {
  const { t } = useLocale();
  const [busy, setBusy] = useState(false), [saved, setSaved] = useState(false), [message, setMessage] = useState('');
  const active = useRef(false), key = useRef<string | null>(null);
  const body = useRef<string | null>(null);
  const [caption, setCaption] = useState(''), [platform, setPlatform] = useState(initialPlatform);
  async function create() {
    if (active.current || saved) return;
    if (!body.current && requiresCaption && !caption.trim()) { setMessage(t('variant.review.required')); return; }
    body.current ??= JSON.stringify({ modelId, variantId, assignmentId, ...(requiresCaption ? { variantCaption: { platform, text: caption.trim() } } : {}) });
    active.current = true; setBusy(true); setMessage(''); key.current ??= createIdempotencyKey();
    try {
      const response = await mutationFetch('/api/v1/bundles', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: body.current,
      }, { idempotencyKey: key.current, retries: 0 });
      if (!response.ok) {
        const error = await readDashboardError(response);
        if ([400, 401, 403, 404, 409, 422].includes(response.status)) { key.current = null; body.current = null; }
        setMessage(error?.error?.message ?? t('variant.review.notConfirmed')); return;
      }
      const result = await readDashboardJson<{ data?: { id?: string } }>(response);
      if (!result.data?.id || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(result.data.id)) throw new Error(t('variant.review.notConfirmed'));
      setSaved(true); key.current = null;
      setMessage(t('variant.review.saved'));
    } catch { setMessage(t('variant.review.uncertain')); }
    finally { active.current = false; setBusy(false); }
  }
  return <div className="stack">
    {!saved && requiresCaption && <fieldset className="stack" disabled={busy || key.current !== null}>
      <legend>{t('variant.review.title')}</legend>
      <label>{t('variant.review.platform')}<select value={platform} onChange={event => setPlatform(event.target.value)} disabled={Boolean(assignmentId)}>{['instagram', 'tiktok', 'threads', 'x', 'youtube', 'reddit', 'discord', 'telegram', 'facebook', 'snapchat', 'fanvue'].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>{t('variant.review.caption')}<textarea maxLength={10000} value={caption} onChange={event => setCaption(event.target.value)} /></label>
    </fieldset>}
    {!saved && <button type="button" className="btn secondary" disabled={busy} onClick={() => void create()}>{busy ? t('variant.review.creating') : key.current ? t('variant.review.retry') : t('variant.review.send')}</button>}
    {message && <p role="status">{message}</p>}
    {saved && <Link href={`/models/${encodeURIComponent(modelId)}/approvals`}>{t('variant.openApprovals')}</Link>}
  </div>;
}
