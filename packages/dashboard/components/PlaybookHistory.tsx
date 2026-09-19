'use client';

import { useEffect, useRef, useState } from 'react';
import { readDashboardJson } from '@/lib/response';

export interface GuidelineRevision {
  id: string; modelId: string; platform: string; revision: number; optimalTimes: string[];
  cadencePerWeek: number; upsellStrategy: string; recordedAt: string;
}
export function validGuidelineRevision(value: unknown, modelId: string, platform: string): value is GuidelineRevision {
  if (!value || typeof value !== 'object') return false;
  const row = value as GuidelineRevision;
  return typeof row.id === 'string' && row.modelId === modelId && row.platform === platform
    && Number.isSafeInteger(row.revision) && row.revision > 0
    && Number.isSafeInteger(row.cadencePerWeek) && row.cadencePerWeek >= 0 && row.cadencePerWeek <= 100
    && typeof row.upsellStrategy === 'string' && row.upsellStrategy.length <= 2000
    && Array.isArray(row.optimalTimes) && row.optimalTimes.length <= 14 && row.optimalTimes.every(time => typeof time === 'string' && time.length <= 30)
    && typeof row.recordedAt === 'string' && Number.isFinite(Date.parse(row.recordedAt));
}
export default function PlaybookHistory({ modelId, platform, onRestore }: {
  modelId: string; platform: string; onRestore?: (row: GuidelineRevision) => void;
}) {
  const [rows, setRows] = useState<GuidelineRevision[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  async function load(older: boolean) {
    if (request.current) return;
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError('');
    try {
      const query = new URLSearchParams({ history: 'true', platform, ...(older && cursor ? { before: cursor } : {}) });
      const response = await fetch(`/api/v1/models/${encodeURIComponent(modelId)}/playbook-guidelines?${query}`, { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) throw new Error('unavailable');
      const body = await readDashboardJson<{ data: unknown[]; meta: { next_cursor: string | null } }>(response);
      if (!Array.isArray(body.data) || body.data.length > 50 || !body.data.every(row => validGuidelineRevision(row, modelId, platform))
        || !body.meta || (body.meta.next_cursor !== null && !/^[1-9]\d*$/.test(body.meta.next_cursor))) throw new Error('invalid history');
      if (controller.signal.aborted) return;
      setRows(previous => older ? [...previous, ...body.data as GuidelineRevision[]] : body.data as GuidelineRevision[]);
      setCursor(body.meta.next_cursor); setLoaded(true);
    } catch { if (!controller.signal.aborted) setError('Revision history could not be loaded. Try again.'); }
    finally { if (!controller.signal.aborted) { request.current = null; setBusy(false); } }
  }
  return <section className="stack" aria-label="Guideline revision history">
    <h4>Saved revision history</h4>
    <p className="subtle">History is retained from the history upgrade onward. Earlier discarded values cannot be recovered. Loading a revision into the editor does not save it.</p>
    <button className="btn secondary" type="button" disabled={busy} onClick={() => void load(false)}>{busy ? 'Loading…' : 'Load latest history'}</button>
    {error && <p role="alert">{error}</p>}
    {loaded && rows.length === 0 && <p>No retained revisions for this platform yet.</p>}
    {rows.map(row => <article className="card stack" key={row.id}>
      <strong>Revision {row.revision}</strong><p>Recorded {new Date(row.recordedAt).toISOString()}</p>
      <p>{row.cadencePerWeek} posts/week · {row.optimalTimes.join(', ') || 'No posting times specified'}</p>
      <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{row.upsellStrategy || 'No upsell strategy specified'}</p>
      {onRestore && <button type="button" className="btn secondary" onClick={() => onRestore(row)}>Use revision {row.revision} as draft</button>}
    </article>)}
    {cursor && <button className="btn secondary" type="button" disabled={busy} onClick={() => void load(true)}>Load older revisions</button>}
  </section>;
}
