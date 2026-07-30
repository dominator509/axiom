import { ResponseCache } from './cache.js';
import { Pipeline } from './pipeline.js';
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
    };
    /** Return a list of available (configured + key-present) provider names */
    getAvailableProviders(): string[];
    /** Select a provider based on policy and availability */
    private selectProvider;
    /** Build the fallback chain: primary → secondary → vLLM (local) */
    private buildFallbackChain;
    /** Check rate limit for a provider */
    private checkRateLimit;
    /** Call a single provider with retry + exponential backoff */
    private callProvider;
    /**
     * Unified chat completion.
     * Selects a provider (based on policy), checks cache, executes with retry,
     * falls back through the chain on failure.
     */
    chat(messages: Message[], options?: ChatOptions): Promise<ChatResult>;
    /**
     * Streaming chat completion.
     * Returns an AsyncIterable of content chunks.
     */
    chatStream(messages: Message[], options?: ChatOptions): Promise<AsyncIterable<string>>;
}
//# sourceMappingURL=gateway.d.ts.map