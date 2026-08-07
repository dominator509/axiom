import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { Tier, type AgentPermission, tierAtLeast } from '../auth.js';
import { withModelOrg, schema } from '../org-context.js';

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
 *
 * Real behaviour (H-2): creates a content_bundle + post_target (idem-keyed,
 * LBI-05) and enqueues a publish.target job in the same org-scoped txn.
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

    const scheduledFor = args.post.scheduledAt ? new Date(args.post.scheduledAt) : null;

    await withModelOrg(args.modelId, async (tx, orgId) => {
      // 1. content_bundle — the approval/review unit (state machine).
      await tx.insert(schema.contentBundle).values({
        id: bundleId,
        orgId,
        modelId: args.modelId,
        captions: args.post.text ? { [args.post.platform]: args.post.text } : {},
        hashtags: [],
        state: needsApproval ? 'pending_approval' : 'generated',
      });

      // 2. post_target with an idempotency key (LBI-05 / L3.1 §11).
      await tx.insert(schema.postTarget).values({
        orgId,
        bundleId,
        platform: args.post.platform,
        scheduledFor,
        state: 'pending',
        idemKey: Buffer.from(`${bundleId}|${args.post.platform}|${args.action}`),
      });

      // 3. Enqueue the publish job in the same txn (L3.4 §1 dedupe).
      await tx.insert(schema.job).values({
        orgId,
        queue: 'publish',
        kind: 'publish.target',
        payload: { bundleId, targetPlatforms: [args.post.platform] },
        state: 'ready',
        runAfter: scheduledFor ?? new Date(),
      });
    });

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
