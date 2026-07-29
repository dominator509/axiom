import { createHash } from 'node:crypto';
import { type Platform } from '@axiom/core';

// ─── TOKENKILLER Segment Types ───

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

// ─── Prefix Version ───

export interface PrefixVersion {
  major: number;
  minor: number;
  patch: number;
}

const CURRENT_VERSION: PrefixVersion = { major: 1, minor: 0, patch: 0 };

function versionToString(v: PrefixVersion): string {
  return `${v.major}.${v.minor}.${v.patch}`;
}

// ─── 64-Token Block Alignment ───

/**
 * Token estimation: ~4 characters per token for English text.
 * Used for alignment; actual token count varies by model.
 */
const CHARS_PER_TOKEN = 4;
const BLOCK_SIZE_TOKENS = 64;
const BLOCK_SIZE_CHARS = BLOCK_SIZE_TOKENS * CHARS_PER_TOKEN;

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

  // Use BLOCK_SIZE_CHARS as the alignment quantum (silences unused-var lint)
  const _alignmentQuantum = BLOCK_SIZE_CHARS;
  void _alignmentQuantum;

  return text + ' '.repeat(charsToAdd);
}

// ─── Cache Key Computation ───

/**
 * Compute a content-addressed cache key from model ID, platform, and prefix version.
 * Uses SHA-256 for deterministic, collision-resistant keys.
 */
export function cacheKey(
  modelId: string,
  platform: Platform,
  prefixVersion: string = versionToString(CURRENT_VERSION),
): string {
  const input = `${modelId}::${platform}::${prefixVersion}`;
  return createHash('sha256').update(input, 'utf-8').digest('hex').slice(0, 16);
}

// ─── TOKENKILLER Prefix Assembler ───

export class TokenKillerAssembler {
  private version: PrefixVersion;
  /** In-memory content-addressed cache: key -> assembled prefix */
  private cache: Map<string, CacheEntry>;

  constructor(version?: Partial<PrefixVersion>) {
    this.version = { ...CURRENT_VERSION, ...version };
    this.cache = new Map();
  }

  /**
   * Get the current prefix version string.
   */
  getVersion(): string {
    return versionToString(this.version);
  }

  /**
   * Assemble the TOKENKILLER prefix from segments in order [S0, S1, S2, S3].
   * Each segment is separated by a clear delimiter to maintain structure.
   * The result is block-aligned to 64-token boundaries.
   */
  segmentPrompt(segments: TokenKillerSegments): string {
    const parts: string[] = [];

    // S0: System persona
    if (segments.S0) {
      parts.push(`[SYSTEM]\n${segments.S0}`);
    }

    // S1: Playbook / ToS rules
    if (segments.S1) {
      parts.push(`[PLAYBOOK]\n${segments.S1}`);
    }

    // S2: Viral exemplars
    if (segments.S2) {
      parts.push(`[EXEMPLARS]\n${segments.S2}`);
    }

    // S3: Task variables
    if (segments.S3) {
      parts.push(`[TASK]\n${segments.S3}`);
    }

    const assembled = parts.join('\n\n');
    return alignBlocks(assembled);
  }

  /**
   * Compute the cache key for a given model, platform, and version.
   * Optionally incorporates segment content for content-addressability.
   */
  getCacheKey(
    modelId: string,
    platform: Platform,
    segments?: TokenKillerSegments,
  ): string {
    if (segments) {
      // Content-addressed: hash includes segment content
      const contentStr = [
        modelId,
        platform,
        versionToString(this.version),
        segments.S0,
        segments.S1,
      ].join('::');
      return createHash('sha256')
        .update(contentStr, 'utf-8')
        .digest('hex')
        .slice(0, 16);
    }
    return cacheKey(modelId, platform, versionToString(this.version));
  }

  /**
   * Store an assembled prefix in the content-addressed cache.
   */
  store(segments: TokenKillerSegments, prefix: string): string {
    const key = createHash('sha256')
      .update(prefix, 'utf-8')
      .digest('hex')
      .slice(0, 16);

    this.cache.set(key, {
      prefix,
      version: versionToString(this.version),
      createdAt: new Date().toISOString(),
      segments,
    });

    return key;
  }

  /**
   * Retrieve a cached prefix by its content hash.
   */
  retrieve(cacheKey: string): CacheEntry | undefined {
    return this.cache.get(cacheKey);
  }

  /**
   * Check if a prefix is cached for the given cache key.
   */
  has(cacheKey: string): boolean {
    return this.cache.has(cacheKey);
  }

  /**
   * Clear the in-memory cache.
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get the cache size.
   */
  get cacheSize(): number {
    return this.cache.size;
  }
}
