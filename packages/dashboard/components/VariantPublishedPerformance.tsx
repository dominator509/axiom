'use client';

import { useRef, useState } from 'react';
import { readDashboardJson } from '@/lib/response';
import type { VariantGuidanceSummary } from '@/lib/api';
import GuidanceSummary from './VariantGuidanceSummary';
import { useLocale } from './LocaleProvider';

type Observation = { targetId: string; variantId: string; collectedAt: string; views: number; likes: number; shares: number; comments: number; engagementRate: number; guidance?: VariantGuidanceSummary | null };
export default function VariantPublishedPerformance({ modelId, experimentId }: { modelId: string; experimentId: string }) {
  const { t } = useLocale();
  const [rows, setRows] = useState<Observation[]>([]), [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(''), [truncated, setTruncated] = useState(false);
  const [assessment, setAssessment] = useState('');
  const active = useRef(false);
  async function load() {
    if (active.current) return;
    active.current = true; setBusy(true); setError('');
    try {
      const response = await fetch(`/api/v1/models/${encodeURIComponent(modelId)}/variant-experiments/${encodeURIComponent(experimentId)}/performance`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('Performance unavailable');
      const result = await readDashboardJson<{ data: Observation[]; assessment?: { status: string }; meta: { truncated: boolean; source: string } }>(response);
      if (!Array.isArray(result.data) || result.meta?.source !== 'published-target-metrics' || typeof result.meta.truncated !== 'boolean' ||
        result.data.some(row => typeof row.targetId !== 'string' || typeof row.variantId !== 'string' || typeof row.collectedAt !== 'string' ||
          ![row.views, row.likes, row.shares, row.comments, row.engagementRate].every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0))) throw new Error('Invalid performance');
      setRows(result.data); setTruncated(result.meta.truncated); setLoaded(true);
      const messages: Record<string, string> = {
        insufficient: t('variant.performance.assessment.insufficient'),
        inconclusive: t('variant.performance.assessment.inconclusive'),
        candidate: t('variant.performance.assessment.candidate'),
        unavailable: t('variant.performance.assessment.unavailable'),
      };
      setAssessment(messages[result.assessment?.status ?? ''] ?? '');
    } catch { setError(t('variant.performance.error')); }
    finally { active.current = false; setBusy(false); }
  }
  return <details className="stack"><summary>{t('variant.performance.title')}</summary>
    <p>{t('variant.performance.description')}</p>
    <button type="button" className="btn secondary" disabled={busy} onClick={() => void load()}>{busy ? t('variant.performance.loading') : t('variant.performance.refresh')}</button>
    {loaded && rows.length === 0 && <p>{t('variant.performance.empty')}</p>}
    {truncated && <p role="status">{t('variant.performance.truncated')}</p>}
    {assessment && <p role="status">{assessment}</p>}
    <div className="stack">{rows.map(row => <article className="card stack" key={row.targetId}>
      <strong>{t('variant.performance.variantPost', { variant: row.variantId.slice(0, 8), post: row.targetId.slice(0, 8) })}</strong>
      <span>{t('variant.performance.counts', { views: row.views, likes: row.likes, shares: row.shares, comments: row.comments })}</span>
      <span>{t('variant.performance.engagement', { value: (row.engagementRate * 100).toFixed(2) })}</span>
      <span className="subtle">{t('variant.performance.collected', { value: row.collectedAt })}</span>
      <GuidanceSummary guidance={row.guidance} />
    </article>)}</div>
    {error && <p role="alert">{error}</p>}
  </details>;
}
