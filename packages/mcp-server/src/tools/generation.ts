import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { Tier, type AgentPermission, tierAtLeast } from '../auth.js';
import { withModelOrg, schema } from '../org-context.js';

/**
 * Input schema for content generation (photoshoot).
 * Requires approval at the Operator/Manager tier; Autonomous tier may skip approval.
 */
export const GenerationInputSchema = z.object({
  modelId: z.string().uuid(),
  /** Text description of the desired imagery. */
  prompt: z.string().min(1).max(2000),
  /** Visual style / aesthetic direction. */
  style: z.string().optional(),
  /** Number of images to generate. */
  count: z.number().int().min(1).max(10).default(4),
});

export type GenerationInput = z.infer<typeof GenerationInputSchema>;

/**
 * Generation tool — triggers an AI photoshoot generation.
 * Requires approval (except for Autonomous agents where the Relay
 * may pre-approve certain model/style combinations).
 *
 * Real behaviour (H-2): creates a content_bundle in 'generated' state and
 * enqueues a content.generate job for the worker (L3.4), same-txn.
 */
export class GenerationTool {
  name = 'generation_photoshoot';
  description = 'Generate AI photoshoot imagery for a model profile. Requires human approval via Relay.';
  inputSchema = GenerationInputSchema;
  tier: Tier = Tier.Operator;
  requiresApproval = true;

  async handle(args: GenerationInput, permission: AgentPermission): Promise<unknown> {
    if (!tierAtLeast(permission.tier, this.tier)) {
      throw new Error(`Insufficient permissions: requires ${this.tier}, got ${permission.tier}`);
    }
    if (args.modelId !== permission.modelId) {
      throw new Error(`Model mismatch: token scoped to ${permission.modelId}, requested ${args.modelId}`);
    }

    const bundleId = uuidv4();
    const needsApproval = permission.tier !== Tier.Autonomous;

    await withModelOrg(args.modelId, async (tx, orgId) => {
      await tx.insert(schema.contentBundle).values({
        id: bundleId,
        orgId,
        modelId: args.modelId,
        captions: {},
        hashtags: [],
        state: needsApproval ? 'pending_approval' : 'generated',
      });
      await tx.insert(schema.job).values({
        orgId,
        queue: 'content',
        kind: 'content.generate',
        payload: {
          bundleId,
          prompt: args.prompt,
          style: args.style ?? 'default',
          count: args.count,
        },
        state: 'ready',
        runAfter: new Date(),
      });
    });

    return {
      success: true,
      tool: this.name,
      bundleId,
      requiresApproval: needsApproval,
      modelId: args.modelId,
      prompt: args.prompt,
      style: args.style ?? 'default',
      count: args.count,
      status: needsApproval ? 'pending_approval' : 'queued',
      message: needsApproval
        ? 'Generation request submitted. The bundle is pending human approval via Relay.'
        : 'Generation job queued for the worker (Autonomous mode).',
    };
  }
}
