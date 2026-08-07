import { z } from 'zod';
import { Tier, type AgentPermission } from '../auth.js';
/**
 * Input schema for analytics queries.
 */
export declare const AnalyticsInputSchema: z.ZodObject<{
    modelId: z.ZodString;
    dateFrom: z.ZodOptional<z.ZodString>;
    dateTo: z.ZodOptional<z.ZodString>;
    metric: z.ZodOptional<z.ZodEnum<["views", "likes", "shares", "comments", "engagement_rate"]>>;
}, "strip", z.ZodTypeAny, {
    modelId: string;
    dateFrom?: string | undefined;
    dateTo?: string | undefined;
    metric?: "likes" | "comments" | "shares" | "views" | "engagement_rate" | undefined;
}, {
    modelId: string;
    dateFrom?: string | undefined;
    dateTo?: string | undefined;
    metric?: "likes" | "comments" | "shares" | "views" | "engagement_rate" | undefined;
}>;
export type AnalyticsInput = z.infer<typeof AnalyticsInputSchema>;
/**
 * Analytics tool — retrieves model performance metrics from post_metric.
 * Available at Viewer tier and above. Real DB query (H-2).
 */
export declare class AnalyticsTool {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        modelId: z.ZodString;
        dateFrom: z.ZodOptional<z.ZodString>;
        dateTo: z.ZodOptional<z.ZodString>;
        metric: z.ZodOptional<z.ZodEnum<["views", "likes", "shares", "comments", "engagement_rate"]>>;
    }, "strip", z.ZodTypeAny, {
        modelId: string;
        dateFrom?: string | undefined;
        dateTo?: string | undefined;
        metric?: "likes" | "comments" | "shares" | "views" | "engagement_rate" | undefined;
    }, {
        modelId: string;
        dateFrom?: string | undefined;
        dateTo?: string | undefined;
        metric?: "likes" | "comments" | "shares" | "views" | "engagement_rate" | undefined;
    }>;
    tier: Tier;
    requiresApproval: boolean;
    handle(args: AnalyticsInput, permission: AgentPermission): Promise<unknown>;
}
//# sourceMappingURL=analytics.d.ts.map