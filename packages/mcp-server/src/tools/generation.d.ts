import { z } from 'zod';
import { Tier, type AgentPermission } from '../auth.js';
/**
 * Input schema for content generation (photoshoot).
 * Requires approval at the Operator/Manager tier; Autonomous tier may skip approval.
 */
export declare const GenerationInputSchema: z.ZodObject<{
    modelId: z.ZodString;
    /** Text description of the desired imagery. */
    prompt: z.ZodString;
    /** Visual style / aesthetic direction. */
    style: z.ZodOptional<z.ZodString>;
    /** Number of images to generate. */
    count: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    count: number;
    modelId: string;
    prompt: string;
    style?: string | undefined;
}, {
    modelId: string;
    prompt: string;
    count?: number | undefined;
    style?: string | undefined;
}>;
export type GenerationInput = z.infer<typeof GenerationInputSchema>;
/**
 * Generation tool — triggers an AI photoshoot generation.
 * Requires approval (except for Autonomous agents where the Relay
 * may pre-approve certain model/style combinations).
 */
export declare class GenerationTool {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        modelId: z.ZodString;
        /** Text description of the desired imagery. */
        prompt: z.ZodString;
        /** Visual style / aesthetic direction. */
        style: z.ZodOptional<z.ZodString>;
        /** Number of images to generate. */
        count: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        count: number;
        modelId: string;
        prompt: string;
        style?: string | undefined;
    }, {
        modelId: string;
        prompt: string;
        count?: number | undefined;
        style?: string | undefined;
    }>;
    tier: Tier;
    requiresApproval: boolean;
    handle(args: GenerationInput, permission: AgentPermission): Promise<unknown>;
}
//# sourceMappingURL=generation.d.ts.map