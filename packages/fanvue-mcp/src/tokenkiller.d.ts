import { type Platform } from '@axiom/core';
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
export interface CacheEntry {
    prefix: string;
    version: string;
    createdAt: string;
    segments: TokenKillerSegments;
}
export interface PrefixVersion {
    major: number;
    minor: number;
    patch: number;
}
/**
 * Align a text string to a multiple of 64 tokens by padding with spaces.
 * This ensures prefix blocks align with the model's tokenization boundaries,
 * reducing inference variance from token boundary shifts.
 */
export declare function alignBlocks(text: string): string;
/**
 * Compute a content-addressed cache key from model ID, platform, and prefix version.
 * Uses SHA-256 for deterministic, collision-resistant keys.
 */
export declare function cacheKey(modelId: string, platform: Platform, prefixVersion?: string): string;
export declare class TokenKillerAssembler {
    private version;
    /** In-memory content-addressed cache: key -> assembled prefix */
    private cache;
    constructor(version?: Partial<PrefixVersion>);
    /**
     * Get the current prefix version string.
     */
    getVersion(): string;
    /**
     * Assemble the TOKENKILLER prefix from segments in order [S0, S1, S2, S3].
     * Each segment is separated by a clear delimiter to maintain structure.
     * The result is block-aligned to 64-token boundaries.
     */
    segmentPrompt(segments: TokenKillerSegments): string;
    /**
     * Compute the cache key for a given model, platform, and version.
     * Optionally incorporates segment content for content-addressability.
     */
    getCacheKey(modelId: string, platform: Platform, segments?: TokenKillerSegments): string;
    /**
     * Store an assembled prefix in the content-addressed cache.
     */
    store(segments: TokenKillerSegments, prefix: string): string;
    /**
     * Retrieve a cached prefix by its content hash.
     */
    retrieve(cacheKey: string): CacheEntry | undefined;
    /**
     * Check if a prefix is cached for the given cache key.
     */
    has(cacheKey: string): boolean;
    /**
     * Clear the in-memory cache.
     */
    clearCache(): void;
    /**
     * Get the cache size.
     */
    get cacheSize(): number;
}
//# sourceMappingURL=tokenkiller.d.ts.map