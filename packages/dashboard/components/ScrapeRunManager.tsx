'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ScrapeRun } from '@/lib/api';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';
import ScrapeResult from './ScrapeResult';

export default function ScrapeRunManager({ modelId, runs, canEdit }: { modelId: string; runs: ScrapeRun[]; canEdit: boolean }) {
  const router = useRouter();
  const [kind, setKind] = useState<'social' | 'competitor'>('social');
  const [platform, setPlatform] = useState('instagram');
  const [profileUrl, setProfileUrl] = useState('');
  const [brandName, setBrandName] = useState('');
  const [industry, setIndustry] = useState('');
  const [platforms, setPlatforms] = useState('instagram, tiktok');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const intent = useRef<{ key: string; body: string } | null>(null);

  async function submit() {
    if (busy) return;
    const body = kind === 'social'
      ? { kind, platform, profileUrl: profileUrl.trim() }
      : { kind, brandName: brandName.trim(), industry: industry.trim(), platforms: platforms.split(',').map(value => value.trim()).filter(Boolean) };
    intent.current ??= { key: createIdempotencyKey(), body: JSON.stringify(body) };
    setBusy(true); setError('');
    try {
      const response = await mutationFetch(`/api/v1/models/${encodeURIComponent(modelId)}/scrape-runs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: intent.current.body }, { idempotencyKey: intent.current.key, retries: 0 });
      if (!response.ok) { const details = await readDashboardError(response); setError(details?.error?.message ?? 'Scrape was not queued.'); if ([400, 401, 403, 404, 409, 422].includes(response.status)) intent.current = null; return; }
      const result = await readDashboardJson<{ data?: unknown }>(response); if (!result.data) throw new Error('unconfirmed scrape response');
      intent.current = null; router.refresh();
    } catch { setError('Scrape queueing was not confirmed. Retry the same request.'); }
    finally { setBusy(false); }
  }

  return <div className="stack">
    <p className="subtle">Scrapes run through the authenticated sidecar and the model egress policy. Results are research data, not provider metrics or publication instructions.</p>
    {error && <p role="alert">{error}</p>}
    {canEdit && <fieldset className="stack" disabled={busy || intent.current !== null} style={{ border: 0, padding: 0, minWidth: 0 }}><legend>Start a research run</legend><label>Run type<select value={kind} onChange={event => setKind(event.target.value as 'social' | 'competitor')}><option value="social">Social profile</option><option value="competitor">Competitor benchmark</option></select></label>{kind === 'social' ? <div className="row"><label>Platform<select value={platform} onChange={event => setPlatform(event.target.value)}><option>instagram</option><option>tiktok</option><option>threads</option><option>x</option><option>youtube</option><option>reddit</option></select></label><label style={{ flex: 1 }}>Public HTTPS profile URL<input value={profileUrl} onChange={event => setProfileUrl(event.target.value)} placeholder="https://..." /></label></div> : <div className="row"><label>Brand<input value={brandName} onChange={event => setBrandName(event.target.value)} /></label><label>Industry<input value={industry} onChange={event => setIndustry(event.target.value)} /></label><label>Platforms<input value={platforms} onChange={event => setPlatforms(event.target.value)} /></label></div>}<button className="btn" type="button" onClick={() => void submit()}>Queue scrape</button></fieldset>}
    {intent.current && <button className="btn secondary" type="button" disabled={busy} onClick={() => void submit()}>Retry same scrape request</button>}
    {runs.length === 0 ? <p>No scraper runs yet.</p> : <div className="stack">{runs.map(run => <article className="card stack" key={run.id}><div className="row" style={{ justifyContent: 'space-between' }}><strong>{run.kind} research</strong><span className={`badge ${run.state === 'completed' ? 'good' : run.state === 'failed' ? 'bad' : 'warn'}`}>{run.state}</span></div>{run.error && <p role="alert">{run.error}</p>}{run.completedAt && <p className="subtle">Finished {new Date(run.completedAt).toLocaleString()}</p>}{run.result && <ScrapeResult kind={run.kind} result={run.result} />}</article>)}</div>}
  </div>;
}
