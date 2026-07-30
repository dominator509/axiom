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
     * Falls back to local heuristic if the engine is unreachable.
     */
    callTosClassify(imageData: string): Promise<TosClassifyResult>;
    /**
     * Call the Rust vision engine /vision/nsfw-detect endpoint.
     * Falls back to local heuristic if the engine is unreachable.
     */
    callNsfwDetect(imageData: string): Promise<NsfwDetectResult>;
}
//# sourceMappingURL=vision.d.ts.map