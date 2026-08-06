// ─── Viral insights (F-85, L3.0) — real viral_exemplar reads ───
// GET /models/:id/viral — what's-working insights from labeled exemplars.

import { Hono } from 'hono';
import { sql, eq, and, desc } from 'drizzle-orm';
import { schema } from '@axiom/db';
import type { AppBindings } from '../index.js';
import { withOrgContext, requireOrg } from './helpers.js';

const router = new Hono<AppBindings>();

// GET /models/:id/viral — exemplar distribution + top performers
router.get('/models/:modelId/viral', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return c.json({ error: { message: 'orgId required' } }, 401);
  const { modelId } = c.req.param();
  const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10) || 20, 100);

  const data = await withOrgContext(orgId, async (tx) => {
    const byLabel = await tx
      .select({
        label: schema.viralExemplar.label,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.viralExemplar)
      .where(and(eq(schema.viralExemplar.orgId, orgId), eq(schema.viralExemplar.modelId, modelId)))
      .groupBy(schema.viralExemplar.label)
      .orderBy(schema.viralExemplar.label);

    const top = await tx
      .select()
      .from(schema.viralExemplar)
      .where(and(eq(schema.viralExemplar.orgId, orgId), eq(schema.viralExemplar.modelId, modelId)))
      .orderBy(desc(schema.viralExemplar.perfScore))
      .limit(limit);

    const byPlatform = await tx
      .select({
        platform: schema.viralExemplar.platform,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.viralExemplar)
      .where(and(eq(schema.viralExemplar.orgId, orgId), eq(schema.viralExemplar.modelId, modelId)))
      .groupBy(schema.viralExemplar.platform)
      .orderBy(sql`count(*) DESC`);

    return {
      totalExemplars: byLabel.reduce((acc: number, r: { count: number }) => acc + r.count, 0),
      byLabel,
      byPlatform,
      top,
    };
  });
  return c.json({ data });
});

export { router as viralRouter };
