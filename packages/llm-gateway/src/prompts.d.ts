export interface TokenKillerSegments {
    /** S0: System persona (static, model-dependent) */
    S0: string;
    /** S1: Playbook / ToS rules (static, per-platform) */
    S1: string;
    /** S2: Viral exemplars (semi-static, retrieved) */
    S2: string;
    /** S3: Task variables (dynamic) */
    S3: string;
}
/**
 * Align a text string to a multiple of 64 tokens by padding with spaces.
 * This ensures prefix blocks align with the model's tokenization boundaries,
 * reducing inference variance from token boundary shifts.
 */
export declare function alignBlocks(text: string): string;
export type Platform = 'instagram' | 'tiktok' | 'x' | 'youtube' | 'facebook' | 'reddit' | 'threads' | 'snapchat' | 'discord' | 'telegram' | 'fanvue';
export interface ModelProfile {
    id: string;
    displayName: string;
    handle: string;
    avatarUrl: string | null;
    bio: string | null;
    persona?: string;
    characterRules?: string[];
}
export interface PlatformRules {
    description: string;
    blockedKeywords: string[];
    maxHashtags: number;
    maxCaptionLength: number;
    linksAllowed: boolean;
    reviewCategories: string[];
}
export interface ViralExemplar {
    id: string;
    platform: Platform;
    title: string;
    caption: string;
    hashtags: string[];
    viralLabel: 'viral' | 'strong' | 'baseline' | 'weak';
    aiNotes: string | null;
}
export interface TaskVariables {
    modelId: string;
    platform: Platform;
    angle?: string;
    emojiStyle?: 'minimal' | 'moderate' | 'heavy';
    cta?: string;
    talkingPoints?: string[];
    mediaDescriptions?: string[];
    imageCaption?: string;
    [key: string]: unknown;
}
/**
 * Build the S0 system persona segment from a model profile.
 * Includes model persona description and character consistency rules.
 */
export declare function buildS0(profile: ModelProfile): string;
/**
 * Build the S1 playbook / ToS segment from platform rules.
 * Includes posting guidelines and ToS thresholds.
 */
export declare function buildS1(platform: Platform): string;
/**
 * Build the S2 viral exemplar context segment.
 * Provides examples of high-performing content for style reference.
 * Placeholder for P3 retrieval pipeline integration.
 */
export declare function buildS2(exemplars: ViralExemplar[]): string;
/**
 * Build the S3 task segment with current task variables and media descriptions.
 */
export declare function buildS3(task: TaskVariables): string;
export interface AssembledPrompt {
    system: string;
    messages: Array<{
        role: string;
        content: string;
    }>;
}
/**
 * Assemble all four TOKENKILLER segments into a single prompt with block alignment.
 * Ordering: S0 (System Persona) → S1 (Playbook/ToS) → S2 (Exemplars) → S3 (Task)
 */
export declare function assemblePrompt(segments: TokenKillerSegments): string;
export interface PhotoshootConfig {
    modelName: string;
    style: string;
    outfit: string;
    location: string;
    mood: string;
    lighting: string;
    aspectRatio: string;
    platform: Platform;
}
export interface PhotoshootVariant {
    prompt: string;
    caption: string;
    hashtags: string[];
    styleLabel: string;
}
/**
 * Generate 5 photoshoot prompt variants + captions + hashtags from dropdown configs.
 * Returns varied prompt styles (full-body, close-up, candid, editorial, action).
 */
export declare function generatePhotoshootPrompts(config: PhotoshootConfig): PhotoshootVariant[];
export interface CourseAdherenceInput {
    personaConsistency: number;
    platformRuleCompliance: number;
    exemplarSimilarity: number;
    taskAlignment: number;
}
export interface CourseAdherenceScore {
    overall: number;
    components: {
        persona: number;
        platform: number;
        exemplar: number;
        task: number;
    };
    weights: {
        persona: number;
        platform: number;
        exemplar: number;
        task: number;
    };
    passed: boolean;
    minimumThreshold: number;
}
declare const DEFAULT_WEIGHTS: {
    persona: number;
    platform: number;
    exemplar: number;
    task: number;
};
/**
 * Calculate CourseAdherenceScore based on persona consistency, platform rule
 * compliance, exemplar similarity, and task alignment.
 *
 * Returns a weighted composite score (0–1) and pass/fail verdict.
 */
export declare function calculateCourseAdherence(input: CourseAdherenceInput, weights?: Partial<typeof DEFAULT_WEIGHTS>, minimumThreshold?: number): CourseAdherenceScore;
export {};
//# sourceMappingURL=prompts.d.ts.map