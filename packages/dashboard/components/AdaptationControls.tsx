'use client';

import { useRef, useState } from 'react';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';
import { useLocale } from './LocaleProvider';

export default function AdaptationControls({ bundleId, revisionId, platforms }: { bundleId: string; revisionId?: string; platforms: string[] }) {
  const { t } = useLocale();
  const [platform, setPlatform] = useState(platforms[0] ?? 'instagram');
  const [instructions, setInstructions] = useState(() => t('review.adaptationDefault'));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const intent = useRef<{ body: string; key: string } | null>(null);
  async function submit() {
    if (busy || !instructions.trim()) return;
    intent.current ??= { body: JSON.stringify({ instructions: `[${platform}] ${instructions.trim()}`, revisionId }), key: createIdempotencyKey() };
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await mutationFetch(`/api/v1/bundles/${encodeURIComponent(bundleId)}/revise`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: intent.current.body }, { idempotencyKey: intent.current.key, retries: 0 });
      if (!response.ok) { const details = await readDashboardError(response); setError(details?.error?.message ?? t('review.adaptationNotQueued')); if ([400, 401, 403, 404, 409, 422].includes(response.status)) intent.current = null; return; }
      const result = await readDashboardJson<{ data?: unknown }>(response); if (!result.data) throw new Error('unconfirmed adaptation response');
      intent.current = null; setMessage(t('review.adaptationQueued'));
    } catch { setError(t('review.adaptationUnconfirmed')); }
    finally { setBusy(false); }
  }
  return <details><summary>{t('review.adaptationSummary')}</summary><div className="stack" style={{ marginTop: 8 }}><div className="row"><label>{t('review.targetPlatform')}<select value={platform} onChange={event => setPlatform(event.target.value)}>{platforms.map(value => <option key={value}>{value}</option>)}</select></label></div><label>{t('review.adaptationInstructions')}<textarea value={instructions} maxLength={2000} disabled={busy || !!intent.current} onChange={event => setInstructions(event.target.value)} /></label><button className="btn secondary" type="button" disabled={busy || !!intent.current || !instructions.trim()} onClick={() => void submit()}>{busy ? t('review.queueingAdaptation') : t('review.queueAdaptation')}</button>{intent.current && <button className="btn secondary" type="button" disabled={busy} onClick={() => void submit()}>{t('review.retrySameAdaptation')}</button>}{message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}</div></details>;
}
