import { z } from 'zod';
import { Tier, type AgentPermission } from '../auth.js';
/**
 * Input schema for network configuration updates.
 * Only available to Autonomous-tier agents via dashboard-grant.
 */
export declare const NetworkInputSchema: z.ZodObject<{
    modelId: z.ZodString;
    config: z.ZodObject<{
        /** Enable/disable cross-posting between platforms. */
        crossPosting: z.ZodOptional<z.ZodBoolean>;
        /** Auto-reply to DMs when confidence > threshold. */
        autoReplyThreshold: z.ZodOptional<z.ZodNumber>;
        /** Content reposting cadence in hours. */
        repostCadenceHours: z.ZodOptional<z.ZodNumber>;
        /** Platform-specific rate limits (requests per hour). */
        rateLimits: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
        /** Blocklisted keywords for auto-filtering. */
        blocklist: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        crossPosting?: boolean | undefined;
        autoReplyThreshold?: number | undefined;
        repostCadenceHours?: number | undefined;
        rateLimits?: Record<string, number> | undefined;
        blocklist?: string[] | undefined;
    }, {
        crossPosting?: boolean | undefined;
        autoReplyThreshold?: number | undefined;
        repostCadenceHours?: number | undefined;
        rateLimits?: Record<string, number> | undefined;
        blocklist?: string[] | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    modelId: string;
    config: {
        crossPosting?: boolean | undefined;
        autoReplyThreshold?: number | undefined;
        repostCadenceHours?: number | undefined;
        rateLimits?: Record<string, number> | undefined;
        blocklist?: string[] | undefined;
    };
}, {
    modelId: string;
    config: {
        crossPosting?: boolean | undefined;
        autoReplyThreshold?: number | undefined;
        repostCadenceHours?: number | undefined;
        rateLimits?: Record<string, number> | undefined;
        blocklist?: string[] | undefined;
    };
}>;
export type NetworkInput = z.infer<typeof NetworkInputSchema>;
/**
 * Network tool — update cross-platform network configuration.
 * Exclusive to Autonomous tier. Requires dashboard-grant (approval via Relay).
 */
export declare class NetworkTool {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        modelId: z.ZodString;
        config: z.ZodObject<{
            /** Enable/disable cross-posting between platforms. */
            crossPosting: z.ZodOptional<z.ZodBoolean>;
            /** Auto-reply to DMs when confidence > threshold. */
            autoReplyThreshold: z.ZodOptional<z.ZodNumber>;
            /** Content reposting cadence in hours. */
            repostCadenceHours: z.ZodOptional<z.ZodNumber>;
            /** Platform-specific rate limits (requests per hour). */
            rateLimits: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
            /** Blocklisted keywords for auto-filtering. */
            blocklist: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, "strip", z.ZodTypeAny, {
            crossPosting?: boolean | undefined;
            autoReplyThreshold?: number | undefined;
            repostCadenceHours?: number | undefined;
            rateLimits?: Record<string, number> | undefined;
            blocklist?: string[] | undefined;
        }, {
            crossPosting?: boolean | undefined;
            autoReplyThreshold?: number | undefined;
            repostCadenceHours?: number | undefined;
            rateLimits?: Record<string, number> | undefined;
            blocklist?: string[] | undefined;
        }>;
    }, "strip", z.ZodTypeAny, {
        modelId: string;
        config: {
            crossPosting?: boolean | undefined;
            autoReplyThreshold?: number | undefined;
            repostCadenceHours?: number | undefined;
            rateLimits?: Record<string, number> | undefined;
            blocklist?: string[] | undefined;
        };
    }, {
        modelId: string;
        config: {
            crossPosting?: boolean | undefined;
            autoReplyThreshold?: number | undefined;
            repostCadenceHours?: number | undefined;
            rateLimits?: Record<string, number> | undefined;
            blocklist?: string[] | undefined;
        };
    }>;
    tier: Tier;
    requiresApproval: boolean;
    handle(args: NetworkInput, permission: AgentPermission): Promise<unknown>;
}
//# sourceMappingURL=network.d.ts.map