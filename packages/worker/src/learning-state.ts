import { sql } from 'drizzle-orm';

export interface LearningArm { arm: string; alpha: number; beta: number; recentUses: number }

// Marsaglia-Tsang Gamma sampler; Beta is the ratio of independent Gamma draws.
function gamma(shape: number, rng: () => number): number {
  const uniform = () => Math.max(Number.EPSILON, Math.min(1 - Number.EPSILON, rng()));
  if (shape < 1) return gamma(shape + 1, rng) * uniform() ** (1 / shape);
  const d = shape - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (let attempt = 0; attempt < 10000; attempt++) {
    const x = Math.sqrt(-2 * Math.log(uniform())) * Math.cos(2 * Math.PI * uniform());
    const base = 1 + c * x;
    if (base <= 0) continue;
    const v = base ** 3, u = uniform();
    if (u < 1 - .0331 * x ** 4 || Math.log(u) < .5 * x ** 2 + d * (1 - v + Math.log(v))) return d * v;
  }
  throw new Error('Learning sampler did not converge');
}

export function chooseLearningArm(arms: LearningArm[], rng = Math.random): string | null {
  if (!arms.length) return null;
  for (const arm of arms) {
    if (![arm.alpha, arm.beta, arm.recentUses].every(Number.isFinite) || arm.alpha <= 0 || arm.beta <= 0 || arm.recentUses < 0)
      throw new Error('Invalid learning posterior');
  }
  // Five percent uniform exploration keeps every available arm reachable.
  if (rng() < .05) return arms[Math.min(arms.length - 1, Math.max(0, Math.floor(rng() * arms.length)))].arm;
  let selected = arms[0].arm, best = -1;
  for (const arm of arms) {
    const a = gamma(arm.alpha, rng), b = gamma(arm.beta, rng);
    const score = (a / (a + b)) / (1 + arm.recentUses);
    if (score > best) { best = score; selected = arm.arm; }
  }
  return selected;
}

export async function selectLearnedGuidance(tx: any, orgId: string, modelId: string, platform: string, arms: string[], scheduledFor: Date | string | null) {
  if (!arms.length) return null;
  const context = learningStructure('', scheduledFor).context;
  const result = await tx.execute(sql`SELECT s.arm,s.alpha,s.beta,
    (SELECT COUNT(*) FROM viral_recipe r JOIN post_target t ON t.id=r.source_target_id AND t.org_id=r.org_id
      WHERE r.org_id=s.org_id AND r.model_id=s.model_id AND r.platform=s.platform
      AND t.state='published' AND t.remote_id IS NOT NULL AND t.platform=r.platform
      AND r.recipe->>'evidence_source'='published-provider-snapshot-v2'
      AND r.recipe->>'learning_arm'=s.arm
      AND t.published_at > now()-interval '24 hours' AND t.published_at <= now()) AS recent_uses
    FROM (${learningPosterior(orgId, modelId, platform)}) s WHERE s.org_id=${orgId} AND s.model_id=${modelId}
      AND s.platform=${platform} AND s.context=${context}
      AND EXISTS (SELECT 1 FROM viral_recipe r WHERE r.org_id=s.org_id AND r.model_id=s.model_id
        AND r.platform=s.platform AND r.recipe->>'learning_context'=s.context
        AND r.recipe->>'learning_arm'=s.arm AND r.recipe->>'evidence_source'='published-provider-snapshot-v2')`);
  const states = new Map<string, LearningArm>((result.rows ?? []).map((row: { arm: string; alpha: number; beta: number; recent_uses: string }) =>
    [row.arm, { arm: row.arm, alpha: Number(row.alpha), beta: Number(row.beta), recentUses: Number(row.recent_uses) }]));
  return chooseLearningArm(arms.map(arm => states.get(arm) ?? { arm, alpha: 1, beta: 1, recentUses: 0 }));
}

export function learningStructure(caption: string, scheduledFor: Date | string | null) {
  const date = scheduledFor === null ? null : new Date(scheduledFor);
  const bucket = date && Number.isFinite(date.getTime()) ? Math.floor(date.getUTCHours() / 6) : 'unknown';
  return {
    arm: `${caption.length < 80 ? 'short' : caption.length < 240 ? 'medium' : 'long'}:${caption.includes('?') ? 'question' : 'statement'}`,
    context: `learn-v1:scheduled-utc-${bucket}`,
  };
}

/** One observation per published target, with a 30-day half-life measured from
 * publication, never from polling/recipe refresh. Decay both success and failure
 * evidence toward the Beta(1,1) prior. Plays remains the raw observation count.
 * Selection derives this at the transaction clock too: an idle cached posterior
 * must not freeze old evidence in time. No new provider call or state write.
 */
function learningPosterior(orgId: string, modelId: string, platform: string) {
  return sql`SELECT r.org_id,r.model_id,r.platform,r.recipe->>'learning_context' AS context,r.recipe->>'learning_arm' AS arm,
      1+SUM(score.value * age.weight) AS alpha,
      1+SUM((1-score.value) * age.weight) AS beta,COUNT(*)::integer AS plays,
      SUM(score.value * age.weight) AS reward
    FROM viral_recipe r JOIN post_target t ON t.id=r.source_target_id AND t.org_id=r.org_id
    CROSS JOIN LATERAL (SELECT CASE WHEN EXISTS (
      SELECT 1 FROM variant_experiment e
      CROSS JOIN LATERAL jsonb_array_elements(e.evaluation->'observations') observation
      WHERE e.org_id=r.org_id AND e.model_id=r.model_id AND e.platform=r.platform
        AND e.evaluation_policy='fixed-post-engagement-v1' AND e.status='completed'
        AND e.winner_variant_id IS NOT NULL
        AND observation->>'targetId'=r.source_target_id::text
        AND observation->>'variantId'=e.winner_variant_id::text
    ) THEN 1.0 ELSE LEAST(1.0,GREATEST(0.0,r.perf_score)) END AS value) score
    CROSS JOIN LATERAL (SELECT POWER(0.5, GREATEST(0.0,
      EXTRACT(EPOCH FROM (now()-t.published_at))) / 2592000.0) AS weight) age
    WHERE r.org_id=${orgId} AND r.model_id=${modelId} AND r.platform=${platform}
      AND t.state='published' AND t.remote_id IS NOT NULL AND t.platform=r.platform
      AND t.published_at IS NOT NULL AND t.published_at <= now()
      AND r.recipe->>'evidence_source'='published-provider-snapshot-v2'
      AND r.recipe->>'learning_context' LIKE 'learn-v1:%'
      AND r.recipe->>'learning_arm' IS NOT NULL
    GROUP BY r.org_id,r.model_id,r.platform,r.recipe->>'learning_context',r.recipe->>'learning_arm'`;
}

/** Caller holds the model/platform advisory lock throughout recipe refresh. */
export async function refreshLearningState(tx: any, orgId: string, modelId: string, platform: string) {
  await tx.execute(sql`UPDATE bandit_state SET alpha=1, beta=1, plays=0, reward=0, updated_at=now()
    WHERE org_id=${orgId} AND model_id=${modelId} AND platform=${platform} AND context LIKE 'learn-v1:%'`);
  await tx.execute(sql`INSERT INTO bandit_state(org_id,model_id,platform,context,arm,alpha,beta,plays,reward)
    ${learningPosterior(orgId, modelId, platform)}
    ON CONFLICT(org_id,model_id,platform,context,arm) WHERE context LIKE 'learn-v1:%'
    DO UPDATE SET alpha=EXCLUDED.alpha,beta=EXCLUDED.beta,plays=EXCLUDED.plays,reward=EXCLUDED.reward,updated_at=now()`);
}
