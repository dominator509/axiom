import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { Tier, tierAtLeast } from '../auth.js';
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
/**
 * Generation tool — triggers an AI photoshoot generation.
 * Requires approval (except for Autonomous agents where the Relay
 * may pre-approve certain model/style combinations).
 */
export class GenerationTool {
    name = 'generation_photoshoot';
    description = 'Generate AI photoshoot imagery for a model profile. Requires human approval via Relay.';
    inputSchema = GenerationInputSchema;
    tier = Tier.Operator;
    requiresApproval = true;
    async handle(args, permission) {
        if (!tierAtLeast(permission.tier, this.tier)) {
            throw new Error(`Insufficient permissions: requires ${this.tier}, got ${permission.tier}`);
        }
        if (args.modelId !== permission.modelId) {
            throw new Error(`Model mismatch: token scoped to ${permission.modelId}, requested ${args.modelId}`);
        }
        // Generate a bundle ID for approval tracking.
        const bundleId = uuidv4();
        // Stub: push generation job to @axiom/db job table and/or the
        // LLM generation pipeline.
        // const { db } = await import('@axiom/db');
        // await db.insert(job).values({
        //   id: bundleId,
        //   type: 'generation',
        //   modelId: args.modelId,
        //   config: { prompt: args.prompt, style: args.style, count: args.count },
        //   status: 'pending_approval',
        // }).execute();
        return {
            success: true,
            tool: this.name,
            bundleId,
            requiresApproval: this.requiresApproval,
            modelId: args.modelId,
            prompt: args.prompt,
            style: args.style ?? 'default',
            count: args.count,
            status: 'pending_approval',
            message: 'Generation request submitted. The bundle is pending human approval via Relay.',
        };
    }
}
//# sourceMappingURL=generation.js.map