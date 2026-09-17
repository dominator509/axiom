'use client';

import { useRef, useState } from 'react';
import { readDashboardJson } from '@/lib/response';

type Observation = { targetId: string; variantId: string; collectedAt: string; views: number; likes: number; shares: number; comments: number; engagementRate: number };
export default function VariantPublishedPerformance({ modelId, experimentId }: { modelId: string; experimentId: string }) {
  const [rows, setRows] = useState<Observation[]>([]), [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(''), [truncated, setTruncated] = useState(false);
  const active = useRef(false);
  async function load() {
    if (active.current) return;
    active.current = true; setBusy(true); setError('');
    try {
      const response = await fetch(`/api/v1/models/${encodeURIComponent(modelId)}/variant-experiments/${encodeURIComponent(experimentId)}/performance`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('Performance unavailable');
      const result = await readDashboardJson<{ data: Observation[]; meta: { truncated: boolean; source: string } }>(response);
      if (!Array.isArray(result.data) || result.meta?.source !== 'published-target-metrics' || typeof result.meta.truncated !== 'boolean' ||
        result.data.some(row => typeof row.targetId !== 'string' || typeof row.variantId !== 'string' || typeof row.collectedAt !== 'string' ||
          ![row.views, row.likes, row.shares, row.comments, row.engagementRate].every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0))) throw new Error('Invalid performance');
      setRows(result.data); setTruncated(result.meta.truncated); setLoaded(true);
    } catch { setError('Published performance could not be loaded. No missing values are treated as confirmed results.'); }
    finally { active.current = false; setBusy(false); }
  }
  return <details className="stack"><summary>Published variant performance</summary>
    <p>Latest stored provider snapshot per published post using an unchanged saved variant. This is separate from manual outcomes and does not establish a statistically valid experiment or attributed sales.</p>
    <button type="button" className="btn secondary" disabled={busy} onClick={() => void load()}>{busy ? 'Loading performance…' : 'Refresh published performance'}</button>
    {loaded && rows.length === 0 && <p>No published metrics are linked to these variants yet.</p>}
    {truncated && <p role="status">Showing only 100 posts. This is not the complete experiment dataset.</p>}
    <div className="stack">{rows.map(row => <article className="card stack" key={row.targetId}>
      <strong>Variant {row.variantId.slice(0, 8)} · post {row.targetId.slice(0, 8)}</strong>
      <span>{row.views} views · {row.likes} likes · {row.shares} shares · {row.comments} comments</span>
      <span>Engagement rate: {(row.engagementRate * 100).toFixed(2)}%</span>
      <span className="subtle">Collected: {row.collectedAt}</span>
    </article>)}</div>
    {error && <p role="alert">{error}</p>}
  </details>;
}
