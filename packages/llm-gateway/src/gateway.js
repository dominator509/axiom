// LLMGateway — unified multi-provider chat completion gateway
// Supports OpenAI, Anthropic, DeepSeek, Grok, Venice, and local vLLM.
// Features: policy-based provider selection, fallback chains, rate limiting,
// exponential-backoff retry, response caching, streaming, and pipeline transforms.
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
import { v4 as uuid } from 'uuid';
import { callOpenAI, streamOpenAI, OPENAI_BASE_URL, } from './providers/openai.js';
import { callAnthropic, streamAnthropic, ANTHROPIC_BASE_URL, } from './providers/anthropic.js';
import { callDeepSeek, streamDeepSeek, DEEPSEEK_BASE_URL, } from './providers/deepseek.js';
import { callGrok, streamGrok, GROK_BASE_URL, } from './providers/grok.js';
import { callVenice, streamVenice, VENICE_BASE_URL, } from './providers/venice.js';
import { callVLLM, streamVLLM, VLLM_BASE_URL, } from './providers/vllm.js';
import { ResponseCache } from './cache.js';
import { Pipeline } from './pipeline.js';
// ---------------------------------------------------------------------------
// Provider registry
// ---------------------------------------------------------------------------
const DEFAULT_PROVIDERS = [
    {
        name: 'openai',
        apiKeyEnv: 'OPENAI_API_KEY',
        baseUrl: OPENAI_BASE_URL,
        defaultModel: 'gpt-4o',
        costPer1KInput: 0.0025,
        costPer1KOutput: 0.01,
        latencyRank: 2,
        qualityRank: 5,
        rpm: 500,
        requiresKey: true,
    },
    {
        name: 'anthropic',
        apiKeyEnv: 'ANTHROPIC_API_KEY',
        baseUrl: ANTHROPIC_BASE_URL,
        defaultModel: 'claude-3-5-sonnet-latest',
        costPer1KInput: 0.003,
        costPer1KOutput: 0.015,
        latencyRank: 3,
        qualityRank: 5,
        rpm: 400,
        requiresKey: true,
    },
    {
        name: 'deepseek',
        apiKeyEnv: 'DEEPSEEK_API_KEY',
        baseUrl: DEEPSEEK_BASE_URL,
        defaultModel: 'deepseek-chat',
        costPer1KInput: 0.0005,
        costPer1KOutput: 0.0015,
        latencyRank: 2,
        qualityRank: 3,
        rpm: 600,
        requiresKey: true,
    },
    {
        name: 'grok',
        apiKeyEnv: 'GROK_API_KEY',
        baseUrl: GROK_BASE_URL,
        defaultModel: 'grok-2-latest',
        costPer1KInput: 0.002,
        costPer1KOutput: 0.008,
        latencyRank: 2,
        qualityRank: 4,
        rpm: 300,
        requiresKey: true,
    },
    {
        name: 'venice',
        apiKeyEnv: 'VENICE_API_KEY',
        baseUrl: VENICE_BASE_URL,
        defaultModel: 'llama-3.1-70b',
        costPer1KInput: 0.0009,
        costPer1KOutput: 0.0009,
        latencyRank: 2,
        qualityRank: 3,
        rpm: 200,
        requiresKey: true,
    },
    {
        name: 'vllm',
        apiKeyEnv: '', // no key needed for local
        baseUrl: VLLM_BASE_URL,
        defaultModel: 'local-model',
        costPer1KInput: 0,
        costPer1KOutput: 0,
        latencyRank: 1,
        qualityRank: 2,
        rpm: 1000,
        requiresKey: false,
    },
];
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/** Token bucket rate limiter */
function createBucket(capacity, refillRate) {
    return { tokens: capacity, capacity, refillRate, lastRefill: Date.now() };
}
function refillBucket(bucket) {
    const now = Date.now();
    const elapsed = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(bucket.capacity, bucket.tokens + elapsed * bucket.refillRate);
    bucket.lastRefill = now;
}
function consumeBucket(bucket, count = 1) {
    refillBucket(bucket);
    if (bucket.tokens >= count) {
        bucket.tokens -= count;
        return true;
    }
    return false;
}
/** Calculate approximate cost in USD */
function calculateCost(provider, promptTokens, completionTokens) {
    return ((promptTokens / 1000) * provider.costPer1KInput +
        (completionTokens / 1000) * provider.costPer1KOutput);
}
/** Sleep helper */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
/** Get env var — case-insensitive lookup, prefers upper-case */
function getEnvVar(name) {
    return process.env[name] ?? process.env[name.toLowerCase()] ?? undefined;
}
// ---------------------------------------------------------------------------
// LLMGateway
// ---------------------------------------------------------------------------
export class LLMGateway {
    providers = new Map();
    rateLimiters = new Map();
    cache;
    pipeline;
    requestCount = 0;
    failureCount = 0;
    constructor(providerOverrides) {
        this.cache = new ResponseCache();
        this.pipeline = new Pipeline();
        const merged = providerOverrides
            ? this.mergeProviderConfigs(DEFAULT_PROVIDERS, providerOverrides)
            : DEFAULT_PROVIDERS;
        for (const p of merged) {
            this.providers.set(p.name, p);
            this.rateLimiters.set(p.name, createBucket(p.rpm, p.rpm / 60));
        }
    }
    /** Merge user-provided overrides with defaults */
    mergeProviderConfigs(defaults, overrides) {
        const map = new Map(defaults.map(d => [d.name, { ...d }]));
        for (const o of overrides) {
            if (o.name && map.has(o.name)) {
                map.set(o.name, { ...map.get(o.name), ...o });
            }
            else if (o.name) {
                // New provider from override
                map.set(o.name, {
                    name: o.name,
                    apiKeyEnv: '',
                    baseUrl: '',
                    defaultModel: 'default',
                    costPer1KInput: 0,
                    costPer1KOutput: 0,
                    latencyRank: 3,
                    qualityRank: 3,
                    rpm: 100,
                    requiresKey: false,
                    ...o,
                });
            }
        }
        return Array.from(map.values());
    }
    /** Get the cache instance */
    getCache() {
        return this.cache;
    }
    /** Get the pipeline instance */
    getPipeline() {
        return this.pipeline;
    }
    /** Get statistics */
    getStats() {
        return {
            requests: this.requestCount,
            failures: this.failureCount,
            cache: this.cache.stats(),
        };
    }
    /** Return a list of available (configured + key-present) provider names */
    getAvailableProviders() {
        const available = [];
        for (const [name, cfg] of this.providers) {
            if (!cfg.requiresKey || getEnvVar(cfg.apiKeyEnv)) {
                available.push(name);
            }
        }
        return available;
    }
    /** Select a provider based on policy and availability */
    selectProvider(policy = 'cost', explicit) {
        // If an explicit provider is requested, try it first
        if (explicit) {
            const cfg = this.providers.get(explicit);
            if (cfg)
                return [cfg];
            throw new Error(`Unknown provider: ${explicit}`);
        }
        // Filter to available providers (key present or no key required)
        const available = Array.from(this.providers.values()).filter(p => {
            if (p.requiresKey && !getEnvVar(p.apiKeyEnv))
                return false;
            return true;
        });
        if (available.length === 0) {
            throw new Error('No providers available — set at least one API key');
        }
        // Sort by policy
        const sorted = [...available];
        if (policy === 'cost') {
            sorted.sort((a, b) => a.costPer1KInput + a.costPer1KOutput - (b.costPer1KInput + b.costPer1KOutput));
        }
        else if (policy === 'latency') {
            sorted.sort((a, b) => a.latencyRank - b.latencyRank);
        }
        else {
            // 'quality' — highest quality first
            sorted.sort((a, b) => b.qualityRank - a.qualityRank);
        }
        return sorted;
    }
    /** Build the fallback chain: primary → secondary → vLLM (local) */
    buildFallbackChain(ordered) {
        const chain = [];
        if (ordered.length >= 2) {
            chain.push(ordered[0], ordered[1]);
        }
        else if (ordered.length === 1) {
            chain.push(ordered[0]);
        }
        // Always add vLLM as final fallback if available
        const vllm = this.providers.get('vllm');
        if (vllm && !chain.includes(vllm)) {
            chain.push(vllm);
        }
        return chain;
    }
    /** Check rate limit for a provider */
    checkRateLimit(providerName) {
        const bucket = this.rateLimiters.get(providerName);
        if (!bucket)
            return true; // no limiter = pass
        return consumeBucket(bucket);
    }
    /** Call a single provider with retry + exponential backoff */
    async callProvider(provider, messages, options) {
        const maxRetries = 3;
        let lastError = null;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            if (attempt > 0) {
                const delay = Math.min(1000 * 2 ** (attempt - 1), 10_000);
                await sleep(delay);
            }
            try {
                // Rate limit check
                if (!this.checkRateLimit(provider.name)) {
                    throw new Error(`Rate limit exceeded for ${provider.name}`);
                }
                const start = performance.now();
                const model = options.model ?? provider.defaultModel;
                let content;
                let promptTokens;
                let completionTokens;
                if (provider.name === 'openai') {
                    const apiKey = getEnvVar('OPENAI_API_KEY');
                    if (!apiKey)
                        throw new Error('OPENAI_API_KEY not set');
                    const res = await callOpenAI(apiKey, { model, messages, temperature: options.temperature, max_tokens: options.maxTokens }, options.signal);
                    content = res.choices[0]?.message?.content ?? '';
                    promptTokens = res.usage.prompt_tokens;
                    completionTokens = res.usage.completion_tokens;
                }
                else if (provider.name === 'anthropic') {
                    const apiKey = getEnvVar('ANTHROPIC_API_KEY');
                    if (!apiKey)
                        throw new Error('ANTHROPIC_API_KEY not set');
                    const systemMsg = messages.find(m => m.role === 'system');
                    const chatMessages = messages.filter(m => m.role !== 'system');
                    const res = await callAnthropic(apiKey, {
                        model,
                        messages: chatMessages.map(m => ({ role: m.role, content: m.content })),
                        max_tokens: options.maxTokens ?? 4096,
                        temperature: options.temperature,
                        system: systemMsg?.content,
                    }, options.signal);
                    content = res.content.map(c => c.text).join('');
                    promptTokens = res.usage.input_tokens;
                    completionTokens = res.usage.output_tokens;
                }
                else if (provider.name === 'deepseek') {
                    const apiKey = getEnvVar('DEEPSEEK_API_KEY');
                    if (!apiKey)
                        throw new Error('DEEPSEEK_API_KEY not set');
                    const res = await callDeepSeek(apiKey, { model, messages, temperature: options.temperature, max_tokens: options.maxTokens }, options.signal);
                    content = res.choices[0]?.message?.content ?? '';
                    promptTokens = res.usage.prompt_tokens;
                    completionTokens = res.usage.completion_tokens;
                }
                else if (provider.name === 'grok') {
                    const apiKey = getEnvVar('GROK_API_KEY');
                    if (!apiKey)
                        throw new Error('GROK_API_KEY not set');
                    const res = await callGrok(apiKey, { model, messages, temperature: options.temperature, max_tokens: options.maxTokens }, options.signal);
                    content = res.choices[0]?.message?.content ?? '';
                    promptTokens = res.usage.prompt_tokens;
                    completionTokens = res.usage.completion_tokens;
                }
                else if (provider.name === 'venice') {
                    const apiKey = getEnvVar('VENICE_API_KEY');
                    if (!apiKey)
                        throw new Error('VENICE_API_KEY not set');
                    const res = await callVenice(apiKey, { model, messages, temperature: options.temperature, max_tokens: options.maxTokens }, options.signal);
                    content = res.choices[0]?.message?.content ?? '';
                    promptTokens = res.usage.prompt_tokens;
                    completionTokens = res.usage.completion_tokens;
                }
                else if (provider.name === 'vllm') {
                    const res = await callVLLM({ model, messages, temperature: options.temperature, max_tokens: options.maxTokens }, options.signal);
                    content = res.choices[0]?.message?.content ?? '';
                    promptTokens = res.usage.prompt_tokens;
                    completionTokens = res.usage.completion_tokens;
                }
                else {
                    throw new Error(`Unsupported provider: ${provider.name}`);
                }
                const latency = performance.now() - start;
                const totalTokens = promptTokens + completionTokens;
                const cost = calculateCost(provider, promptTokens, completionTokens);
                // Cache the result
                const cacheKey = `${typeof messages === 'string' ? messages : JSON.stringify(messages)}::${model}`;
                this.cache.set(cacheKey, {
                    content,
                    usage: { prompt: promptTokens, completion: completionTokens },
                });
                this.requestCount++;
                return {
                    id: uuid(),
                    content,
                    model,
                    provider: provider.name,
                    cost,
                    tokens: { prompt: promptTokens, completion: completionTokens, total: totalTokens },
                    latency,
                    cached: false,
                };
            }
            catch (err) {
                lastError = err instanceof Error ? err : new Error(String(err));
                this.failureCount++;
                if (err instanceof DOMException && err.name === 'AbortError') {
                    throw err; // Don't retry aborted requests
                }
                // On last attempt, don't continue
                if (attempt === maxRetries)
                    break;
            }
        }
        throw lastError ?? new Error(`Provider ${provider.name} failed after ${maxRetries} retries`);
    }
    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------
    /**
     * Unified chat completion.
     * Selects a provider (based on policy), checks cache, executes with retry,
     * falls back through the chain on failure.
     */
    async chat(messages, options = {}) {
        const model = options.model;
        const temperature = options.temperature ?? 0.7;
        const maxTokens = options.maxTokens ?? 4096;
        const policy = options.policy ?? 'cost';
        const requiredOptions = {
            model: model ?? '',
            temperature,
            maxTokens,
            policy,
            provider: options.provider ?? '',
            signal: options.signal,
        };
        // Run pipeline before-hooks
        const [processedMessages, pipelineOpts] = await this.pipeline.runBefore(messages, {
            ...requiredOptions,
        });
        const resolvedModel = pipelineOpts.model;
        requiredOptions.model = resolvedModel ?? requiredOptions.model;
        // Check cache
        const cacheKey = requiredOptions.model || model || '';
        if (cacheKey) {
            const cached = this.cache.get(cacheKey);
            if (cached !== null) {
                return {
                    id: uuid(),
                    content: cached.content,
                    model: cacheKey,
                    provider: 'cache',
                    cost: 0,
                    tokens: { prompt: 0, completion: 0, total: 0 },
                    latency: 0,
                    cached: true,
                };
            }
        }
        // Select provider(s) and build fallback chain
        const ordered = this.selectProvider(policy, options.provider);
        const chain = this.buildFallbackChain(ordered);
        // Try each provider in the chain
        let lastError = null;
        for (const provider of chain) {
            try {
                const result = await this.callProvider(provider, processedMessages, requiredOptions);
                // Run pipeline after-hooks
                const pipelineResult = await this.pipeline.runAfter({
                    content: result.content,
                    model: result.model,
                    provider: result.provider,
                    cost: result.cost,
                    tokens: result.tokens,
                    latency: result.latency,
                });
                return {
                    ...result,
                    content: pipelineResult.content,
                    model: pipelineResult.model,
                    provider: pipelineResult.provider,
                    cost: pipelineResult.cost,
                    tokens: pipelineResult.tokens,
                    latency: pipelineResult.latency,
                };
            }
            catch (err) {
                lastError = err instanceof Error ? err : new Error(String(err));
                // Continue to fallback
            }
        }
        throw lastError ?? new Error('All providers in the fallback chain failed');
    }
    /**
     * Streaming chat completion.
     * Returns an AsyncIterable of content chunks.
     */
    async chatStream(messages, options = {}) {
        const model = options.model;
        const temperature = options.temperature ?? 0.7;
        const maxTokens = options.maxTokens ?? 4096;
        const policy = options.policy ?? 'cost';
        const requiredOptions = {
            model: model ?? '',
            temperature,
            maxTokens,
            policy,
            provider: options.provider ?? '',
            signal: options.signal,
        };
        // Run pipeline before-hooks
        const [processedMessages] = await this.pipeline.runBefore(messages, {
            ...requiredOptions,
        });
        // Select provider and build fallback chain
        const ordered = this.selectProvider(policy, options.provider);
        const chain = this.buildFallbackChain(ordered);
        // Build a combined async generator that tries each provider in chain
        const self = this;
        async function* streamWithFallback() {
            let lastError = null;
            for (const provider of chain) {
                try {
                    // Rate limit check
                    if (!self.checkRateLimit(provider.name)) {
                        throw new Error(`Rate limit exceeded for ${provider.name}`);
                    }
                    const resolvedModel = requiredOptions.model || provider.defaultModel;
                    let stream;
                    if (provider.name === 'openai') {
                        const apiKey = getEnvVar('OPENAI_API_KEY');
                        if (!apiKey)
                            throw new Error('OPENAI_API_KEY not set');
                        stream = streamOpenAI(apiKey, {
                            model: resolvedModel,
                            messages: processedMessages,
                            temperature: requiredOptions.temperature,
                            max_tokens: requiredOptions.maxTokens,
                        }, options.signal);
                    }
                    else if (provider.name === 'anthropic') {
                        const apiKey = getEnvVar('ANTHROPIC_API_KEY');
                        if (!apiKey)
                            throw new Error('ANTHROPIC_API_KEY not set');
                        const systemMsg = processedMessages.find(m => m.role === 'system');
                        const chatMessages = processedMessages.filter(m => m.role !== 'system');
                        stream = streamAnthropic(apiKey, {
                            model: resolvedModel,
                            messages: chatMessages.map(m => ({ role: m.role, content: m.content })),
                            max_tokens: requiredOptions.maxTokens ?? 4096,
                            temperature: requiredOptions.temperature,
                            system: systemMsg?.content,
                        }, options.signal);
                    }
                    else if (provider.name === 'deepseek') {
                        const apiKey = getEnvVar('DEEPSEEK_API_KEY');
                        if (!apiKey)
                            throw new Error('DEEPSEEK_API_KEY not set');
                        stream = streamDeepSeek(apiKey, {
                            model: resolvedModel,
                            messages: processedMessages,
                            temperature: requiredOptions.temperature,
                            max_tokens: requiredOptions.maxTokens,
                        }, options.signal);
                    }
                    else if (provider.name === 'grok') {
                        const apiKey = getEnvVar('GROK_API_KEY');
                        if (!apiKey)
                            throw new Error('GROK_API_KEY not set');
                        stream = streamGrok(apiKey, {
                            model: resolvedModel,
                            messages: processedMessages,
                            temperature: requiredOptions.temperature,
                            max_tokens: requiredOptions.maxTokens,
                        }, options.signal);
                    }
                    else if (provider.name === 'venice') {
                        const apiKey = getEnvVar('VENICE_API_KEY');
                        if (!apiKey)
                            throw new Error('VENICE_API_KEY not set');
                        stream = streamVenice(apiKey, {
                            model: resolvedModel,
                            messages: processedMessages,
                            temperature: requiredOptions.temperature,
                            max_tokens: requiredOptions.maxTokens,
                        }, options.signal);
                    }
                    else if (provider.name === 'vllm') {
                        stream = streamVLLM({
                            model: resolvedModel,
                            messages: processedMessages,
                            temperature: requiredOptions.temperature,
                            max_tokens: requiredOptions.maxTokens,
                        }, options.signal);
                    }
                    else {
                        throw new Error(`Unsupported provider for streaming: ${provider.name}`);
                    }
                    self.requestCount++;
                    let fullContent = '';
                    for await (const chunk of stream) {
                        fullContent += chunk;
                        yield chunk;
                    }
                    // Cache the full response
                    const streamCacheKey = `${processedMessages}::${resolvedModel}`;
                    self.cache.set(streamCacheKey, {
                        content: fullContent,
                        usage: { prompt: 0, completion: 0 },
                    });
                    return; // Success — stop iterating fallback chain
                }
                catch (err) {
                    lastError = err instanceof Error ? err : new Error(String(err));
                    self.failureCount++;
                    if (err instanceof DOMException && err.name === 'AbortError') {
                        throw err;
                    }
                    // Continue to next provider in chain
                }
            }
            throw lastError ?? new Error('All streaming providers in fallback chain failed');
        }
        return streamWithFallback();
    }
}
//# sourceMappingURL=gateway.js.map