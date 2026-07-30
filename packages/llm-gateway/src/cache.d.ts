/**
 * Align a text string to a multiple of 64 tokens by padding with spaces.
 * This ensures prefix blocks align with the model's tokenization boundaries,
 * reducing inference variance from token boundary shifts.
 */
export declare function alignBlocks(text: string): string;
export interface PrefixCacheEntry {
    prefix: string;
    segmentHash: string;
    modelId: string;
    platform: string;
    prefixVersion: string;
    storedAt: number;
    expiresAt: number | null;
}
export interface PrefixCacheStats {
    hits: number;
    misses: number;
    ratio: number;
    size: number;
    capacity: number;
}
export type Platform = 'instagram' | 'tiktok' | 'x' | 'youtube' | 'facebook' | 'reddit' | 'threads' | 'snapchat' | 'discord' | 'telegram' | 'fanvue';
/**
 * Compute a content-addressed cache key from model ID, platform, prefix version,
 * and segment hash. Uses SHA-256 for deterministic, collision-resistant keys.
 */
export declare function cacheKey(modelId: string, platform: string, prefixVersion: string, segmentHash?: string): string;
export declare class PrefixCache {
    private cache;
    private capacity;
    private hits;
    private misses;
    private totalRequests;
    constructor(capacity?: number);
    /**
     * Get a cached prefix by key. Returns the entry or undefined if not found / expired.
     * Moves accessed entries to the end (most recently used) for LRU ordering.
     */
    get(key: string): string | undefined;
    /**
     * Store a prefix in the cache with optional TTL (in milliseconds).
     * If the cache is at capacity, evicts the least recently used entry (first key).
     */
    set(key: string, prefix: string, modelId: string, platform: string, prefixVersion: string, segmentHash?: string, ttl?: number): void;
    /**
     * Check if a key exists in the cache and is not expired.
     */
    has(key: string): boolean;
    /**
     * Get cache statistics including hit ratio.
     */
    getStats(): PrefixCacheStats;
    /**
     * Clear all entries and reset statistics.
     */
    clear(): void;
    /**
     * Invalidate a specific key from the cache.
     * Returns true if the key was found and deleted.
     */
    invalidate(key: string): boolean;
    /**
     * Invalidate all entries matching a given model ID and platform.
     * Useful when rules change for a specific model+platform combination.
     */
    invalidateByModelAndPlatform(modelId: string, platform: string): number;
    /**
     * Invalidate all entries matching a given model ID.
     */
    invalidateByModel(modelId: string): number;
    /**
     * Get the current size of the cache.
     */
    get size(): number;
    /**
     * Get the maximum capacity of the cache.
     */
    get maxSize(): number;
    /**
     * Resize the cache. If the new capacity is smaller than the current size,
     * the oldest entries are evicted.
     */
    resize(newCapacity: number): void;
    /**
     * Align a complete prompt to 64-token boundaries using the local alignBlocks.
     * This is a convenience method for cache consumers.
     */
    alignPrompt(text: string): string;
}
/**
 * Simple KV response cache used by LLMGateway for caching LLM responses.
 * Separate from the prefix cache — this stores full responses by conversation key.
 */
export declare class ResponseCache {
    private store;
    private hits;
    private misses;
    get(key: string): {
        content: string;
        usage: {
            prompt: number;
            completion: number;
        };
    } | null;
    set(key: string, value: {
        content: string;
        usage: {
            prompt: number;
            completion: number;
        };
    }): void;
    stats(): {
        hits: number;
        misses: number;
        size: number;
    };
    clear(): void;
}
//# sourceMappingURL=cache.d.ts.map