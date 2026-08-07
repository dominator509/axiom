import { z } from 'zod';
import { Tier, type AgentPermission } from '../auth.js';
/**
 * Input schema for publishing operations.
 * - action: 'schedule' queues a post, 'publish' posts immediately
 * - post: the post content / configuration
 */
export declare const PublishingInputSchema: z.ZodObject<{
    modelId: z.ZodString;
    action: z.ZodEnum<["schedule", "publish"]>;
    post: z.ZodObject<{
        text: z.ZodOptional<z.ZodString>;
        mediaIds: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        platform: z.ZodEnum<["fanvue", "onlyfans", "x", "instagram", "telegram", "discord"]>;
        scheduledAt: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        platform: "instagram" | "x" | "discord" | "telegram" | "fanvue" | "onlyfans";
        text?: string | undefined;
        mediaIds?: string[] | undefined;
        scheduledAt?: string | undefined;
    }, {
        platform: "instagram" | "x" | "discord" | "telegram" | "fanvue" | "onlyfans";
        text?: string | undefined;
        mediaIds?: string[] | undefined;
        scheduledAt?: string | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    post: {
        platform: "instagram" | "x" | "discord" | "telegram" | "fanvue" | "onlyfans";
        text?: string | undefined;
        mediaIds?: string[] | undefined;
        scheduledAt?: string | undefined;
    };
    action: "publish" | "schedule";
    modelId: string;
}, {
    post: {
        platform: "instagram" | "x" | "discord" | "telegram" | "fanvue" | "onlyfans";
        text?: string | undefined;
        mediaIds?: string[] | undefined;
        scheduledAt?: string | undefined;
    };
    action: "publish" | "schedule";
    modelId: string;
}>;
export type PublishingInput = z.infer<typeof PublishingInputSchema>;
/**
 * Publishing tool — schedule or publish content on social platforms.
 *
 * Tier matrix:
 * - Viewer:   DENIED
 * - Operator: DENIED (use Relay for direct operations)
 * - Manager:  ALLOWED with requiresApproval=true
 * - Autonomous: ALLOWED, requiresApproval=false
 *
 * Real behaviour (H-2): creates a content_bundle + post_target (idem-keyed,
 * LBI-05) and enqueues a publish.target job in the same org-scoped txn.
 */
export declare class PublishingTool {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        modelId: z.ZodString;
        action: z.ZodEnum<["schedule", "publish"]>;
        post: z.ZodObject<{
            text: z.ZodOptional<z.ZodString>;
            mediaIds: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            platform: z.ZodEnum<["fanvue", "onlyfans", "x", "instagram", "telegram", "discord"]>;
            scheduledAt: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            platform: "instagram" | "x" | "discord" | "telegram" | "fanvue" | "onlyfans";
            text?: string | undefined;
            mediaIds?: string[] | undefined;
            scheduledAt?: string | undefined;
        }, {
            platform: "instagram" | "x" | "discord" | "telegram" | "fanvue" | "onlyfans";
            text?: string | undefined;
            mediaIds?: string[] | undefined;
            scheduledAt?: string | undefined;
        }>;
    }, "strip", z.ZodTypeAny, {
        post: {
            platform: "instagram" | "x" | "discord" | "telegram" | "fanvue" | "onlyfans";
            text?: string | undefined;
            mediaIds?: string[] | undefined;
            scheduledAt?: string | undefined;
        };
        action: "publish" | "schedule";
        modelId: string;
    }, {
        post: {
            platform: "instagram" | "x" | "discord" | "telegram" | "fanvue" | "onlyfans";
            text?: string | undefined;
            mediaIds?: string[] | undefined;
            scheduledAt?: string | undefined;
        };
        action: "publish" | "schedule";
        modelId: string;
    }>;
    tier: Tier;
    /**
     * Approval is required at Manager tier but NOT at Autonomous tier.
     */
    get requiresApproval(): boolean;
    handle(args: PublishingInput, permission: AgentPermission): Promise<unknown>;
}
//# sourceMappingURL=publishing.d.ts.map