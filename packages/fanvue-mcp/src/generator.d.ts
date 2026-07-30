import { type Platform } from '@axiom/core';
import { z } from 'zod';
declare const PromptConfigSchema: z.ZodObject<{
    /** System persona / tone direction */
    persona: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    /** Key talking points to include */
    talkingPoints: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
    /** Content angle or theme */
    angle: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    /** Emoji usage: 'minimal', 'moderate', 'heavy' */
    emojiStyle: z.ZodDefault<z.ZodOptional<z.ZodEnum<["minimal", "moderate", "heavy"]>>>;
    /** Call-to-action type */
    cta: z.ZodDefault<z.ZodOptional<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    persona: string;
    talkingPoints: string[];
    angle: string;
    emojiStyle: "minimal" | "moderate" | "heavy";
    cta: string;
}, {
    persona?: string | undefined;
    talkingPoints?: string[] | undefined;
    angle?: string | undefined;
    emojiStyle?: "minimal" | "moderate" | "heavy" | undefined;
    cta?: string | undefined;
}>;
export type PromptConfig = z.infer<typeof PromptConfigSchema>;
export interface PlatformLimits {
    maxCaptionChars: number;
    maxHashtags: number;
    hashtagStyle: 'inline' | 'trailing';
}
export interface PlatformContent {
    platform: Platform;
    caption: string;
    hashtags: string[];
    truncated: boolean;
    tokenKillerPrefix: string | null;
}
export interface ContentBundleResult {
    bundleId: string;
    contents: PlatformContent[];
    tosResult: {
        verdict: string;
        scores: Array<{
            platform: string;
            score: number;
            threshold: number;
            verdict: string;
        }>;
        reasons: string[];
    };
}
export declare class ContentGenerator {
    private tosEngine;
    private tokenKiller;
    constructor();
    /**
     * Generate a full content bundle for a model across target platforms.
     *
     * For each platform:
     * 1. Generate platform-specific caption using prompt config
     * 2. Generate hashtag set, obeying platform limits
     * 3. Truncate to platform limits
     * 4. Run ToS evaluation
     * 5. Assemble TOKENKILLER prefix
     * 6. Return structured bundle
     */
    generateBundle(modelId: string, promptConfig: PromptConfig, targetPlatforms: Platform[]): Promise<ContentBundleResult>;
    /**
     * Generate a platform-appropriate caption from the prompt config.
     */
    private generateCaption;
    /**
     * Generate a set of hashtags for a platform.
     */
    private generateHashtags;
    /**
     * Build a persona segment for TOKENKILLER S0.
     */
    private buildPersonaSegment;
    /**
     * Build the platform rules segment for TOKENKILLER S1.
     */
    private buildPlatformRulesSegment;
    /**
     * Build the task variables segment for TOKENKILLER S3.
     */
    private buildTaskVariablesSegment;
    /**
     * Generate a unique bundle ID.
     */
    private generateBundleId;
}
export {};
//# sourceMappingURL=generator.d.ts.map