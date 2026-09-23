// ─── Analytics (F-27, L3.0) — real post_metric aggregates ───
// GET /models/:id/analytics — per-platform totals + engagement over window.

import { Hono } from 'hono';
import { sql, eq, and, gte } from 'drizzle-orm';
import { schema } from '@axiom/db';
import type { AppBindings } from '../index.js';
import { withOrgContext, requireOrg, apiError, statusTitle } from './helpers.js';
import { modelAccessCondition } from '../model-access.js';

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

type PostPerformanceRow = {
  targetId: string;
  platform: string;
  publishedAt: Date | string;
  collectedAt: Date | string;
  views: number | string;
  likes: number | string;
  shares: number | string;
  comments: number | string;
  engagementRate: number | string;
  providerMetrics: Record<string, number> | null;
  linkClicks: number | string;
  subscriptions: number | string;
  ppvPurchases: number | string;
  refunds: number | string;
  revenueByCurrency: Record<string, number> | null;
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
    const rawScope = modelAccessCondition(c.get('role'), orgId, c.get('userId'), sql`cb.model_id`) ?? sql`true`;
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
          AND ${rawScope}
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
          AND ${rawScope}
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
          modelAccessCondition(c.get('role'), orgId, c.get('userId'), schema.contentBundle.modelId),
          eq(schema.postTarget.orgId, orgId),
          gte(schema.postMetric.collectedAt, since),
        ),
      );

    // A provider snapshot is cumulative, so select one latest observation per
    // published target. First-party short-link clicks and signed Fanvue
    // subscription/PPV facts are joined by the stored per-post UTM identity.
    // No unique-visitor count or external-provider analytics are inferred.
    const postPerformanceResult = await tx.execute(sql`
      WITH latest_metrics AS (
        SELECT DISTINCT ON (pt.id)
          pt.id::text AS "targetId", pt.platform,
          pt.published_at AS "publishedAt", pm.collected_at AS "collectedAt",
          pm.views, pm.likes, pm.shares, pm.comments,
          pm.engagement_rate AS "engagementRate",
          pm.provider_metrics AS "providerMetrics"
        FROM post_target pt
        INNER JOIN content_bundle cb ON cb.id=pt.bundle_id AND cb.org_id=pt.org_id
        INNER JOIN post_metric pm ON pm.post_target_id=pt.id
        WHERE cb.org_id=${orgId} AND cb.model_id=${modelId}
          AND (${rawScope}) AND pt.org_id=${orgId}
          AND pt.state='published' AND pt.remote_id IS NOT NULL AND pt.published_at IS NOT NULL
          AND pm.source='provider' AND pm.platform=pt.platform AND pm.remote_id=pt.remote_id
        ORDER BY pt.id, pm.collected_at DESC, pm.id DESC
      ), targets AS (
        SELECT * FROM latest_metrics ORDER BY "publishedAt" DESC, "collectedAt" DESC LIMIT 100
      ), tracked_links AS (
        SELECT t."targetId", sl.id AS "shortLinkId"
        FROM targets t
        INNER JOIN short_link sl ON sl.org_id=${orgId} AND sl.model_id=${modelId}
          AND sl.utm->>'utm_medium'='post' AND sl.utm->>'utm_content'=t."targetId"
      ), click_counts AS (
        SELECT tl."targetId", count(lc.id)::int AS clicks
        FROM tracked_links tl LEFT JOIN linkbio_click lc ON lc.short_link_id=tl."shortLinkId"
          AND lc.org_id=${orgId}
        GROUP BY tl."targetId"
      ), event_counts AS (
        SELECT tl."targetId",
          count(*) FILTER (WHERE ae.kind='subscription')::int AS subscriptions,
          count(*) FILTER (WHERE ae.kind='ppv_purchase')::int AS "ppvPurchases",
          count(*) FILTER (WHERE ae.kind='subscription_refund')::int AS refunds
        FROM tracked_links tl LEFT JOIN linkbio_attribution_event ae ON ae.short_link_id=tl."shortLinkId"
          AND ae.org_id=${orgId} AND ae.model_id=${modelId} AND ae.source='fanvue'
        GROUP BY tl."targetId"
      ), currency_revenue AS (
        SELECT tl."targetId", ae.currency,
          sum(CASE WHEN ae.kind='subscription_refund' THEN -ae.amount_cents ELSE ae.amount_cents END)::int AS cents
        FROM tracked_links tl INNER JOIN linkbio_attribution_event ae ON ae.short_link_id=tl."shortLinkId"
          AND ae.org_id=${orgId} AND ae.model_id=${modelId} AND ae.source='fanvue'
        GROUP BY tl."targetId", ae.currency
      ), revenue AS (
        SELECT "targetId", jsonb_object_agg(currency,cents) AS "revenueByCurrency"
        FROM currency_revenue GROUP BY "targetId"
      )
      SELECT t."targetId", t.platform, t."publishedAt", t."collectedAt",
        t.views, t.likes, t.shares, t.comments, t."engagementRate", t."providerMetrics",
        coalesce(c.clicks,0)::int AS "linkClicks",
        coalesce(e.subscriptions,0)::int AS subscriptions,
        coalesce(e."ppvPurchases",0)::int AS "ppvPurchases",
        coalesce(e.refunds,0)::int AS refunds,
        coalesce(r."revenueByCurrency",'{}'::jsonb) AS "revenueByCurrency"
      FROM targets t
      LEFT JOIN click_counts c ON c."targetId"=t."targetId"
      LEFT JOIN event_counts e ON e."targetId"=t."targetId"
      LEFT JOIN revenue r ON r."targetId"=t."targetId"
      ORDER BY t."publishedAt" DESC, t."collectedAt" DESC
    `);
    const postPerformance = resultRows<PostPerformanceRow>(postPerformanceResult).map(row => {
      const views = Number(row.views), linkClicks = Number(row.linkClicks);
      return {
        targetId: row.targetId,
        platform: row.platform,
        publishedAt: new Date(row.publishedAt).toISOString(),
        collectedAt: new Date(row.collectedAt).toISOString(),
        views,
        likes: Number(row.likes),
        shares: Number(row.shares),
        comments: Number(row.comments),
        engagementRate: Number(row.engagementRate),
        providerMetrics: row.providerMetrics ?? {},
        linkClicks,
        linkClickRate: views > 0 ? linkClicks / views : null,
        subscriptions: Number(row.subscriptions),
        ppvPurchases: Number(row.ppvPurchases),
        refunds: Number(row.refunds),
        revenueByCurrency: row.revenueByCurrency ?? {},
      };
    });

    return {
      windowDays: days,
      totals,
      perPlatform,
      daily,
      postsWithMetrics: postsWithMetrics[0]?.count ?? 0,
      postPerformance,
    };
  });
  return c.json({ data });
});

export { router as analyticsRouter };
