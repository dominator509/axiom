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
  if (evaluation == null) return null;
  const assessment = readAssessment(evaluation, variantIds, winnerVariantId);
  if (!assessment) return <p role="alert">Saved evaluation details could not be verified. No scores are inferred from missing fields.</p>;
  return <details className="stack"><summary>Frozen automatic evaluation</summary>
    <p>{assessment.status === 'candidate' ? 'A winner was selected from this fixed sample.' : 'The fixed sample was inconclusive. No winner was selected.'}</p>
    <p>Each candidate uses 20 distinct published posts and their first stored provider observations at least 72 hours after publication. Later metrics do not change this result.</p>
    <div className="grid">{assessment.summaries.map(row => <article className="card stack" key={row.variantId}>
      <h4>Variant {row.variantId.slice(0, 8)}{row.variantId === winnerVariantId ? ' · Winner' : ''}</h4>
      <span>{row.posts} published posts</span>
      <span>Mean per-post engagement: {(row.mean * 100).toFixed(2)}%</span>
      <span>Comparison interval: {(Math.max(0, row.mean - assessment.radius) * 100).toFixed(2)}%–{(Math.min(1, row.mean + assessment.radius) * 100).toFixed(2)}%</span>
    </article>)}</div>
    <p className="subtle">This comparison does not prove causal lift, independent audiences, attributed sales, or future performance. It does not approve or publish content.</p>
  </details>;
}
