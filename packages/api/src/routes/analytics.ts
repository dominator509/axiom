// ─── Analytics (F-27, L3.0) — real post_metric aggregates ───
// GET /models/:id/analytics — per-platform totals + engagement over window.

import { Hono } from 'hono';
import { sql, eq, and, gte } from 'drizzle-orm';
import { schema } from '@axiom/db';
import type { AppBindings } from '../index.js';
import { withOrgContext, requireOrg } from './helpers.js';

const router = new Hono<AppBindings>();

// GET /models/:id/analytics?days=30 — dashboard aggregates
router.get('/models/:modelId/analytics', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return c.json({ error: { message: 'orgId required' } }, 401);
  const { modelId } = c.req.param();
  const days = Math.min(Math.max(parseInt(c.req.query('days') ?? '30', 10) || 30, 1), 365);
  const since = new Date(Date.now() - days * 86_400_000);

  const data = await withOrgContext(orgId, async (tx) => {
    // Aggregate metrics per platform over the window (join via post_target → bundle)
    const perPlatform = await tx
      .select({
        platform: schema.postMetric.platform,
        views: sql<number>`coalesce(sum(${schema.postMetric.views}),0)::int`,
        likes: sql<number>`coalesce(sum(${schema.postMetric.likes}),0)::int`,
        shares: sql<number>`coalesce(sum(${schema.postMetric.shares}),0)::int`,
        comments: sql<number>`coalesce(sum(${schema.postMetric.comments}),0)::int`,
        engagementRate: sql<number>`coalesce(avg(${schema.postMetric.engagementRate}),0)`,
      })
      .from(schema.postMetric)
      .innerJoin(schema.postTarget, eq(schema.postTarget.id, schema.postMetric.postTargetId))
      .innerJoin(schema.contentBundle, eq(schema.contentBundle.id, schema.postTarget.bundleId))
      .where(
        and(
          eq(schema.contentBundle.modelId, modelId),
          eq(schema.contentBundle.orgId, orgId),
          gte(schema.postMetric.collectedAt, since),
        ),
      )
      .groupBy(schema.postMetric.platform)
      .orderBy(sql`sum(${schema.postMetric.views}) DESC`);

    // Recent daily series (last 14 days) for the trend chart
    const daily = await tx
      .select({
        day: sql<string>`to_char(${schema.postMetric.collectedAt}, 'YYYY-MM-DD')`,
        views: sql<number>`coalesce(sum(${schema.postMetric.views}),0)::int`,
        likes: sql<number>`coalesce(sum(${schema.postMetric.likes}),0)::int`,
      })
      .from(schema.postMetric)
      .innerJoin(schema.postTarget, eq(schema.postTarget.id, schema.postMetric.postTargetId))
      .innerJoin(schema.contentBundle, eq(schema.contentBundle.id, schema.postTarget.bundleId))
      .where(
        and(
          eq(schema.contentBundle.modelId, modelId),
          eq(schema.contentBundle.orgId, orgId),
          gte(schema.postMetric.collectedAt, since),
        ),
      )
      .groupBy(sql`to_char(${schema.postMetric.collectedAt}, 'YYYY-MM-DD')`)
      .orderBy(sql`to_char(${schema.postMetric.collectedAt}, 'YYYY-MM-DD')`);

    const totals = perPlatform.reduce(
      (acc: { views: number; likes: number; shares: number; comments: number }, r: { views: number; likes: number; shares: number; comments: number }) => ({
        views: acc.views + r.views,
        likes: acc.likes + r.likes,
        shares: acc.shares + r.shares,
        comments: acc.comments + r.comments,
      }),
      { views: 0, likes: 0, shares: 0, comments: 0 },
    );
    const postsWithMetrics = await tx
      .select({ count: sql<number>`count(distinct ${schema.postMetric.postTargetId})::int` })
      .from(schema.postMetric)
      .innerJoin(schema.postTarget, eq(schema.postTarget.id, schema.postMetric.postTargetId))
      .innerJoin(schema.contentBundle, eq(schema.contentBundle.id, schema.postTarget.bundleId))
      .where(and(eq(schema.contentBundle.modelId, modelId), gte(schema.postMetric.collectedAt, since)));

    return {
      windowDays: days,
      totals,
      perPlatform,
      daily,
      postsWithMetrics: postsWithMetrics[0]?.count ?? 0,
    };
  });
  return c.json({ data });
});

export { router as analyticsRouter };
