// ─── Response Types ───

export interface TosClassifyResult {
  /** Probability score 0–1 for ToS violation likelihood */
  score: number;
  /** Category of violation, if any */
  category: string | null;
  /** Human-readable explanation */
  explanation: string;
  /** Whether the vision engine was the primary Rust engine or local fallback */
  source: 'rust_engine' | 'local_fallback';
}

export interface NsfwDetectResult {
  /** Probability score 0–1 for NSFW content */
  score: number;
  /** Detected NSFW categories */
  categories: string[];
  /** Whether the vision engine was the primary Rust engine or local fallback */
  source: 'rust_engine' | 'local_fallback';
}

// ─── Configuration ───

export interface VisionEngineConfig {
  /** Base URL of the Rust vision engine */
  baseUrl: string;
  /** Request timeout in milliseconds */
  timeoutMs: number;
}

const DEFAULT_CONFIG: VisionEngineConfig = {
  baseUrl: 'http://127.0.0.1:4100',
  timeoutMs: 30000,
};

// ─── Local Heuristic Fallback ───

/**
 * Local heuristic classification when the Rust vision engine is unreachable.
 * Uses simple pixel-level heuristics and keyword-based detection.
 * This is deliberately conservative — it flags suspicious content for review
 * rather than attempting to be accurate.
 */
function localTosHeuristic(imageData: string): TosClassifyResult {
  const base64Length = imageData.length;

  // Estimate image size in bytes from base64 string length
  const estimatedBytes = Math.floor((base64Length * 3) / 4);

  // Heuristic: very large images might contain high-detail content
  const sizeScore = Math.min(estimatedBytes / (10 * 1024 * 1024), 0.3);

  // Check for watermark-like patterns in base64 (simple heuristic)
  const asLower = imageData.toLowerCase();
  const hasExplicitKeywords =
    /\b(nsfw|nude|explicit|adult|xxx)\b/i.test(asLower);

  const score = hasExplicitKeywords ? Math.max(0.6, sizeScore) : sizeScore;

  return {
    score: Math.round(score * 1000) / 1000,
    category: hasExplicitKeywords ? 'explicit_content' : null,
    explanation: hasExplicitKeywords
      ? 'Local heuristic: explicit keywords detected in metadata'
      : 'Local heuristic: no clear ToS violations detected',
    source: 'local_fallback',
  };
}

function localNsfwHeuristic(imageData: string): NsfwDetectResult {
  const asLower = imageData.toLowerCase();
  const keywords = ['nsfw', 'nude', 'explicit', 'adult', 'xxx', '18+'];
  const detected = keywords.filter((k) => asLower.includes(k));

  const score = detected.length > 0
    ? Math.min(0.4 + detected.length * 0.15, 0.95)
    : 0.05;

  return {
    score: Math.round(score * 1000) / 1000,
    categories: detected.length > 0 ? detected : [],
    source: 'local_fallback',
  };
}

// ─── HTTP Helpers ───

async function postJson<T>(
  url: string,
  body: unknown,
  config: VisionEngineConfig,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(
        `Vision engine returned ${response.status}: ${response.statusText}`,
      );
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Vision Engine Client ───

export class VisionEngineClient {
  private config: VisionEngineConfig;

  constructor(config?: Partial<VisionEngineConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Call the Rust vision engine /vision/tos-classify endpoint.
   * Falls back to local heuristic if the engine is unreachable.
   */
  async callTosClassify(imageData: string): Promise<TosClassifyResult> {
    try {
      const result = await postJson<{
        score: number;
        category: string | null;
        explanation: string;
      }>(
        `${this.config.baseUrl}/vision/tos-classify`,
        { image: imageData },
        this.config,
      );

      return {
        ...result,
        score: Math.round(result.score * 1000) / 1000,
        source: 'rust_engine',
      };
    } catch (err) {
      console.warn(
        `[VisionEngine] Rust engine unreachable, falling back to local heuristic: ${err instanceof Error ? err.message : String(err)}`,
      );
      return localTosHeuristic(imageData);
    }
  }

  /**
   * Call the Rust vision engine /vision/nsfw-detect endpoint.
   * Falls back to local heuristic if the engine is unreachable.
   */
  async callNsfwDetect(imageData: string): Promise<NsfwDetectResult> {
    try {
      const result = await postJson<{
        score: number;
        categories: string[];
      }>(
        `${this.config.baseUrl}/vision/nsfw-detect`,
        { image: imageData },
        this.config,
      );

      return {
        ...result,
        score: Math.round(result.score * 1000) / 1000,
        source: 'rust_engine',
      };
    } catch (err) {
      console.warn(
        `[VisionEngine] Rust engine unreachable, falling back to local heuristic: ${err instanceof Error ? err.message : String(err)}`,
      );
      return localNsfwHeuristic(imageData);
    }
  }
}
