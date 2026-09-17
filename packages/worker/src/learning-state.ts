import { sql } from 'drizzle-orm';

export function learningStructure(caption: string, scheduledFor: Date | string | null) {
  const date = scheduledFor === null ? null : new Date(scheduledFor);
  const bucket = date && Number.isFinite(date.getTime()) ? Math.floor(date.getUTCHours() / 6) : 'unknown';
  return {
    arm: `${caption.length < 80 ? 'short' : caption.length < 240 ? 'medium' : 'long'}:${caption.includes('?') ? 'question' : 'statement'}`,
    context: `learn-v1:scheduled-utc-${bucket}`,
  };
}

/** Recompute Beta sufficient statistics from one current record per target.
 * Caller holds the model/platform advisory lock throughout recipe refresh.
 * Clipping a z-score directly to [0,1] follows the documented reward contract.
 */
export async function refreshLearningState(tx: any, orgId: string, modelId: string, platform: string) {
  await tx.execute(sql`UPDATE bandit_state SET alpha=1, beta=1, plays=0, reward=0, updated_at=now()
    WHERE org_id=${orgId} AND model_id=${modelId} AND platform=${platform} AND context LIKE 'learn-v1:%'`);
  await tx.execute(sql`INSERT INTO bandit_state(org_id,model_id,platform,context,arm,alpha,beta,plays,reward)
    SELECT r.org_id,r.model_id,r.platform,r.recipe->>'learning_context',r.recipe->>'learning_arm',
      1+SUM(LEAST(1.0,GREATEST(0.0,r.perf_score))),
      1+COUNT(*)-SUM(LEAST(1.0,GREATEST(0.0,r.perf_score))),COUNT(*)::integer,
      SUM(LEAST(1.0,GREATEST(0.0,r.perf_score)))
    FROM viral_recipe r JOIN post_target t ON t.id=r.source_target_id AND t.org_id=r.org_id
    WHERE r.org_id=${orgId} AND r.model_id=${modelId} AND r.platform=${platform}
      AND t.state='published' AND t.remote_id IS NOT NULL AND t.platform=r.platform
      AND r.recipe->>'evidence_source'='published-provider-v1'
      AND r.recipe->>'learning_context' LIKE 'learn-v1:%'
      AND r.recipe->>'learning_arm' IS NOT NULL
    GROUP BY r.org_id,r.model_id,r.platform,r.recipe->>'learning_context',r.recipe->>'learning_arm'
    ON CONFLICT(org_id,model_id,platform,context,arm) WHERE context LIKE 'learn-v1:%'
    DO UPDATE SET alpha=EXCLUDED.alpha,beta=EXCLUDED.beta,plays=EXCLUDED.plays,reward=EXCLUDED.reward,updated_at=now()`);
}
