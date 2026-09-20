'use client';

import { useRef, useState } from 'react';
import type { VariantGuidanceAttribution as Attribution } from '@/lib/api';
import { readDashboardJson } from '@/lib/response';
import { useLocale } from './LocaleProvider';

function validAttribution(value: unknown): value is Attribution {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<Attribution>;
  return typeof row.guidanceReceiptId === 'string' && Array.isArray(row.variantIds) &&
    row.variantIds.every(id => typeof id === 'string') &&
    [row.exposures, row.conversions].every(count => typeof count === 'number' && Number.isInteger(count) && count >= 0) &&
    (row.averageMetric === undefined || (typeof row.averageMetric === 'number' && Number.isFinite(row.averageMetric)));
}

export default function VariantGuidanceAttribution({ modelId, experimentId }: { modelId: string; experimentId: string }) {
  const { t } = useLocale();
  const [rows, setRows] = useState<Attribution[]>([]);
  const [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const active = useRef(false);
  async function load() {
    if (active.current) return;
    active.current = true; setBusy(true); setError('');
    try {
      const response = await fetch(`/api/v1/models/${encodeURIComponent(modelId)}/variant-experiments/${encodeURIComponent(experimentId)}/guidance-attribution`, {
        cache: 'no-store', signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error('Attribution unavailable');
      const result = await readDashboardJson<{ data: unknown[]; meta: { source: string; attribution: string } }>(response);
      if (!Array.isArray(result.data) || result.meta?.source !== 'assignment-outcomes' || result.meta.attribution !== 'verified-guidance-receipt' || result.data.some(row => !validAttribution(row))) throw new Error('Invalid attribution');
      setRows(result.data as Attribution[]); setLoaded(true);
    } catch { setError('Selected guidance attribution could not be loaded. No performance conclusion is implied.'); }
    finally { active.current = false; setBusy(false); }
  }
  return <details className="stack"><summary>{t('caption.guidance')} attribution</summary>
    <p className="subtle">Verified guidance receipts are grouped across recorded experiment outcomes. This is observational evidence, not causal lift or publication proof.</p>
    <button type="button" className="btn secondary" disabled={busy} onClick={() => void load()}>{busy ? 'Loading attribution…' : 'Refresh guidance attribution'}</button>
    {loaded && rows.length === 0 && <p className="subtle">No selected guidance has recorded outcomes yet.</p>}
    <div className="stack">{rows.map(row => <article className="card stack" key={row.guidanceReceiptId}>
      <strong>{row.guidanceReceiptId}</strong>
      <span>{row.variantIds.length} variants · {row.exposures} exposures · {row.conversions} conversions</span>
      <span>{row.averageMetric === undefined ? 'Average metric unavailable' : `Average metric: ${row.averageMetric.toFixed(2)}`}</span>
    </article>)}</div>
    {error && <p role="alert">{error}</p>}
  </details>;
}
