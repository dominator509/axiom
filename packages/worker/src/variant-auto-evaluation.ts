import { and, eq, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { schema } from '@axiom/db';
import { assessVariantPerformance, type VariantObservation } from './variant-evaluation.js';

export function evaluationDigest(evaluation: Record<string, unknown>): string {
  const sort = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sort);
    if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, sort(child)]));
    return value;
  };
  // Normalize Dates exactly as JSONB stores them, then remove object-key order.
  return createHash('sha256').update(JSON.stringify(sort(JSON.parse(JSON.stringify(evaluation))))).digest('hex');
}

async function auditEvaluation(tx: any, orgId: string, experimentId: string, evaluation: Record<string, unknown>) {
  await tx.execute(sql`SELECT id FROM org WHERE id=${orgId} FOR UPDATE`);
  const previous = await tx.select({ hash: schema.auditLog.rowHash, ts: schema.auditLog.ts }).from(schema.auditLog)
    .where(eq(schema.auditLog.orgId, orgId)).orderBy(sql`${schema.auditLog.ts} DESC, ${schema.auditLog.id} DESC`).limit(1);
  const prevHash = previous[0]?.hash ? Buffer.from(previous[0].hash) : Buffer.alloc(32);
  const ts = new Date(Math.max(Date.now(), previous[0]?.ts ? new Date(previous[0].ts).getTime() + 1 : 0));
  const evidenceDigest = evaluationDigest(evaluation);
  // The legacy verifier canonicalizes top-level keys only. Binding the digest
  // into target protects the entire evaluation without changing old chains.
  const target = `${experimentId}:${evidenceDigest}`;
  const detail = { experimentId, evidenceDigest, policy: evaluation.policy, assessment: evaluation.assessment };
  const payload = { org_id: orgId, actor_ref: 'worker:variant-evaluation', action: 'variant.experiment.auto-evaluate', target, detail, ts: ts.toISOString(), prev_hash: prevHash.toString('hex') };
  const rowHash = createHash('sha256').update(JSON.stringify(payload, Object.keys(payload).sort())).digest();
  await tx.insert(schema.auditLog).values({ orgId, actorRef: payload.actor_ref, action: payload.action, target, detail, ts, prevHash, rowHash });
}

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
    const evaluation = { policy: experiment.evaluationPolicy, assessment, observations: rows };
    await tx.update(schema.variantExperiment).set({
      status: 'completed', winnerVariantId: assessment.candidateVariantId,
      evaluation, updatedAt: new Date(),
    }).where(eq(schema.variantExperiment.id, experiment.id));
    await auditEvaluation(tx, orgId, experiment.id, evaluation);
  }
}
