// ─── Response Types ───

import { readBoundedResponseJson } from '@axiom/core';

export type OverrideVerdict = 'pass' | 'review' | 'block';

/** Bounded statistical image descriptors returned by the Rust vision engine. */
export interface VisionAnalysis {
  dimensions: { width: number; height: number };
  avgBrightness: number;
  colorVariance: number;
  aspectRatio: number;
}

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
  /** Engine confidence, omitted from trust decisions when malformed. */
  confidence: number | null;
  /** Bounded statistical descriptors; null when the engine did not provide a valid receipt. */
  analysis: VisionAnalysis | null;
}

export interface VisionCallOptions {
  /** Force the verdict instead of running the model: pass | review | block */
  override?: OverrideVerdict;
}

// ─── Configuration ───

export interface VisionEngineConfig {
  /** Base URL of the Rust vision engine */
  baseUrl: string;
  /** Shared internal bearer token for a non-loopback vision service. */
  authToken?: string;
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

function configuredVisionBaseUrl(): string {
  const configured = [process.env.VISION_ENGINE_URL, process.env.AXIOM_VISION_URL]
    .map((value) => value?.trim())
    .find((value): value is string => Boolean(value));
  return configured ?? DEFAULT_CONFIG.baseUrl;
}

function configuredVisionAuthToken(): string | undefined {
  return [process.env.AXIOM_VISION_AUTH_TOKEN, process.env.VISION_ENGINE_AUTH_TOKEN]
    .map((value) => value?.trim())
    .find((value): value is string => Boolean(value));
}

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
    confidence: null,
    analysis: null,
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
  confidence?: number;
  engine: string;
  probabilities: number[];
  labels: string[];
  analysis?: unknown;
  overridden: boolean;
  override_source: string | null;
}

// ─── HTTP Helpers ───

class InvalidVisionScoreError extends Error {}

function normalizedVisionScore(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new InvalidVisionScoreError('Vision engine returned invalid nsfw_score');
  }
  return Math.round(value * 1000) / 1000;
}

function normalizedOptionalUnit(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) return null;
  return Math.round(value * 1000) / 1000;
}

function normalizedVisionAnalysis(value: unknown): VisionAnalysis | null {
  if (!value || typeof value !== 'object') return null;
  const analysis = value as Record<string, unknown>;
  const dimensions = analysis.dimensions;
  if (!dimensions || typeof dimensions !== 'object') return null;
  const size = dimensions as Record<string, unknown>;
  const width = size.width;
  const height = size.height;
  const avgBrightness = analysis.avg_brightness;
  const colorVariance = analysis.color_variance;
  const aspectRatio = analysis.aspect_ratio;
  if (
    typeof width !== 'number' || !Number.isInteger(width) || width < 1 || width > 10_000
    || typeof height !== 'number' || !Number.isInteger(height) || height < 1 || height > 10_000
    || typeof avgBrightness !== 'number' || !Number.isFinite(avgBrightness) || avgBrightness < 0 || avgBrightness > 255
    || typeof colorVariance !== 'number' || !Number.isFinite(colorVariance) || colorVariance < 0 || colorVariance > 255
    || typeof aspectRatio !== 'number' || !Number.isFinite(aspectRatio) || aspectRatio < 0.01 || aspectRatio > 100
  ) return null;
  return {
    dimensions: { width, height },
    avgBrightness: Math.round(avgBrightness * 1000) / 1000,
    colorVariance: Math.round(colorVariance * 1000) / 1000,
    aspectRatio: Math.round(aspectRatio * 1000) / 1000,
  };
}

async function postJson<T>(url: string, body: unknown, config: VisionEngineConfig): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.authToken ? { Authorization: `Bearer ${config.authToken}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Vision engine returned ${response.status}: ${response.statusText}`);
    }

    return await readBoundedResponseJson<T>(response);
  } finally {
    clearTimeout(timer);
  }
}

// ─── Vision Engine Client ───

export class VisionEngineClient {
  private config: VisionEngineConfig;

  constructor(config?: Partial<VisionEngineConfig>) {
    this.config = {
      ...DEFAULT_CONFIG,
      baseUrl: configuredVisionBaseUrl(),
      authToken: configuredVisionAuthToken(),
      ...config,
    };
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
        score: normalizedVisionScore(result?.nsfw_score),
        category: result.verdict === 'pass' ? null : result.verdict,
        explanation: result.reasons.join('; ') || 'no violations detected',
        source: 'rust_engine',
        overridden: result.overridden,
        overrideSource: result.override_source,
      };
    } catch (err) {
      if (err instanceof InvalidVisionScoreError || !this.config.allowLocalFallback) throw err;
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
      const score = normalizedVisionScore(result?.nsfw_score);
      const categories = result.labels.filter((_label, i) => (result.probabilities[i] ?? 0) > 0.1);

      return {
        score,
        categories,
        source: 'rust_engine',
        overridden: result.overridden,
        overrideSource: result.override_source,
        confidence: normalizedOptionalUnit(result.confidence),
        analysis: normalizedVisionAnalysis(result.analysis),
      };
    } catch (err) {
      if (err instanceof InvalidVisionScoreError || !this.config.allowLocalFallback) throw err;
      console.warn(
        `[VisionEngine] Rust engine unreachable, falling back to local heuristic: ${err instanceof Error ? err.message : String(err)}`,
      );
      return localNsfwHeuristic(imagePath);
    }
  }
}
