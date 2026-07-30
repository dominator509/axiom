import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { Tier } from '../auth.js';
/**
 * Input schema for network configuration updates.
 * Only available to Autonomous-tier agents via dashboard-grant.
 */
export const NetworkInputSchema = z.object({
    modelId: z.string().uuid(),
    config: z.object({
        /** Enable/disable cross-posting between platforms. */
        crossPosting: z.boolean().optional(),
        /** Auto-reply to DMs when confidence > threshold. */
        autoReplyThreshold: z.number().min(0).max(1).optional(),
        /** Content reposting cadence in hours. */
        repostCadenceHours: z.number().int().min(1).max(168).optional(),
        /** Platform-specific rate limits (requests per hour). */
        rateLimits: z.record(z.string(), z.number().int()).optional(),
        /** Blocklisted keywords for auto-filtering. */
        blocklist: z.array(z.string()).optional(),
    }),
});
/**
 * Network tool — update cross-platform network configuration.
 * Exclusive to Autonomous tier. Requires dashboard-grant (approval via Relay).
 */
export class NetworkTool {
    name = 'network_configure';
    description = 'Update cross-platform network configuration including cross-posting toggles, auto-reply thresholds, repost cadence, rate limits, and content blocklists. Autonomous-tier only — requires dashboard approval.';
    inputSchema = NetworkInputSchema;
    tier = Tier.Autonomous;
    requiresApproval = true;
    async handle(args, permission) {
        if (permission.tier !== Tier.Autonomous) {
            throw new Error(`Network configuration requires Autonomous tier, got ${permission.tier}`);
        }
        if (args.modelId !== permission.modelId) {
            throw new Error(`Model mismatch: token scoped to ${permission.modelId}, requested ${args.modelId}`);
        }
        const bundleId = uuidv4();
        // Stub: persist config to @axiom/db platform_connection or a config table.
        // const { db } = await import('@axiom/db');
        // await db.update(platformConnection)
        //   .set({ config: args.config })
        //   .where(eq(platformConnection.modelId, args.modelId))
        //   .execute();
        return {
            success: true,
            tool: this.name,
            bundleId,
            requiresApproval: true,
            modelId: args.modelId,
            config: args.config,
            status: 'pending_approval',
            message: 'Network configuration change submitted for dashboard approval.',
        };
    }
}
//# sourceMappingURL=network.js.map