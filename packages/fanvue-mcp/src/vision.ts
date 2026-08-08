// ─── Response Types ───

export type OverrideVerdict = 'pass' | 'review' | 'block';

export interface TosClassifyResult {
  /** Probability score 0–1 for ToS violation likelihood */
  score: number;
  /** Verdict from the engine: pass | review | block (null when pass) */
  category: string | null;
  /** Human-readable explanation (reasons joined) */
  explanation: string;
  /** Whether the vision engine was the primary Rust engine or local fallback */
  source: 'rust_engine' | 'local_fallback';
  /** True when the verdict was forced by an override (model bypassed) */
  overridden: boolean;
  /** Override source: 'request' | 'environment' | null */
  overrideSource: string | null;
}

export interface NsfwDetectResult {
  /** Probability score 0–1 for NSFW content */
  score: number;
  /** Detected NSFW categories (labels above a 0.1 probability floor) */
  categories: string[];
  /** Whether the vision engine was the primary Rust engine or local fallback */
  source: 'rust_engine' | 'local_fallback';
  /** True when the verdict was forced by an override (model bypassed) */
  overridden: boolean;
  /** Override source: 'request' | 'environment' | null */
  overrideSource: string | null;
}

export interface VisionCallOptions {
  /** Force the verdict instead of running the model: pass | review | block */
  override?: OverrideVerdict;
}

// ─── Configuration ───

export interface VisionEngineConfig {
  /** Base URL of the Rust vision engine */
  baseUrl: string;
  /** Request timeout in milliseconds */
  timeoutMs: number;
  /** Explicit development/test escape hatch. Production defaults fail closed. */
  allowLocalFallback: boolean;
}

const DEFAULT_CONFIG: VisionEngineConfig = {
  baseUrl: 'http://127.0.0.1:8101',
  timeoutMs: 30000,
  allowLocalFallback: false,
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
  const hasExplicitKeywords = /\b(nsfw|nude|explicit|adult|xxx)\b/i.test(asLower);

  const score = hasExplicitKeywords ? Math.max(0.6, sizeScore) : sizeScore;

  return {
    score: Math.round(score * 1000) / 1000,
    category: hasExplicitKeywords ? 'explicit_content' : null,
    explanation: hasExplicitKeywords
      ? 'Local heuristic: explicit keywords detected in metadata'
      : 'Local heuristic: no clear ToS violations detected',
    source: 'local_fallback',
    overridden: false,
    overrideSource: null,
  };
}

function localNsfwHeuristic(imageData: string): NsfwDetectResult {
  const asLower = imageData.toLowerCase();
  const keywords = ['nsfw', 'nude', 'explicit', 'adult', 'xxx', '18+'];
  const detected = keywords.filter((k) => asLower.includes(k));

  const score = detected.length > 0 ? Math.min(0.4 + detected.length * 0.15, 0.95) : 0.05;

  return {
    score: Math.round(score * 1000) / 1000,
    categories: detected.length > 0 ? detected : [],
    source: 'local_fallback',
    overridden: false,
    overrideSource: null,
  };
}

// ─── Rust Engine Wire Types (contract with crates/vision-engine) ───

interface RustTosClassifyResponse {
  verdict: string;
  nsfw_score: number;
  reasons: string[];
  engine: string;
  probabilities: number[];
  labels: string[];
  overridden: boolean;
  override_source: string | null;
}

interface RustNsfwDetectResponse {
  nsfw_score: number;
  confidence: number;
  engine: string;
  probabilities: number[];
  labels: string[];
  analysis: {
    dimensions: { width: number; height: number };
    avg_brightness: number;
    color_variance: number;
    aspect_ratio: number;
  };
  overridden: boolean;
  override_source: string | null;
}

// ─── HTTP Helpers ───

async function postJson<T>(url: string, body: unknown, config: VisionEngineConfig): Promise<T> {
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
      throw new Error(`Vision engine returned ${response.status}: ${response.statusText}`);
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
   * The engine reads `image_path` from local disk; pass an absolute path.
   * Falls back to local heuristic if the engine is unreachable.
   */
  async callTosClassify(
    imagePath: string,
    options: VisionCallOptions = {},
  ): Promise<TosClassifyResult> {
    try {
      const body: Record<string, unknown> = { image_path: imagePath };
      if (options.override) body.override = options.override;

      const result = await postJson<RustTosClassifyResponse>(
        `${this.config.baseUrl}/vision/tos-classify`,
        body,
        this.config,
      );

      return {
        score: Math.round(result.nsfw_score * 1000) / 1000,
        category: result.verdict === 'pass' ? null : result.verdict,
        explanation: result.reasons.join('; ') || 'no violations detected',
        source: 'rust_engine',
        overridden: result.overridden,
        overrideSource: result.override_source,
      };
    } catch (err) {
      if (!this.config.allowLocalFallback) throw err;
      console.warn(
        `[VisionEngine] Rust engine unreachable, falling back to local heuristic: ${err instanceof Error ? err.message : String(err)}`,
      );
      return localTosHeuristic(imagePath);
    }
  }

  /**
   * Call the Rust vision engine /vision/nsfw-detect endpoint.
   * The engine reads `image_path` from local disk; pass an absolute path.
   * Falls back to local heuristic if the engine is unreachable.
   */
  async callNsfwDetect(
    imagePath: string,
    options: VisionCallOptions = {},
  ): Promise<NsfwDetectResult> {
    try {
      const body: Record<string, unknown> = { image_path: imagePath };
      if (options.override) body.override = options.override;

      const result = await postJson<RustNsfwDetectResponse>(
        `${this.config.baseUrl}/vision/nsfw-detect`,
        body,
        this.config,
      );

      // Categories = labels whose probability clears a 0.1 floor.
      const categories = result.labels.filter((_label, i) => (result.probabilities[i] ?? 0) > 0.1);

      return {
        score: Math.round(result.nsfw_score * 1000) / 1000,
        categories,
        source: 'rust_engine',
        overridden: result.overridden,
        overrideSource: result.override_source,
      };
    } catch (err) {
      if (!this.config.allowLocalFallback) throw err;
      console.warn(
        `[VisionEngine] Rust engine unreachable, falling back to local heuristic: ${err instanceof Error ? err.message : String(err)}`,
      );
      return localNsfwHeuristic(imagePath);
    }
  }
}
