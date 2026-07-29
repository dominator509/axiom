import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { registry } from './registry.js';
import type { ProviderKind } from './registry.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AppBindings = {
  Variables: {
    userId: string;
    orgId: string;
  };
};

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const enableProviderSchema = z.object({
  kind: z.enum(['native', 'fanlynks', 'linktree', 'beacons']),
  config: z.record(z.unknown()).default({}),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const router = new Hono<AppBindings>();

/**
 * GET /api/v1/models/:id/linkbio
 * Returns the active providers and the primary one for a model.
 */
router.get('/api/v1/models/:id/linkbio', async (c) => {
  const modelId = c.req.param('id');
  const active = registry.getActiveProviders(modelId);
  const primary = registry.getPrimaryProvider(modelId);

  return c.json({
    data: {
      modelId,
      activeProviders: active.map((p) => p.getKind()),
      primaryProvider: primary?.getKind() ?? null,
    },
  });
});

/**
 * POST /api/v1/models/:id/linkbio
 * Enable a provider for a model with the given configuration.
 */
router.post(
  '/api/v1/models/:id/linkbio',
  zValidator('json', enableProviderSchema),
  async (c) => {
    const modelId = c.req.param('id');
    const { kind, config } = c.req.valid('json');

    try {
      await registry.enable(modelId, kind as ProviderKind, config);
      return c.json({ data: { modelId, kind, enabled: true } }, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json({ error: message }, 400);
    }
  },
);

/**
 * DELETE /api/v1/models/:id/linkbio/:kind
 * Disable a provider for a model.
 */
router.delete('/api/v1/models/:id/linkbio/:kind', async (c) => {
  const modelId = c.req.param('id');
  const kind = c.req.param('kind') as ProviderKind;

  const validKinds: ProviderKind[] = ['native', 'fanlynks', 'linktree', 'beacons'];
  if (!validKinds.includes(kind)) {
    return c.json({ error: `Invalid provider kind: ${kind}` }, 400);
  }

  try {
    await registry.disable(modelId, kind);
    return c.json({ data: { modelId, kind, enabled: false } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ error: message }, 400);
  }
});

/**
 * GET /api/v1/models/:id/linkbio/analytics
 * Returns normalized analytics aggregated from all active providers.
 */
router.get('/api/v1/models/:id/linkbio/analytics', async (c) => {
  const modelId = c.req.param('id');

  try {
    const analytics = await registry.getNormalizedAnalytics(modelId);
    return c.json({ data: analytics, meta: { total: analytics.length } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ error: message }, 500);
  }
});

/**
 * GET /link/:handle
 * Renders the native link-in-bio page for a model by handle.
 * Uses the primary provider if available, otherwise falls back to native.
 */
router.get('/link/:handle', async (c) => {
  const handle = c.req.param('handle');
  // In production, resolve handle → modelId via a DB query.
  // For now we use the handle directly as modelId.
  const modelId = handle;

  const provider = registry.getPrimaryProvider(modelId);

  if (!provider) {
    return c.html(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Not Found</title></head>
<body style="font-family:sans-serif;text-align:center;padding:2rem;">
<h1>Profile not found</h1>
<p>No link-in-bio provider is configured for this profile.</p>
</body></html>`, 404);
  }

  const profile = await provider.getProfile(modelId);

  if (typeof profile === 'string') {
    return c.html(profile);
  }

  return c.json(profile);
});

export { router as linkBioRoutes };
