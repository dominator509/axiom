import { ResponseCache } from './cache.js';
import { Pipeline } from './pipeline.js';
import { type ModelProfile, type TaskVariables, type ViralExemplar } from './prompts.js';
export type MessageRole = 'system' | 'user' | 'assistant';
export interface Message {
    role: MessageRole;
    content: string;
}
export type ProviderPolicy = 'cost' | 'latency' | 'quality';
export interface ChatOptions {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    policy?: ProviderPolicy;
    provider?: string;
    signal?: AbortSignal;
    /**
     * Route this call through the model's bound egress sidecar (L2.6).
     * When true (or when the model profile has a bound, healthy egress),
     * provider traffic goes through the egress-plane's per-model namespace
     * proxy instead of the host's direct route.
     */
    egress?: boolean;
    /**
     * TOKENKILLER (L2.5 / LBI-09): assemble the request as S0–S3 segments,
     * align to 64-token blocks, and track prefix cache hits. When set, the
     * gateway prepends the aligned S0–S2 prefix (byte-stable, provider prefix
     * cache friendly) and appends the dynamic S3 task segment, then measures
     * the prefix-cache hit ratio across calls (target > 97%).
     */
    tokenkiller?: TokenKillerOptions;
}
export interface TokenKillerOptions {
    modelId: string;
    platform: string;
    /** Semi-static S2 exemplars (retrieved from the viral store). */
    exemplars?: ViralExemplar[];
    /** Dynamic S3 task variables (the actual task). */
    task: TaskVariables;
    /** Persona/system for S0 (per model, static). */
    profile: ModelProfile;
    /** Prefix version; bump when S0/S1 rules materially change. */
    prefixVersion?: string;
}
export interface ChatResult {
    id: string;
    content: string;
    model: string;
    provider: string;
    cost: number;
    tokens: {
        prompt: number;
        completion: number;
        total: number;
    };
    latency: number;
    cached: boolean;
}
export interface ProviderConfig {
    name: string;
    apiKeyEnv: string;
    baseUrl: string;
    defaultModel: string;
    /** Cost per 1K input tokens (USD, approximate) */
    costPer1KInput: number;
    /** Cost per 1K output tokens (USD, approximate) */
    costPer1KOutput: number;
    /** Typical latency rank — lower is faster */
    latencyRank: number;
    /** Typical quality rank — higher is better */
    qualityRank: number;
    /** Max requests per minute for rate limiting */
    rpm: number;
    /** Whether this provider requires an API key to be set */
    requiresKey: boolean;
}
export interface RateLimitBucket {
    tokens: number;
    capacity: number;
    refillRate: number;
    lastRefill: number;
}
export declare class LLMGateway {
    private providers;
    private rateLimiters;
    private cache;
    private pipeline;
    private prefixCache;
    private requestCount;
    private failureCount;
    constructor(providerOverrides?: Partial<ProviderConfig>[]);
    /** Merge user-provided overrides with defaults */
    private mergeProviderConfigs;
    /** Get the cache instance */
    getCache(): ResponseCache;
    /** Get the pipeline instance */
    getPipeline(): Pipeline;
    /** Get statistics */
    getStats(): {
        requests: number;
        failures: number;
        cache: {
            hits: number;
            misses: number;
            size: number;
        };
        tokenkiller: import("./cache.js").PrefixCacheStats;
    };
    /** Return a list of available (configured + key-present) provider names */
    getAvailableProviders(): string[];
    /** Select a provider based on policy and availability */
    private selectProvider;
    /** Build the fallback chain: primary → secondary → vLLM (local) */
    private buildFallbackChain;
    /** Check rate limit for a provider */
    private checkRateLimit;
    /**
     * Resolve a fetch implementation bound to the model's egress sidecar
     * (L2.6). Returns undefined when the model has no healthy bound egress —
     * callers then use the global fetch (direct route).
     */
    private resolveEgressFetch;
    /** Call a single provider with retry + exponential backoff */
    private callProvider;
    /**
     * Unified chat completion.
     * Selects a provider (based on policy), checks cache, executes with retry,
     * falls back through the chain on failure.
     */
    chat(messages: Message[], options?: ChatOptions): Promise<ChatResult>;
    /**
     * TOKENKILLER chat (L2.5 / LBI-09): assemble the request as S0–S3 segments,
     * 64-token block aligned, track the prefix in the PrefixCache, and emit a
     * cache-hit metric. Stable S0–S2 prefixes hit the local cache (and the
     * provider's prefix cache); only S3 varies per call. The >97% target is
     * measurable via getStats().tokenkiller.ratio.
     */
    chatWithTokenKiller(messages: Message[], options: ChatOptions): Promise<ChatResult>;
    /** Choose a sensible model for a tokenkiller call (fallback for tests). */
    private defaultModelFor;
    /**
     * Streaming chat completion.
     * Returns an AsyncIterable of content chunks.
     */
    chatStream(messages: Message[], options?: ChatOptions): Promise<AsyncIterable<string>>;
}
//# sourceMappingURL=gateway.d.ts.map