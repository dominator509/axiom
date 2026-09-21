'use client';

import { useLocale } from './LocaleProvider';

type Summary = { variantId: string; posts: number; mean: number };
type Assessment = { status: 'candidate' | 'inconclusive'; sampleSize: number; radius: number; candidateVariantId: string | null; summaries: Summary[] };

function readAssessment(value: unknown, variantIds: string[], winner: string | null): Assessment | null {
  if (!value || typeof value !== 'object') return null;
  const saved = value as { policy?: unknown; assessment?: unknown };
  if (saved.policy !== 'fixed-post-engagement-v1' || !saved.assessment || typeof saved.assessment !== 'object') return null;
  const assessment = saved.assessment as Assessment;
  if (!['candidate', 'inconclusive'].includes(assessment.status) || assessment.sampleSize !== 20 ||
    !Number.isFinite(assessment.radius) || assessment.radius < 0 || assessment.radius > 1 ||
    !Array.isArray(assessment.summaries) || assessment.summaries.length !== variantIds.length || variantIds.length < 2 || variantIds.length > 10) return null;
  const ids = new Set<string>();
  for (const row of assessment.summaries) {
    if (!row || !variantIds.includes(row.variantId) || ids.has(row.variantId) || row.posts !== 20 ||
      !Number.isFinite(row.mean) || row.mean < 0 || row.mean > 1) return null;
    ids.add(row.variantId);
  }
  if (assessment.status === 'candidate') {
    if (!assessment.candidateVariantId || !ids.has(assessment.candidateVariantId) || winner !== assessment.candidateVariantId) return null;
  } else if (assessment.candidateVariantId !== null || winner !== null) return null;
  return assessment;
}

export default function VariantEvaluationReport({ evaluation, variantIds, winnerVariantId }: {
  evaluation: unknown; variantIds: string[]; winnerVariantId: string | null;
}) {
  const { t } = useLocale();
  if (evaluation == null) return null;
  const assessment = readAssessment(evaluation, variantIds, winnerVariantId);
  if (!assessment) return <p role="alert">{t('variant.evaluation.invalid')}</p>;
  return <details className="stack"><summary>{t('variant.evaluation.title')}</summary>
    <p>{assessment.status === 'candidate' ? t('variant.evaluation.candidate') : t('variant.evaluation.inconclusive')}</p>
    <p>{t('variant.evaluation.evidence')}</p>
    <div className="grid">{assessment.summaries.map(row => <article className="card stack" key={row.variantId}>
      <h4>{t('variant.evaluation.variant', { id: row.variantId.slice(0, 8) })}{row.variantId === winnerVariantId ? ` · ${t('variant.evaluation.winner')}` : ''}</h4>
      <span>{t('variant.evaluation.posts', { count: row.posts })}</span>
      <span>{t('variant.evaluation.mean', { value: (row.mean * 100).toFixed(2) })}</span>
      <span>{t('variant.evaluation.interval', { value: `${(Math.max(0, row.mean - assessment.radius) * 100).toFixed(2)}%–${(Math.min(1, row.mean + assessment.radius) * 100).toFixed(2)}` })}%</span>
    </article>)}</div>
    <p className="subtle">{t('variant.evaluation.disclaimer')}</p>
  </details>;
}
