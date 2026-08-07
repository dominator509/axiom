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
export interface VisionEngineConfig {
    /** Base URL of the Rust vision engine */
    baseUrl: string;
    /** Request timeout in milliseconds */
    timeoutMs: number;
}
export declare class VisionEngineClient {
    private config;
    constructor(config?: Partial<VisionEngineConfig>);
    /**
     * Call the Rust vision engine /vision/tos-classify endpoint.
     * The engine reads `image_path` from local disk; pass an absolute path.
     * Falls back to local heuristic if the engine is unreachable.
     */
    callTosClassify(imagePath: string, options?: VisionCallOptions): Promise<TosClassifyResult>;
    /**
     * Call the Rust vision engine /vision/nsfw-detect endpoint.
     * The engine reads `image_path` from local disk; pass an absolute path.
     * Falls back to local heuristic if the engine is unreachable.
     */
    callNsfwDetect(imagePath: string, options?: VisionCallOptions): Promise<NsfwDetectResult>;
}
//# sourceMappingURL=vision.d.ts.map