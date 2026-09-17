/** Fixed-sample comparison of bounded per-post engagement, not conversions.
 * Callers must supply attributable provider observations, never manual outcomes.
 * This assessment alone does not authorize promotion or publication.
 */
export interface VariantObservation {
  targetId: string; variantId: string | null; collectedAt: Date | string;
  views: number; engagementRate: number;
}
export function assessVariantPerformance(variantIds: string[], observations: VariantObservation[], truncated = false) {
  const sampleSize = 20;
  if (variantIds.length < 2 || new Set(variantIds).size !== variantIds.length || truncated)
    return { status: 'unavailable' as const, reason: 'Complete evidence for at least two distinct candidates is required.', sampleSize };
  const seen = new Set<string>();
  const valid = observations.filter(row => {
    if (!row.variantId || !variantIds.includes(row.variantId) || seen.has(row.targetId)) return false;
    if (!Number.isSafeInteger(row.views) || row.views <= 0 || !Number.isFinite(row.engagementRate) || row.engagementRate < 0 || row.engagementRate > 1) return false;
    if (!Number.isFinite(new Date(row.collectedAt).getTime())) return false;
    seen.add(row.targetId);
    return true;
  });
  const summaries = variantIds.map(variantId => {
    const rows = valid.filter(row => row.variantId === variantId)
      .sort((a, b) => a.targetId.localeCompare(b.targetId)).slice(0, sampleSize);
    return { variantId, posts: rows.length, mean: rows.length ? rows.reduce((sum, row) => sum + row.engagementRate, 0) / rows.length : 0 };
  });
  if (summaries.some(row => row.posts < sampleSize)) return { status: 'insufficient' as const, sampleSize, summaries };
  // Hoeffding simultaneous bounds for this fixed assessment. Do not present as
  // causal lift or repeatedly tested significance; promotion needs frozen data.
  const radius = Math.sqrt(Math.log(2 * variantIds.length / .05) / (2 * sampleSize));
  const ranked = [...summaries].sort((a, b) => b.mean - a.mean || a.variantId.localeCompare(b.variantId));
  const separated = ranked[0].mean - radius > ranked[1].mean + radius;
  return { status: separated ? 'candidate' as const : 'inconclusive' as const, sampleSize, summaries,
    candidateVariantId: separated ? ranked[0].variantId : null, radius };
}
