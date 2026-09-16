import { z } from 'zod';
import { Tier, type AgentPermission } from '../auth.js';

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

export type NetworkInput = z.infer<typeof NetworkInputSchema>;

/**
 * Network tool — reserved for cross-platform network configuration.
 * Exclusive to Autonomous tier. The durable dashboard/Relay approval executor
 * is not currently bound, so requests fail closed before any DB mutation.
 *
 * Do not persist a pending change without a consumer. That would report a
 * successful approval handoff while leaving the request permanently inert.
 */
export class NetworkTool {
  name = 'network_configure';
  description =
    'Network configuration is unavailable until a durable dashboard/Relay approval executor is configured.';
  inputSchema = NetworkInputSchema;
  tier: Tier = Tier.Autonomous;
  requiresApproval = true;

  async handle(args: NetworkInput, permission: AgentPermission): Promise<unknown> {
    if (permission.tier !== Tier.Autonomous) {
      throw new Error(`Network configuration requires Autonomous tier, got ${permission.tier}`);
    }
    if (args.modelId !== permission.modelId) {
      throw new Error(
        `Model mismatch: token scoped to ${permission.modelId}, requested ${args.modelId}`,
      );
    }

    throw new Error(
      'Network configuration is unavailable: no durable dashboard/Relay approval executor is configured',
    );
  }
}
