// F-33 — model-scoped provider cache-control preferences.
//
// The route stores only bounded, non-secret settings. It returns disabled
// defaults for missing rows and never exposes credentials or provider payloads.

import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { schema } from '@axiom/db';
import { CACHE_CONTROL_PROVIDERS } from '@axiom/llm-gateway';
import type { AppBindings } from '../index.js';
import { boundedJsonValidator } from '../bounded-json-validator.js';
import { apiError, requireOrg, statusTitle, withOrgContext, writeAudit } from './helpers.js';
import { modelAccessCondition } from '../model-access.js';

const router = new Hono<AppBindings>();
const uuid = z.string().uuid();
const providerEnum = z.enum(CACHE_CONTROL_PROVIDERS);
const promptCacheKey = z.string().regex(/^[A-Za-z0-9._:-]{1,64}$/);

const patchSchema = z.object({
  provider: providerEnum,
  enabled: z.boolean(),
  prefixAlignment: z.boolean().optional(),
  promptCacheKey: promptCacheKey.nullable().optional(),
}).strict();

const READ_ROLES = new Set(['owner', 'manager', 'operator']);
const WRITE_ROLES = new Set(['owner', 'manager']);

interface CacheControlView {
  provider: string;
  enabled: boolean;
  prefixAlignment: boolean;
  promptCacheKey: string | null;
}

function absent(provider: string): CacheControlView {
  return { provider, enabled: false, prefixAlignment: false, promptCacheKey: null };
}

function present(row: CacheControlView): CacheControlView {
  return {
    provider: row.provider,
    enabled: row.enabled,
    prefixAlignment: row.prefixAlignment,
    promptCacheKey: row.promptCacheKey,
  };
}

router.get('/models/:modelId/cache-controls', async c => {
  c.header('Cache-Control', 'private, no-store');
  const orgId = requireOrg(c);
  const userId = c.get('userId');
  const role = c.get('role');
  const modelId = c.req.param('modelId');
  if (!orgId || !userId) return apiError(c, 401, statusTitle(401), 'authenticated workspace required');
  if (!READ_ROLES.has(role ?? '')) return apiError(c, 403, statusTitle(403), 'cache controls unavailable');
  if (!uuid.safeParse(modelId).success) return apiError(c, 400, statusTitle(400), 'valid model required');

  const rows = await withOrgContext(orgId, tx => tx
    .select()
    .from(schema.providerCacheControl)
    .where(and(
      eq(schema.providerCacheControl.orgId, orgId),
      eq(schema.providerCacheControl.modelId, modelId),
      modelAccessCondition(role, orgId, userId, schema.providerCacheControl.modelId),
    )));

  // Unknown or unauthorized models deliberately look like an unconfigured
  // model; this endpoint cannot be used as an existence/settings oracle.
  const byProvider = new Map<string, CacheControlView>(
    (rows as CacheControlView[]).map(row => [row.provider, row]),
  );
  return c.json({
    success: true,
    data: {
      modelId,
      controls: CACHE_CONTROL_PROVIDERS.map(provider => {
        const row = byProvider.get(provider);
        return row ? present(row) : absent(provider);
      }),
    },
  });
});

router.patch('/models/:modelId/cache-controls', boundedJsonValidator('json', patchSchema), async c => {
  c.header('Cache-Control', 'private, no-store');
  const orgId = requireOrg(c);
  const userId = c.get('userId');
  const role = c.get('role');
  const modelId = c.req.param('modelId');
  if (!orgId || !userId) return apiError(c, 401, statusTitle(401), 'authenticated workspace required');
  if (!WRITE_ROLES.has(role ?? '')) return apiError(c, 403, statusTitle(403), 'cache controls unavailable');
  if (!uuid.safeParse(modelId).success) return apiError(c, 400, statusTitle(400), 'valid model required');

  const body = c.req.valid('json');
  const values = {
    orgId,
    modelId,
    provider: body.provider,
    enabled: body.enabled,
    prefixAlignment: body.prefixAlignment ?? false,
    promptCacheKey: body.promptCacheKey ?? null,
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

    const [row] = await tx.insert(schema.providerCacheControl)
      .values(values)
      .onConflictDoUpdate({
        target: [schema.providerCacheControl.orgId, schema.providerCacheControl.modelId, schema.providerCacheControl.provider],
        set: {
          enabled: values.enabled,
          prefixAlignment: values.prefixAlignment,
          promptCacheKey: values.promptCacheKey,
          updatedAt: new Date(),
        },
      })
      .returning();
    if (!row) throw new Error('provider cache-control upsert returned no row');
    await writeAudit(tx, orgId, userId, 'model.cache_controls.update', row.id, {
      modelId,
      provider: body.provider,
      enabled: body.enabled,
      prefixAlignment: values.prefixAlignment,
      hasPromptCacheKey: values.promptCacheKey !== null,
    });
    return row;
  });

  if (result === 'denied') return apiError(c, 404, statusTitle(404), 'model not found');
  return c.json({ success: true, data: present(result) });
});

export { router as providerCacheControlsRouter };
