'use client';

import { useRef, useState } from 'react';
import type { PlaybookGuideline } from '@/lib/api';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';

const PLATFORMS = ['instagram', 'tiktok', 'threads', 'x', 'youtube', 'reddit', 'facebook', 'telegram', 'discord', 'fanvue'];

export default function PlaybookGuidelineManager({ modelId, initial, canEdit }: { modelId: string; initial: PlaybookGuideline[]; canEdit: boolean }) {
  const first = initial[0];
  const [platform, setPlatform] = useState(first?.platform ?? 'instagram');
  const [optimalTimes, setOptimalTimes] = useState(first?.optimalTimes.join(', ') ?? '18:00');
  const [cadencePerWeek, setCadencePerWeek] = useState(String(first?.cadencePerWeek ?? 3));
  const [upsellStrategy, setUpsellStrategy] = useState(first?.upsellStrategy ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const intent = useRef<{ body: string; key: string } | null>(null);
  function selectPlatform(value: string) { const saved = initial.find(item => item.platform === value); setPlatform(value); setOptimalTimes(saved?.optimalTimes.join(', ') ?? '18:00'); setCadencePerWeek(String(saved?.cadencePerWeek ?? 3)); setUpsellStrategy(saved?.upsellStrategy ?? ''); }
  async function save() {
    if (!canEdit || busy) return;
    intent.current ??= { body: JSON.stringify({ platform, optimalTimes: optimalTimes.split(',').map(value => value.trim()).filter(Boolean), cadencePerWeek: Number(cadencePerWeek), upsellStrategy: upsellStrategy.trim() }), key: createIdempotencyKey() };
    setBusy(true); setMessage(''); setError('');
    try {
      const response = await mutationFetch(`/api/v1/models/${encodeURIComponent(modelId)}/playbook-guidelines`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: intent.current.body }, { idempotencyKey: intent.current.key, retries: 0 });
      if (!response.ok) { const details = await readDashboardError(response); setError(details?.error?.message ?? 'Guideline was not saved.'); if ([400, 401, 403, 404, 409, 422].includes(response.status)) intent.current = null; return; }
      const result = await readDashboardJson<{ data?: PlaybookGuideline }>(response); if (!result.data) throw new Error('unconfirmed guideline response');
      intent.current = null; setMessage(`Saved ${platform} guideline revision ${result.data.revision}.`);
    } catch { setError('Guideline save was not confirmed. Retry the same change.'); }
    finally { setBusy(false); }
  }
  return <section className="card stack"><h3>Model playbook guidelines</h3><p className="subtle">These settings feed generation guidance and are advisory for scheduling; explicit operator choices and ToS gates still win.</p>{canEdit ? <><div className="row"><label>Platform<select value={platform} onChange={event => selectPlatform(event.target.value)}>{PLATFORMS.map(item => <option key={item}>{item}</option>)}</select></label><label>Cadence / week<input type="number" min="0" max="100" value={cadencePerWeek} onChange={event => setCadencePerWeek(event.target.value)} /></label></div><label>Optimal posting times<input value={optimalTimes} onChange={event => setOptimalTimes(event.target.value)} placeholder="18:00, 21:00" /></label><label>Upsell strategy<textarea value={upsellStrategy} maxLength={2000} onChange={event => setUpsellStrategy(event.target.value)} placeholder="Describe the approved promotion approach" /></label><button className="btn" type="button" disabled={busy || !!intent.current} onClick={() => void save()}>{busy ? 'Saving…' : 'Save guideline'}</button>{intent.current && <button className="btn secondary" type="button" disabled={busy} onClick={() => void save()}>Retry same guideline</button>}</> : <p className="subtle">Guideline changes require an owner, manager, or operator role.</p>}{message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}</section>;
}
