import { Platform } from '@axiom/core';
import { type OverrideVerdict } from './vision.js';
/**
 * Default ToS violation score thresholds per platform (0–100 scale).
 * Higher values = more permissive; lower values = more restrictive.
 * These represent the maximum acceptable ToS violation probability (%).
 */
export declare const DEFAULT_PLATFORM_THRESHOLDS: Record<Platform, number>;
export interface PlatformRule {
    platform: Platform;
    /** Restriction level description */
    description: string;
    /** Keywords that are always blocked on this platform */
    blockedKeywords: string[];
    /** Maximum hashtag count allowed */
    maxHashtags: number;
    /** Maximum caption length (characters) */
    maxCaptionLength: number;
    /** Whether links are allowed in captions */
    linksAllowed: boolean;
    /** Content categories that require review on this platform */
    reviewCategories: string[];
}
export declare const PLATFORM_RULES: Record<Platform, PlatformRule>;
export interface PlatformScore {
    platform: Platform;
    score: number;
    threshold: number;
    verdict: 'pass' | 'review' | 'block';
    reasons: string[];
}
export interface EvaluationResult {
    verdict: 'pass' | 'review' | 'block';
    scores: PlatformScore[];
    reasons: string[];
}
export interface ImageClassification {
    score: number;
    category: string | null;
    explanation: string;
}
export declare class ToSEngine {
    private visionClient;
    private thresholds;
    constructor(thresholds?: Record<string, number>);
    /**
     * Classify an image for ToS compliance using the local vision engine.
     * `imagePath` is an absolute path the Rust engine can read from disk.
     * Pass `options.override` to force the verdict ('pass' | 'review' | 'block')
     * and bypass the model entirely.
     */
    classifyImage(imagePath: string, options?: {
        override?: OverrideVerdict;
    }): Promise<ImageClassification>;
    /**
     * Get the ToS score threshold for a specific platform.
     * Returns a value 0–100 where higher = more permissive.
     */
    getPlatformThreshold(platform: Platform): number;
    /**
     * Evaluate an asset for ToS compliance across multiple platforms.
     * `asset.imageData` is an absolute image path the Rust engine reads from
     * disk. Pass `options.override` to force the image verdict.
     */
    evaluate(asset: {
        imageData: string;
        caption?: string;
        hashtags?: string[];
    }, platforms: Platform[], options?: {
        override?: OverrideVerdict;
    }): Promise<EvaluationResult>;
}
//# sourceMappingURL=tos-engine.d.ts.map