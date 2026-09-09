import { z } from 'zod';
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { Tier, type AgentPermission, tierAtLeast } from '../auth.js';
import { withModelOrg, schema } from '../org-context.js';

/**
 * Input schema for analytics queries.
 */
export const AnalyticsInputSchema = z.object({
  modelId: z.string().uuid(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  metric: z.enum(['views', 'likes', 'shares', 'comments', 'engagement_rate']).optional(),
});

export type AnalyticsInput = z.infer<typeof AnalyticsInputSchema>;

type MetricRow = {
  postTargetId: string;
  collectedAt: Date | string;
  views: number | null;
  likes: number | null;
  shares: number | null;
  comments: number | null;
  engagementRate: number | null;
};

/** Provider metrics are cumulative snapshots; keep the newest row per post. */
export function latestMetricRows(rows: MetricRow[]): MetricRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.postTargetId)) return false;
    seen.add(row.postTargetId);
    return true;
  });
}

/**
 * Analytics tool — retrieves model performance metrics from post_metric.
 * Available at Viewer tier and above. Real DB query (H-2).
 */
export class AnalyticsTool {
  name = 'analytics_query';
  description =
    'Query model analytics and performance metrics (views, likes, shares, comments, engagement rate) over a date range.';
  inputSchema = AnalyticsInputSchema;
  tier: Tier = Tier.Viewer;
  requiresApproval = false;

  async handle(args: AnalyticsInput, permission: AgentPermission): Promise<unknown> {
    if (!tierAtLeast(permission.tier, this.tier)) {
      throw new Error(`Insufficient permissions: requires ${this.tier}, got ${permission.tier}`);
    }
    if (args.modelId !== permission.modelId) {
      throw new Error(
        `Model mismatch: token scoped to ${permission.modelId}, requested ${args.modelId}`,
      );
    }

    const data = await withModelOrg(args.modelId, async (tx, orgId) => {
      // Join post_metric → post_target → content_bundle to scope to the model.
      const conditions = [
        eq(schema.contentBundle.orgId, orgId),
        eq(schema.contentBundle.modelId, args.modelId),
        eq(schema.postTarget.orgId, orgId),
      ];
      if (args.dateFrom)
        conditions.push(gte(schema.postMetric.collectedAt, new Date(args.dateFrom)));
      if (args.dateTo) conditions.push(lte(schema.postMetric.collectedAt, new Date(args.dateTo)));

      const rows = await tx
        .select({
          postTargetId: schema.postMetric.postTargetId,
          collectedAt: schema.postMetric.collectedAt,
          views: schema.postMetric.views,
          likes: schema.postMetric.likes,
          shares: schema.postMetric.shares,
          comments: schema.postMetric.comments,
          engagementRate: schema.postMetric.engagementRate,
        })
        .from(schema.postMetric)
        .innerJoin(schema.postTarget, eq(schema.postMetric.postTargetId, schema.postTarget.id))
        .innerJoin(schema.contentBundle, eq(schema.postTarget.bundleId, schema.contentBundle.id))
        .where(and(...conditions))
        .orderBy(desc(schema.postMetric.collectedAt));

      const latestRows = latestMetricRows(rows as MetricRow[]);
      const summary = latestRows.reduce(
        (
          acc: { views: number; likes: number; shares: number; comments: number },
          r: MetricRow,
        ) => ({
          views: acc.views + Number(r.views ?? 0),
          likes: acc.likes + Number(r.likes ?? 0),
          shares: acc.shares + Number(r.shares ?? 0),
          comments: acc.comments + Number(r.comments ?? 0),
        }),
        { views: 0, likes: 0, shares: 0, comments: 0 },
      );
      const engagementRate =
        summary.views > 0
          ? ((summary.likes + summary.comments + summary.shares) / summary.views) * 100
          : 0;
      const roundedEngagementRate = Math.round(engagementRate * 100) / 100;

      let selectedValue: number | null = null;
      switch (args.metric) {
        case 'views':
          selectedValue = summary.views;
          break;
        case 'likes':
          selectedValue = summary.likes;
          break;
        case 'shares':
          selectedValue = summary.shares;
          break;
        case 'comments':
          selectedValue = summary.comments;
          break;
        case 'engagement_rate':
          selectedValue = roundedEngagementRate;
          break;
      }

      return {
        metric: args.metric ?? 'all',
        selected: args.metric ? { metric: args.metric, value: selectedValue } : null,
        dateRange: { from: args.dateFrom ?? 'all', to: args.dateTo ?? 'all' },
        summary: { ...summary, engagementRate: roundedEngagementRate },
        periods: latestRows.length,
      };
    });

    return { success: true, tool: this.name, modelId: args.modelId, data };
  }
}
