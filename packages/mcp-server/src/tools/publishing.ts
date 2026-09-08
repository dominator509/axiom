import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { and, eq } from 'drizzle-orm';
import { Tier, type AgentPermission, tierAtLeast } from '../auth.js';
import { withModelOrg, schema } from '../org-context.js';

// content_bundle currently carries one asset_id. Keep the MCP contract aligned
// with that persisted shape instead of silently dropping additional media IDs.
const MEDIA_REQUIRED_PLATFORMS = new Set(['fanvue', 'instagram', 'telegram', 'discord']);

/**
 * Input schema for publishing operations.
 * - action: 'schedule' queues a post, 'publish' posts immediately
 * - post: the post content / configuration
 */
export const PublishingInputSchema = z.object({
  modelId: z.string().uuid(),
  action: z.enum(['schedule', 'publish']),
  post: z.object({
    text: z.string().max(4000).optional(),
    mediaIds: z
      .array(z.string().uuid())
      .max(1, 'publishing_post currently accepts one media asset per bundle')
      .optional(),
    platform: z.enum(['fanvue', 'x', 'instagram', 'telegram', 'discord']),
    scheduledAt: z.string().datetime().optional(),
  }),
});

export type PublishingInput = z.infer<typeof PublishingInputSchema>;

/**
 * Publishing tool — schedule or publish content on social platforms.
 *
 * Tier matrix:
 * - Viewer:   DENIED
 * - Operator: DENIED (use Relay for direct operations)
 * - Manager:  ALLOWED with requiresApproval=true
 * - Autonomous: ALLOWED, requiresApproval=true
 *
 * Real behaviour (H-2): creates a generated content_bundle in the same
 * org-scoped txn. Every tier stops at the generated bundle and waits for the
 * dashboard/Relay approval path, which owns the durable ToS gate and creates
 * the post target plus publish job.
 */
export class PublishingTool {
  name = 'publishing_post';
  description =
    'Schedule or publish content posts to social platforms (Fanvue, X, Instagram, Telegram, Discord). Pass one existing model-owned mediaId for media-only destinations.';
  inputSchema = PublishingInputSchema;
  tier: Tier = Tier.Manager;

  /**
   * Approval is required for every tier until an automated ToS scan and
   * approval handoff exists for this tool.
   */
  get requiresApproval(): boolean {
    return true;
  }

  async handle(args: PublishingInput, permission: AgentPermission): Promise<unknown> {
    if (!tierAtLeast(permission.tier, this.tier)) {
      throw new Error(`Insufficient permissions: requires ${this.tier}, got ${permission.tier}`);
    }
    if (args.modelId !== permission.modelId) {
      throw new Error(
        `Model mismatch: token scoped to ${permission.modelId}, requested ${args.modelId}`,
      );
    }

    const bundleId = uuidv4();
    const mediaId = args.post.mediaIds?.[0] ?? null;

    if (MEDIA_REQUIRED_PLATFORMS.has(args.post.platform) && !mediaId) {
      throw new Error(`publishing_post: ${args.post.platform} requires at least one mediaId`);
    }

    await withModelOrg(args.modelId, async (tx, orgId) => {
      let assetId: string | null = null;
      if (mediaId) {
        const assets = await tx
          .select({ id: schema.asset.id })
          .from(schema.asset)
          .where(
            and(
              eq(schema.asset.id, mediaId),
              eq(schema.asset.orgId, orgId),
              eq(schema.asset.modelId, args.modelId),
            ),
          )
          .limit(1);
        if (assets.length === 0) {
          throw new Error(
            `publishing_post: mediaId ${mediaId} is not owned by model ${args.modelId}`,
          );
        }
        assetId = mediaId;
      }

      // 1. content_bundle — the approval/review unit (state machine).
      await tx.insert(schema.contentBundle).values({
        id: bundleId,
        orgId,
        modelId: args.modelId,
        assetId,
        captions: args.post.text ? { [args.post.platform]: args.post.text } : {},
        hashtags: [],
        publishIntent: {
          action: args.action,
          platform: args.post.platform,
          scheduledAt: args.post.scheduledAt ?? null,
        },
        state: 'generated',
      });
    });

    return {
      success: true,
      tool: this.name,
      bundleId,
      requiresApproval: true,
      action: args.action,
      modelId: args.modelId,
      platform: args.post.platform,
      status: 'pending_approval',
      scheduledAt: args.post.scheduledAt ?? null,
      message: 'Publishing request submitted for human approval via Relay.',
    };
  }
}
