import { and, eq, sql } from 'drizzle-orm';
import { schema } from '@axiom/db';
import { assessVariantPerformance, type VariantObservation } from './variant-evaluation.js';

/** One fixed evaluation; no repeated significance testing and no publishing. */
export async function evaluateAutomaticVariants(tx: any, orgId: string, modelId: string, platform: string) {
  const experiments = await tx.select().from(schema.variantExperiment).where(and(
    eq(schema.variantExperiment.orgId, orgId), eq(schema.variantExperiment.modelId, modelId),
    eq(schema.variantExperiment.platform, platform), eq(schema.variantExperiment.status, 'running'),
    eq(schema.variantExperiment.evaluationPolicy, 'fixed-post-engagement-v1'),
  )).orderBy(schema.variantExperiment.id).for('update');
  for (const experiment of experiments) {
    if (experiment.evaluation) continue;
    // Choose the first twenty published targets per candidate BEFORE testing
    // metric availability. Missing observations cannot be replaced by winners.
    const result = await tx.execute(sql`WITH enrolled AS (
      SELECT p.id,p.remote_id,p.published_at,b.source_variant_id,
        row_number() OVER(PARTITION BY b.source_variant_id ORDER BY p.published_at,p.id) AS position
      FROM variant_experiment_assignment a
      JOIN content_bundle b ON b.id=a.review_bundle_id AND b.source_variant_id=a.variant_id AND b.org_id=a.org_id
      JOIN post_target p ON p.bundle_id=b.id AND p.org_id=b.org_id
      WHERE a.experiment_id=${experiment.id} AND a.org_id=${orgId} AND b.model_id=${modelId}
        AND p.platform=${platform} AND p.state='published' AND p.remote_id IS NOT NULL
        AND p.publication_snapshot IS NOT NULL AND p.published_at IS NOT NULL
    ) SELECT e.id AS "targetId",e.source_variant_id AS "variantId",m.collected_at AS "collectedAt",
        m.views,m.engagement_rate AS "engagementRate"
      FROM enrolled e LEFT JOIN LATERAL (
        SELECT views,engagement_rate,collected_at FROM post_metric
        WHERE post_target_id=e.id AND remote_id=e.remote_id AND platform=${platform} AND source='provider'
          AND collected_at>=e.published_at+interval '72 hours'
        ORDER BY collected_at,id LIMIT 1
      ) m ON true WHERE e.position<=20`);
    // Raw node-postgres BIGINT values are strings (unlike Drizzle's mapped selects).
    // The assessor still rejects unsafe/non-integral values after conversion.
    const rows = (result.rows as VariantObservation[]).map(row => ({ ...row, views: Number(row.views) }));
    if (rows.some(row => row.collectedAt === null)) continue;
    const assessment = assessVariantPerformance(experiment.variantIds, rows);
    if (assessment.status !== 'candidate' && assessment.status !== 'inconclusive') continue;
    await tx.update(schema.variantExperiment).set({
      status: 'completed', winnerVariantId: assessment.candidateVariantId,
      evaluation: { policy: experiment.evaluationPolicy, assessment, observations: rows }, updatedAt: new Date(),
    }).where(eq(schema.variantExperiment.id, experiment.id));
  }
}
