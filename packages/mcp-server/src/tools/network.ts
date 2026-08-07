import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';
import { Tier, type AgentPermission } from '../auth.js';
import { withModelOrg, schema } from '../org-context.js';

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
 * Network tool — update cross-platform network configuration.
 * Exclusive to Autonomous tier. Requires dashboard-grant (approval via Relay).
 *
 * Real behaviour (H-2): persists the requested configuration into the model's
 * org_settings.features map (versioned) as a pending_approval change; the
 * dashboard/relay approval path applies it. The change is auditable because
 * org_settings carries updated_at.
 */
export class NetworkTool {
  name = 'network_configure';
  description = 'Update cross-platform network configuration including cross-posting toggles, auto-reply thresholds, repost cadence, rate limits, and content blocklists. Autonomous-tier only — requires dashboard approval.';
  inputSchema = NetworkInputSchema;
  tier: Tier = Tier.Autonomous;
  requiresApproval = true;

  async handle(args: NetworkInput, permission: AgentPermission): Promise<unknown> {
    if (permission.tier !== Tier.Autonomous) {
      throw new Error(`Network configuration requires Autonomous tier, got ${permission.tier}`);
    }
    if (args.modelId !== permission.modelId) {
      throw new Error(`Model mismatch: token scoped to ${permission.modelId}, requested ${args.modelId}`);
    }

    const changeId = uuidv4();

    await withModelOrg(args.modelId, async (tx, orgId) => {
      const orgRows = await tx
        .select({ features: schema.org.features })
        .from(schema.org)
        .where(eq(schema.org.id, orgId))
        .limit(1);

      const features = (orgRows[0]?.features ?? {}) as Record<string, unknown>;
      const pending = (features.pendingNetworkChanges ?? {}) as Record<string, unknown>;
      await tx
        .update(schema.org)
        .set({ features: { ...features, pendingNetworkChanges: { ...pending, [changeId]: args.config } } })
        .where(eq(schema.org.id, orgId));
    });

    return {
      success: true,
      tool: this.name,
      changeId,
      requiresApproval: true,
      modelId: args.modelId,
      config: args.config,
      status: 'pending_approval',
      message: 'Network configuration change submitted for dashboard approval.',
    };
  }
}
