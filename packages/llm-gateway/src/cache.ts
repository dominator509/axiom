// ─── Prefix Cache Manager ───
// LRU cache for prompt prefixes with TTL, hit ratio tracking, and 64-token block alignment.

import { createHash } from 'node:crypto';

// ─── 64-Token Block Alignment ───

const CHARS_PER_TOKEN = 4;
const BLOCK_SIZE_TOKENS = 64;

/**
 * Align a text string to a multiple of 64 tokens by padding with spaces.
 * This ensures prefix blocks align with the model's tokenization boundaries,
 * reducing inference variance from token boundary shifts.
 */
export function alignBlocks(text: string): string {
  const estimatedTokens = Math.ceil(text.length / CHARS_PER_TOKEN);
  const remainder = estimatedTokens % BLOCK_SIZE_TOKENS;

  if (remainder === 0) {
    return text;
  }

  const tokensToAdd = BLOCK_SIZE_TOKENS - remainder;
  const charsToAdd = tokensToAdd * CHARS_PER_TOKEN;

  return text + ' '.repeat(charsToAdd);
}

// ─── Types ───

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

export type Platform =
  | 'instagram' | 'tiktok' | 'x' | 'youtube' | 'facebook'
  | 'reddit' | 'threads' | 'snapchat' | 'discord' | 'telegram' | 'fanvue';

// ─── Cache Key Hash ───

/**
 * Compute a content-addressed cache key from model ID, platform, prefix version,
 * and segment hash. Uses SHA-256 for deterministic, collision-resistant keys.
 */
export function cacheKey(
  modelId: string,
  platform: string,
  prefixVersion: string,
  segmentHash?: string,
): string {
  const input = segmentHash
    ? `${modelId}::${platform}::${prefixVersion}::${segmentHash}`
    : `${modelId}::${platform}::${prefixVersion}`;
  return createHash('sha256').update(input, 'utf-8').digest('hex').slice(0, 16);
}

// ─── LRU Prefix Cache Manager ───

export class PrefixCache {
  private cache: Map<string, PrefixCacheEntry>;
  private capacity: number;
  private hits = 0;
  private misses = 0;
  private totalRequests = 0;

  constructor(capacity = 1000) {
    this.capacity = capacity;
    this.cache = new Map();
  }

  /**
   * Get a cached prefix by key. Returns the entry or undefined if not found / expired.
   * Moves accessed entries to the end (most recently used) for LRU ordering.
   */
  get(key: string): string | undefined {
    this.totalRequests++;
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      return undefined;
    }

    // Check TTL expiration
    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.misses++;
      return undefined;
    }

    // LRU: delete and re-insert to move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);
    this.hits++;
    return entry.prefix;
  }

  /**
   * Store a prefix in the cache with optional TTL (in milliseconds).
   * If the cache is at capacity, evicts the least recently used entry (first key).
   */
  set(
    key: string,
    prefix: string,
    modelId: string,
    platform: string,
    prefixVersion: string,
    segmentHash?: string,
    ttl?: number,
  ): void {
    // Evict LRU entries if at capacity
    if (this.cache.size >= this.capacity) {
      const oldest = this.cache.keys().next();
      if (!oldest.done) {
        this.cache.delete(oldest.value);
      }
    }

    const now = Date.now();
    this.cache.set(key, {
      prefix,
      segmentHash: segmentHash ?? '',
      modelId,
      platform,
      prefixVersion,
      storedAt: now,
      expiresAt: ttl ? now + ttl : null,
    });
  }

  /**
   * Check if a key exists in the cache and is not expired.
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Get cache statistics including hit ratio.
   */
  getStats(): PrefixCacheStats {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      ratio: total > 0 ? this.hits / total : 0,
      size: this.cache.size,
      capacity: this.capacity,
    };
  }

  /**
   * Clear all entries and reset statistics.
   */
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    this.totalRequests = 0;
  }

  /**
   * Invalidate a specific key from the cache.
   * Returns true if the key was found and deleted.
   */
  invalidate(key: string): boolean {
    const existed = this.cache.has(key);
    this.cache.delete(key);
    return existed;
  }

  /**
   * Invalidate all entries matching a given model ID and platform.
   * Useful when rules change for a specific model+platform combination.
   */
  invalidateByModelAndPlatform(modelId: string, platform: string): number {
    let count = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (entry.modelId === modelId && entry.platform === platform) {
        this.cache.delete(key);
        count++;
      }
    }
    return count;
  }

  /**
   * Invalidate all entries matching a given model ID.
   */
  invalidateByModel(modelId: string): number {
    let count = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (entry.modelId === modelId) {
        this.cache.delete(key);
        count++;
      }
    }
    return count;
  }

  /**
   * Get the current size of the cache.
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Get the maximum capacity of the cache.
   */
  get maxSize(): number {
    return this.capacity;
  }

  /**
   * Resize the cache. If the new capacity is smaller than the current size,
   * the oldest entries are evicted.
   */
  resize(newCapacity: number): void {
    this.capacity = newCapacity;
    while (this.cache.size > this.capacity) {
      const oldest = this.cache.keys().next();
      if (!oldest.done) {
        this.cache.delete(oldest.value);
      } else {
        break;
      }
    }
  }

  /**
   * Align a complete prompt to 64-token boundaries using the local alignBlocks.
   * This is a convenience method for cache consumers.
   */
  alignPrompt(text: string): string {
    return alignBlocks(text);
  }
}

/**
 * Simple KV response cache used by LLMGateway for caching LLM responses.
 * Separate from the prefix cache — this stores full responses by conversation key.
 */
export class ResponseCache {
  private store = new Map<string, { content: string; usage: { prompt: number; completion: number } }>();
  private hits = 0;
  private misses = 0;

  get(key: string): { content: string; usage: { prompt: number; completion: number } } | null {
    const entry = this.store.get(key);
    if (entry) {
      this.hits++;
      return entry;
    }
    this.misses++;
    return null;
  }

  set(key: string, value: { content: string; usage: { prompt: number; completion: number } }): void {
    this.store.set(key, value);
  }

  stats(): { hits: number; misses: number; size: number } {
    return { hits: this.hits, misses: this.misses, size: this.store.size };
  }

  clear(): void {
    this.store.clear();
    this.hits = 0;
    this.misses = 0;
  }
}
