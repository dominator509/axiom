// ─── Analytics (F-27, L3.0) — real post_metric aggregates ───
// GET /models/:id/analytics — per-platform totals + engagement over window.

import { Hono } from 'hono';
import { sql, eq, and, gte } from 'drizzle-orm';
import { schema } from '@axiom/db';
import type { AppBindings } from '../index.js';
import { withOrgContext, requireOrg, apiError, statusTitle } from './helpers.js';

const router = new Hono<AppBindings>();

type MetricAggregateRow = {
  platform: string;
  views: number;
  likes: number;
  shares: number;
  comments: number;
  engagementRate: number;
};

type DailyMetricRow = {
  day: string;
  views: number;
  likes: number;
};

function resultRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object' && 'rows' in result) {
    const rows = (result as { rows?: unknown }).rows;
    return Array.isArray(rows) ? (rows as T[]) : [];
  }
  return [];
}

// GET /models/:id/analytics?days=30 — dashboard aggregates
router.get('/models/:modelId/analytics', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const { modelId } = c.req.param();
  const days = Math.min(Math.max(parseInt(c.req.query('days') ?? '30', 10) || 30, 1), 365);
  const since = new Date(Date.now() - days * 86_400_000);

  const data = await withOrgContext(orgId, async (tx) => {
    // Provider metrics are cumulative snapshots, not deltas. Select the
    // newest observation per target before aggregating or repeated polling
    // would inflate the dashboard totals.
    const perPlatformResult = await tx.execute(sql`
      WITH latest_metrics AS (
        SELECT DISTINCT ON (pm.post_target_id)
          pm.post_target_id,
          pm.platform,
          pm.views,
          pm.likes,
          pm.shares,
          pm.comments,
          pm.engagement_rate
        FROM post_metric pm
        INNER JOIN post_target pt ON pt.id = pm.post_target_id
        INNER JOIN content_bundle cb ON cb.id = pt.bundle_id
        WHERE cb.model_id = ${modelId}
          AND cb.org_id = ${orgId}
          AND pt.org_id = ${orgId}
          AND pm.collected_at >= ${since}
        ORDER BY pm.post_target_id, pm.collected_at DESC
      )
      SELECT
        platform,
        COALESCE(SUM(views), 0)::int AS views,
        COALESCE(SUM(likes), 0)::int AS likes,
        COALESCE(SUM(shares), 0)::int AS shares,
        COALESCE(SUM(comments), 0)::int AS comments,
        COALESCE(AVG(engagement_rate), 0)::float8 AS "engagementRate"
      FROM latest_metrics
      GROUP BY platform
      ORDER BY SUM(views) DESC
    `);
    const perPlatform = resultRows<MetricAggregateRow>(perPlatformResult);

    // For the trend, retain one latest snapshot per target per calendar day;
    // summing every intraday poll would report the same cumulative counters
    // repeatedly.
    const dailyResult = await tx.execute(sql`
      WITH daily_latest AS (
        SELECT DISTINCT ON (pm.post_target_id, DATE_TRUNC('day', pm.collected_at))
          DATE_TRUNC('day', pm.collected_at) AS day,
          pm.post_target_id,
          pm.views,
          pm.likes
        FROM post_metric pm
        INNER JOIN post_target pt ON pt.id = pm.post_target_id
        INNER JOIN content_bundle cb ON cb.id = pt.bundle_id
        WHERE cb.model_id = ${modelId}
          AND cb.org_id = ${orgId}
          AND pt.org_id = ${orgId}
          AND pm.collected_at >= ${since}
        ORDER BY pm.post_target_id, DATE_TRUNC('day', pm.collected_at), pm.collected_at DESC
      )
      SELECT
        TO_CHAR(day, 'YYYY-MM-DD') AS day,
        COALESCE(SUM(views), 0)::int AS views,
        COALESCE(SUM(likes), 0)::int AS likes
      FROM daily_latest
      GROUP BY day
      ORDER BY day
    `);
    const daily = resultRows<DailyMetricRow>(dailyResult);

    const totals = perPlatform.reduce(
      (
        acc: { views: number; likes: number; shares: number; comments: number },
        r: { views: number; likes: number; shares: number; comments: number },
      ) => ({
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
      .where(
        and(
          eq(schema.contentBundle.orgId, orgId),
          eq(schema.contentBundle.modelId, modelId),
          eq(schema.postTarget.orgId, orgId),
          gte(schema.postMetric.collectedAt, since),
        ),
      );

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
