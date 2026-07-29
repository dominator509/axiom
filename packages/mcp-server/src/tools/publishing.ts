import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { Tier, type AgentPermission, tierAtLeast } from '../auth.js';

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
    mediaIds: z.array(z.string().uuid()).optional(),
    platform: z.enum(['fanvue', 'onlyfans', 'x', 'instagram', 'telegram', 'discord']),
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
 * - Autonomous: ALLOWED, requiresApproval=false
 */
export class PublishingTool {
  name = 'publishing_post';
  description = 'Schedule or publish content posts to social platforms (Fanvue, OnlyFans, X, Instagram, Telegram, Discord).';
  inputSchema = PublishingInputSchema;
  tier: Tier = Tier.Manager;

  /**
   * Approval is required at Manager tier but NOT at Autonomous tier.
   */
  get requiresApproval(): boolean {
    return false; // evaluated dynamically in handle()
  }

  async handle(args: PublishingInput, permission: AgentPermission): Promise<unknown> {
    if (!tierAtLeast(permission.tier, this.tier)) {
      throw new Error(`Insufficient permissions: requires ${this.tier}, got ${permission.tier}`);
    }
    if (args.modelId !== permission.modelId) {
      throw new Error(`Model mismatch: token scoped to ${permission.modelId}, requested ${args.modelId}`);
    }

    const isAutonomous = permission.tier === Tier.Autonomous;
    const needsApproval = !isAutonomous;
    const bundleId = uuidv4();

    // Stub: insert into @axiom/db post_target and trigger connector.
    // const { db } = await import('@axiom/db');
    // const status = needsApproval ? 'pending_approval' : 'queued';
    // await db.insert(postTarget).values({
    //   id: bundleId, modelId: args.modelId, platform: args.post.platform,
    //   config: { text: args.post.text, mediaIds: args.post.mediaIds },
    //   scheduledAt: args.post.scheduledAt, status,
    // }).execute();

    return {
      success: true,
      tool: this.name,
      bundleId,
      requiresApproval: needsApproval,
      action: args.action,
      modelId: args.modelId,
      platform: args.post.platform,
      status: needsApproval ? 'pending_approval' : 'queued',
      scheduledAt: args.post.scheduledAt ?? null,
      message: needsApproval
        ? 'Publishing request submitted for human approval via Relay.'
        : 'Post queued for publishing (Autonomous mode).',
    };
  }
}
