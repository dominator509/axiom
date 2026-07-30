import { z } from 'zod';
import { Tier, tierAtLeast } from '../auth.js';
/**
 * Input schema for analytics queries.
 */
export const AnalyticsInputSchema = z.object({
    modelId: z.string().uuid(),
    dateFrom: z.string().datetime().optional(),
    dateTo: z.string().datetime().optional(),
    metric: z.enum(['views', 'likes', 'shares', 'comments', 'engagement_rate']).optional(),
});
/**
 * Analytics tool — retrieves model performance metrics.
 * Available at Viewer tier and above.
 */
export class AnalyticsTool {
    name = 'analytics_query';
    description = 'Query model analytics and performance metrics (views, likes, shares, comments, engagement rate) over a date range.';
    inputSchema = AnalyticsInputSchema;
    tier = Tier.Viewer;
    requiresApproval = false;
    async handle(args, permission) {
        if (!tierAtLeast(permission.tier, this.tier)) {
            throw new Error(`Insufficient permissions: requires ${this.tier}, got ${permission.tier}`);
        }
        if (args.modelId !== permission.modelId) {
            throw new Error(`Model mismatch: token scoped to ${permission.modelId}, requested ${args.modelId}`);
        }
        // Stub: in production this queries @axiom/db post_metric and post_target tables.
        // const { db } = await import('@axiom/db');
        // const metrics = await db.select().from(postMetric)
        //   .where(and(eq(postTarget.modelId, args.modelId), ...))
        //   .execute();
        return {
            success: true,
            tool: this.name,
            modelId: args.modelId,
            data: {
                metric: args.metric ?? 'all',
                dateRange: { from: args.dateFrom ?? 'all', to: args.dateTo ?? 'all' },
                summary: {
                    views: 0,
                    likes: 0,
                    shares: 0,
                    comments: 0,
                    engagementRate: 0,
                },
                note: 'Stub implementation — connect @axiom/db for live data',
            },
        };
    }
}
//# sourceMappingURL=analytics.js.map