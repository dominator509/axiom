// F-14 — model-scoped dynamic watermark policy.
//
// The route stores only bounded, non-secret presentation settings plus the
// object key of the model's own watermark asset. It returns a disabled default
// for a missing row and never exposes credentials, CDN tokens, signed URLs, or
// transformed media bytes.

import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { schema } from '@axiom/db';
import {
  WATERMARK_POSITIONS,
  WATERMARK_KEY_PATTERN,
  WATERMARK_OPACITY_MIN,
  WATERMARK_OPACITY_MAX,
  WATERMARK_SCALE_MIN,
  WATERMARK_SCALE_MAX,
  WATERMARK_POSITION_DEFAULT,
} from '@axiom/core';
import { normalizeR2ObjectKey } from '@axiom/llm-gateway';
import type { AppBindings } from '../index.js';
import { boundedJsonValidator } from '../bounded-json-validator.js';
import { apiError, requireOrg, statusTitle, withOrgContext, writeAudit } from './helpers.js';
import { modelAccessCondition } from '../model-access.js';

const router = new Hono<AppBindings>();
const uuid = z.string().uuid();
const positionEnum = z.enum(WATERMARK_POSITIONS);
const watermarkKey = z.string().regex(WATERMARK_KEY_PATTERN);
const opacity = z.number().int().min(WATERMARK_OPACITY_MIN).max(WATERMARK_OPACITY_MAX);
const scale = z.number().int().min(WATERMARK_SCALE_MIN).max(WATERMARK_SCALE_MAX);

// An enabled policy must name an asset; a disabled policy must not. This mirrors
// the storage-layer CHECK so the API rejects the same shapes the DB refuses.
const patchSchema = z.object({
  enabled: z.boolean(),
  watermarkKey: watermarkKey.nullable().optional(),
  position: positionEnum.optional(),
  opacity: opacity.optional(),
  scale: scale.optional(),
}).strict().refine(
  value => value.enabled ? value.watermarkKey != null : value.watermarkKey == null,
  { message: 'enabled watermark policy requires a watermarkKey, disabled must omit it' },
);

const READ_ROLES = new Set(['owner', 'manager', 'operator']);
const WRITE_ROLES = new Set(['owner', 'manager']);

interface WatermarkPolicyView {
  enabled: boolean;
  watermarkKey: string | null;
  position: string;
  opacity: number;
  scale: number;
}

function absent(): WatermarkPolicyView {
  return {
    enabled: false,
    watermarkKey: null,
    position: WATERMARK_POSITION_DEFAULT,
    opacity: 60,
    scale: 100,
  };
}

function present(row: WatermarkPolicyView): WatermarkPolicyView {
  return {
    enabled: row.enabled,
    watermarkKey: row.watermarkKey,
    position: row.position,
    opacity: row.opacity,
    scale: row.scale,
  };
}

router.get('/models/:modelId/watermark-policy', async c => {
  c.header('Cache-Control', 'private, no-store');
  const orgId = requireOrg(c);
  const userId = c.get('userId');
  const role = c.get('role');
  const modelId = c.req.param('modelId');
  if (!orgId || !userId) return apiError(c, 401, statusTitle(401), 'authenticated workspace required');
  if (!READ_ROLES.has(role ?? '')) return apiError(c, 403, statusTitle(403), 'watermark policy unavailable');
  if (!uuid.safeParse(modelId).success) return apiError(c, 400, statusTitle(400), 'valid model required');

  const rows = await withOrgContext(orgId, tx => tx
    .select()
    .from(schema.watermarkPolicy)
    .where(and(
      eq(schema.watermarkPolicy.orgId, orgId),
      eq(schema.watermarkPolicy.modelId, modelId),
      modelAccessCondition(role, orgId, userId, schema.watermarkPolicy.modelId),
    ))
    .limit(1));

  // Unknown or unauthorized models deliberately look like an unconfigured
  // model; this endpoint cannot be used as an existence/settings oracle.
  const row = rows[0];
  return c.json({
    success: true,
    data: {
      modelId,
      policy: row ? present(row) : absent(),
    },
  });
});

router.patch('/models/:modelId/watermark-policy', boundedJsonValidator('json', patchSchema), async c => {
  c.header('Cache-Control', 'private, no-store');
  const orgId = requireOrg(c);
  const userId = c.get('userId');
  const role = c.get('role');
  const modelId = c.req.param('modelId');
  if (!orgId || !userId) return apiError(c, 401, statusTitle(401), 'authenticated workspace required');
  if (!WRITE_ROLES.has(role ?? '')) return apiError(c, 403, statusTitle(403), 'watermark policy unavailable');
  if (!uuid.safeParse(modelId).success) return apiError(c, 400, statusTitle(400), 'valid model required');

  const body = c.req.valid('json');
  if (body.enabled) {
    try {
      normalizeR2ObjectKey(body.watermarkKey!, { orgId, modelId });
    } catch {
      return apiError(c, 400, statusTitle(400), 'watermarkKey must identify an asset owned by this model');
    }
  }
  const values = {
    orgId,
    modelId,
    enabled: body.enabled,
    watermarkKey: body.enabled ? body.watermarkKey ?? null : null,
    position: body.position ?? WATERMARK_POSITION_DEFAULT,
    opacity: body.opacity ?? 60,
    scale: body.scale ?? 100,
  };

  const result = await withOrgContext(orgId, async tx => {
    const [model] = await tx.select({ id: schema.modelProfile.id })
      .from(schema.modelProfile)
      .where(and(
        eq(schema.modelProfile.orgId, orgId),
        eq(schema.modelProfile.id, modelId),
        modelAccessCondition(role, orgId, userId, schema.modelProfile.id),
      ))
      .limit(1);
    if (!model) return 'denied' as const;

    const [row] = await tx.insert(schema.watermarkPolicy)
      .values(values)
      .onConflictDoUpdate({
        target: [schema.watermarkPolicy.orgId, schema.watermarkPolicy.modelId],
        set: {
          enabled: values.enabled,
          watermarkKey: values.watermarkKey,
          position: values.position,
          opacity: values.opacity,
          scale: values.scale,
          updatedAt: new Date(),
        },
      })
      .returning();
    if (!row) throw new Error('watermark policy upsert returned no row');
    await writeAudit(tx, orgId, userId, 'model.watermark_policy.update', row.id, {
      modelId,
      enabled: values.enabled,
      position: values.position,
      opacity: values.opacity,
      scale: values.scale,
      hasWatermarkKey: values.watermarkKey !== null,
    });
    return row;
  });

  if (result === 'denied') return apiError(c, 404, statusTitle(404), 'model not found');
  return c.json({ success: true, data: present(result) });
});

export { router as watermarkPolicyRouter };
