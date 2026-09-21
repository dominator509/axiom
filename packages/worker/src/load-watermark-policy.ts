import { and, eq } from 'drizzle-orm';
import { schema } from '@axiom/db';
import {
  ABSENT_WATERMARK_POLICY,
  watermarkTransformFields,
  type WatermarkPolicyView,
} from '@axiom/core';

type Transaction = Parameters<Parameters<typeof import('@axiom/db').db.transaction>[0]>[0];

/**
 * Load the model-scoped watermark policy. An absent row yields the disabled
 * default, so a model without a policy keeps the pre-F-14 media behaviour.
 */
export async function loadWatermarkPolicy(
  tx: Transaction,
  orgId: string,
  modelId: string,
): Promise<WatermarkPolicyView> {
  const [row] = await tx
    .select()
    .from(schema.watermarkPolicy)
    .where(and(
      eq(schema.watermarkPolicy.orgId, orgId),
      eq(schema.watermarkPolicy.modelId, modelId),
    ))
    .limit(1);
  if (!row) return ABSENT_WATERMARK_POLICY;
  return {
    enabled: row.enabled,
    watermarkKey: row.watermarkKey,
    position: row.position,
    opacity: row.opacity,
    scale: row.scale,
  };
}

/**
 * Resolve the bounded media-plane watermark fields for a model, or null when
 * the policy is disabled or any value is out of range (fail closed).
 */
export async function loadWatermarkTransform(
  tx: Transaction,
  orgId: string,
  modelId: string,
): Promise<{ watermarkKey: string; position: string; opacity: number; scale: number } | null> {
  const policy = await loadWatermarkPolicy(tx, orgId, modelId);
  const fields = watermarkTransformFields(policy);
  if (!fields || policy.watermarkKey === null) return null;
  return { watermarkKey: policy.watermarkKey, ...fields };
}
