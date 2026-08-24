// LLMGateway — unified multi-provider chat completion gateway
// Supports user-funded OAuth subscription transports and local vLLM.
// Features: policy-based provider selection, fallback chains, rate limiting,
// exponential-backoff retry, response caching, streaming, and pipeline transforms.

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveEgressProxy, buildEgressFetch } from './egress.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
import { v4 as uuid } from 'uuid';
import { callVLLM, streamVLLM, VLLM_BASE_URL } from './providers/vllm.js';
import {
  OfficialSubscriptionTransport,
  type SubscriptionProvider,
  type SubscriptionTransport,
} from './providers/subscription.js';
import { ProviderError } from './providers/types.js';
import { ResponseCache, PrefixCache } from './cache.js';
import { Pipeline, type PipelineOptions } from './pipeline.js';
import {
  buildS0,
  buildS1,
  buildS2,
  buildS3,
  assemblePrompt,
  alignBlocks,
  type TokenKillerSegments,
  type ModelProfile,
  type TaskVariables,
  type ViralExemplar,
} from './prompts.js';
import { cacheKey } from './cache.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  provider?: string; // explicit provider override
  /** Authenticated AXIOM user whose provider subscription funds this call. */
  userId?: string;
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
  /** Official user-subscription CLI transport is available. */
  subscriptionSupported?: boolean;
}

export interface RateLimitBucket {
  tokens: number;
  capacity: number;
  refillRate: number; // tokens per second
  lastRefill: number; // timestamp
}

// ---------------------------------------------------------------------------
// Provider registry
// ---------------------------------------------------------------------------

const DEFAULT_PROVIDERS: ProviderConfig[] = [
  {
    name: 'openai',
    baseUrl: 'subscription://openai',
    defaultModel: 'openai-default',
    costPer1KInput: 0,
    costPer1KOutput: 0,
    latencyRank: 2,
    qualityRank: 5,
    rpm: 500,
    subscriptionSupported: true,
  },
  {
    name: 'anthropic',
    baseUrl: 'subscription://anthropic',
    defaultModel: 'anthropic-default',
    costPer1KInput: 0,
    costPer1KOutput: 0,
    latencyRank: 3,
    qualityRank: 5,
    rpm: 400,
    subscriptionSupported: true,
  },
  {
    name: 'deepseek',
    baseUrl: 'api-disabled://deepseek',
    defaultModel: 'deepseek-v4-flash',
    costPer1KInput: 0.0005,
    costPer1KOutput: 0.0015,
    latencyRank: 2,
    qualityRank: 3,
    rpm: 600,
  },
  {
    name: 'grok',
    baseUrl: 'subscription://grok',
    defaultModel: 'grok-default',
    costPer1KInput: 0,
    costPer1KOutput: 0,
    latencyRank: 2,
    qualityRank: 4,
    rpm: 300,
    subscriptionSupported: true,
  },
  {
    name: 'mistral',
    baseUrl: 'api-disabled://mistral',
    defaultModel: 'mistral-small-latest',
    costPer1KInput: 0.0001,
    costPer1KOutput: 0.0003,
    latencyRank: 2,
    qualityRank: 4,
    rpm: 500,
  },
  {
    name: 'lightning',
    baseUrl: 'api-disabled://lightning',
    defaultModel: 'claude-opus-4-7',
    costPer1KInput: 0.015,
    costPer1KOutput: 0.075,
    latencyRank: 2,
    qualityRank: 4,
    rpm: 300,
  },
  {
    name: 'google',
    baseUrl: 'api-disabled://google',
    defaultModel: 'gemini-flash-latest',
    costPer1KInput: 0.0001,
    costPer1KOutput: 0.0004,
    latencyRank: 2,
    qualityRank: 4,
    rpm: 500,
  },
  {
    name: 'venice',
    baseUrl: 'api-disabled://venice',
    defaultModel: 'venice-uncensored-1-2',
    costPer1KInput: 0.0009,
    costPer1KOutput: 0.0009,
    latencyRank: 2,
    qualityRank: 3,
    rpm: 200,
  },
  {
    name: 'vllm',
    baseUrl: VLLM_BASE_URL,
    defaultModel: 'local-model',
    costPer1KInput: 0,
    costPer1KOutput: 0,
    latencyRank: 1,
    qualityRank: 2,
    rpm: 1000,
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Token bucket rate limiter */
function createBucket(capacity: number, refillRate: number): RateLimitBucket {
  return { tokens: capacity, capacity, refillRate, lastRefill: Date.now() };
}

function refillBucket(bucket: RateLimitBucket): void {
  const now = Date.now();
  const elapsed = (now - bucket.lastRefill) / 1000;
  bucket.tokens = Math.min(bucket.capacity, bucket.tokens + elapsed * bucket.refillRate);
  bucket.lastRefill = now;
}

function consumeBucket(bucket: RateLimitBucket, count = 1): boolean {
  refillBucket(bucket);
  if (bucket.tokens >= count) {
    bucket.tokens -= count;
    return true;
  }
  return false;
}

/** Calculate approximate cost in USD */
function calculateCost(
  provider: ProviderConfig,
  promptTokens: number,
  completionTokens: number,
): number {
  return (
    (promptTokens / 1000) * provider.costPer1KInput +
    (completionTokens / 1000) * provider.costPer1KOutput
  );
}

/** Sleep helper */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function responseCacheKey(messages: Message[], model: string, userId: string): string {
  return JSON.stringify({ userId, model, messages });
}

/** Get env var — case-insensitive lookup, prefers upper-case */
// ---------------------------------------------------------------------------
// LLMGateway
// ---------------------------------------------------------------------------

export class LLMGateway {
  private providers: Map<string, ProviderConfig> = new Map();
  private rateLimiters: Map<string, RateLimitBucket> = new Map();
  private cache: ResponseCache;
  private pipeline: Pipeline;
  private prefixCache: PrefixCache;
  private requestCount = 0;
  private failureCount = 0;
  private subscriptionTransport: SubscriptionTransport;

  constructor(
    providerOverrides?: Partial<ProviderConfig>[],
    subscriptionTransport: SubscriptionTransport = new OfficialSubscriptionTransport(),
  ) {
    this.cache = new ResponseCache();
    this.pipeline = new Pipeline();
    this.prefixCache = new PrefixCache();
    this.subscriptionTransport = subscriptionTransport;

    const merged = providerOverrides
      ? this.mergeProviderConfigs(DEFAULT_PROVIDERS, providerOverrides)
      : DEFAULT_PROVIDERS;

    for (const p of merged) {
      this.providers.set(p.name, p);
      this.rateLimiters.set(p.name, createBucket(p.rpm, p.rpm / 60));
    }
  }

  /** Merge user-provided overrides with defaults */
  private mergeProviderConfigs(
    defaults: ProviderConfig[],
    overrides: Partial<ProviderConfig>[],
  ): ProviderConfig[] {
    const map = new Map(defaults.map((d) => [d.name, { ...d }]));
    for (const o of overrides) {
      if (o.name && map.has(o.name)) {
        map.set(o.name, { ...map.get(o.name)!, ...o });
      } else if (o.name) {
        // New provider from override
        map.set(o.name, {
          name: o.name,
          baseUrl: '',
          defaultModel: 'default',
          costPer1KInput: 0,
          costPer1KOutput: 0,
          latencyRank: 3,
          qualityRank: 3,
          rpm: 100,
          ...o,
        });
      }
    }
    return Array.from(map.values());
  }

  /** Get the cache instance */
  getCache(): ResponseCache {
    return this.cache;
  }

  /** Get the pipeline instance */
  getPipeline(): Pipeline {
    return this.pipeline;
  }

  /** Get statistics */
  getStats() {
    return {
      requests: this.requestCount,
      failures: this.failureCount,
      cache: this.cache.stats(),
      tokenkiller: this.prefixCache.getStats(),
    };
  }

  /** Return providers that cannot create operator-funded API charges. */
  getAvailableProviders(): string[] {
    const available: string[] = [];
    for (const [name, cfg] of this.providers) {
      if (name === 'vllm' || cfg.subscriptionSupported) {
        available.push(name);
      }
    }
    return available;
  }

  /** Full billing/auth matrix, including providers intentionally disabled. */
  getProviderCapabilities() {
    return Array.from(this.providers.values()).map((provider) => ({
      provider: provider.name,
      available: provider.name === 'vllm' || provider.subscriptionSupported === true,
      transport:
        provider.name === 'vllm'
          ? 'local'
          : provider.subscriptionSupported
            ? 'user-subscription'
            : 'unsupported',
      auth: provider.subscriptionSupported ? 'oauth' : provider.name === 'vllm' ? 'none' : null,
      operatorApiCost: false,
      reason:
        provider.name === 'vllm' || provider.subscriptionSupported
          ? null
          : 'No qualifying official subscription-backed transport',
    }));
  }

  async getSubscriptionStatus(provider: string, userId: string) {
    const config = this.providers.get(provider);
    if (!config?.subscriptionSupported) {
      throw new ProviderError('Provider has no subscription transport', 404, provider);
    }
    return this.subscriptionTransport.status(provider as SubscriptionProvider, userId);
  }

  connectSubscription(
    provider: string,
    userId: string,
    signal?: AbortSignal,
  ): AsyncIterable<string> {
    const config = this.providers.get(provider);
    if (!config?.subscriptionSupported) {
      throw new ProviderError('Provider has no subscription transport', 404, provider);
    }
    return this.subscriptionTransport.connect(provider as SubscriptionProvider, userId, signal);
  }

  async disconnectSubscription(provider: string, userId: string): Promise<void> {
    const config = this.providers.get(provider);
    if (!config?.subscriptionSupported) {
      throw new ProviderError('Provider has no subscription transport', 404, provider);
    }
    await this.subscriptionTransport.disconnect(provider as SubscriptionProvider, userId);
  }

  /** Select a provider based on policy and availability */
  private selectProvider(policy: ProviderPolicy = 'cost', explicit?: string): ProviderConfig[] {
    // If an explicit provider is requested, try it first
    if (explicit) {
      const cfg = this.providers.get(explicit);
      if (cfg && (cfg.name === 'vllm' || cfg.subscriptionSupported)) return [cfg];
      if (cfg) {
        throw new ProviderError(
          `${explicit} does not provide a supported user-subscription transport`,
          503,
          explicit,
        );
      }
      throw new Error(`Unknown provider: ${explicit}`);
    }

    // API-key-only providers are intentionally unavailable. A SaaS request may
    // use an official user subscription transport or the operator's local vLLM.
    const available = Array.from(this.providers.values()).filter((p) => {
      return p.name === 'vllm' || p.subscriptionSupported === true;
    });

    if (available.length === 0) {
      throw new Error('No subscription or local providers available');
    }

    // Sort by policy
    const sorted = [...available];
    if (policy === 'cost') {
      sorted.sort(
        (a, b) =>
          a.costPer1KInput + a.costPer1KOutput - (b.costPer1KInput + b.costPer1KOutput) ||
          Number(b.name === 'vllm') - Number(a.name === 'vllm'),
      );
    } else if (policy === 'latency') {
      sorted.sort((a, b) => a.latencyRank - b.latencyRank);
    } else {
      // 'quality' — highest quality first
      sorted.sort((a, b) => b.qualityRank - a.qualityRank);
    }

    return sorted;
  }

  /** Build the fallback chain: primary → secondary → vLLM (local) */
  private buildFallbackChain(ordered: ProviderConfig[], explicit = false): ProviderConfig[] {
    if (explicit) return ordered.slice(0, 1);
    const chain: ProviderConfig[] = [];
    if (ordered.length >= 2) {
      chain.push(ordered[0], ordered[1]);
    } else if (ordered.length === 1) {
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
  private checkRateLimit(providerName: string): boolean {
    const bucket = this.rateLimiters.get(providerName);
    if (!bucket) return true; // no limiter = pass
    return consumeBucket(bucket);
  }

  /**
   * Resolve a fetch implementation bound to the model's egress sidecar
   * (L2.6). Returns undefined when the model has no healthy bound egress —
   * callers then use the global fetch (direct route).
   */
  private async resolveEgressFetch(model: string): Promise<typeof fetch | undefined> {
    const proxy = await resolveEgressProxy(model);
    return proxy ? buildEgressFetch(proxy) : undefined;
  }

  /** Call a single provider with retry + exponential backoff */
  private async callProvider(
    provider: ProviderConfig,
    messages: Message[],
    options: Required<ChatOptions>,
  ): Promise<ChatResult> {
    // Never retry subscription generations: a transport failure after the
    // provider accepted the turn could consume the user's allowance twice.
    const maxRetries = provider.subscriptionSupported ? 0 : 3;
    let lastError: Error | null = null;
    // Egress: route through the model's bound sidecar when requested.
    const egressFetchImpl =
      options.egress && provider.name === 'vllm'
        ? await this.resolveEgressFetch(options.model)
        : undefined;

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
        const model = options.model || provider.defaultModel;

        let content: string;
        let promptTokens: number;
        let completionTokens: number;

        if (provider.subscriptionSupported) {
          if (!options.userId) {
            throw new ProviderError('Authenticated user is required', 401, provider.name);
          }
          if (options.egress) {
            throw new ProviderError(
              'Subscription CLI transports cannot use model egress bindings',
              422,
              provider.name,
            );
          }
          const res = await this.subscriptionTransport.chat({
            provider: provider.name as SubscriptionProvider,
            userId: options.userId,
            model,
            messages,
            signal: options.signal,
          });
          content = res.content;
          promptTokens = res.usage.promptTokens;
          completionTokens = res.usage.completionTokens;
        } else if (provider.name === 'vllm') {
          const res = await callVLLM(
            { model, messages, temperature: options.temperature, max_tokens: options.maxTokens },
            options.signal,
            egressFetchImpl ?? fetch,
          );
          content = res.choices[0]?.message?.content ?? '';
          promptTokens = res.usage.prompt_tokens;
          completionTokens = res.usage.completion_tokens;
        } else {
          throw new Error(`Unsupported provider: ${provider.name}`);
        }

        const latency = performance.now() - start;
        const totalTokens = promptTokens + completionTokens;
        const cost = calculateCost(provider, promptTokens, completionTokens);

        // Cache the result
        const resultCacheKey = responseCacheKey(messages, model, options.userId);
        this.cache.set(resultCacheKey, {
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
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        this.failureCount++;
        if (err instanceof DOMException && err.name === 'AbortError') {
          throw err; // Don't retry aborted requests
        }
        // On last attempt, don't continue
        if (attempt === maxRetries) break;
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
  async chat(messages: Message[], options: ChatOptions = {}): Promise<ChatResult> {
    const model = options.model;
    const temperature = options.temperature ?? 0.7;
    const maxTokens = options.maxTokens ?? 4096;
    const policy = options.policy ?? 'cost';

    const requiredOptions: Required<ChatOptions> = {
      model: model ?? '',
      temperature,
      maxTokens,
      policy,
      provider: options.provider ?? '',
      userId: options.userId ?? '',
      signal: options.signal!,
      egress: options.egress ?? false,
    } as Required<ChatOptions>;

    // Run pipeline before-hooks
    const [processedMessages, pipelineOpts] = await this.pipeline.runBefore(messages, {
      ...requiredOptions,
    } as unknown as PipelineOptions);

    const resolvedModel = pipelineOpts.model as string | undefined;
    requiredOptions.model = resolvedModel ?? requiredOptions.model;

    // Check cache
    const requestedModel = requiredOptions.model || model || '';
    if (requestedModel) {
      const resultCacheKey = responseCacheKey(
        processedMessages,
        requestedModel,
        requiredOptions.userId,
      );
      const cached = this.cache.get(resultCacheKey);
      if (cached !== null) {
        return {
          id: uuid(),
          content: cached.content,
          model: requestedModel,
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
    const chain = this.buildFallbackChain(ordered, Boolean(options.provider));

    // Try each provider in the chain
    const chainErrors: Array<{ provider: string; error: Error }> = [];
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
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        chainErrors.push({ provider: provider.name, error });
        // Continue to fallback
      }
    }

    // Surface the primary provider's error first, then the fallback trail.
    if (chainErrors.length > 0) {
      if (options.provider) throw chainErrors[0].error;
      const summary = chainErrors
        .map(({ provider, error }) => `${provider}: ${error.message}`)
        .join('; ');
      throw new Error(`All providers in the fallback chain failed — ${summary}`);
    }
    throw new Error('All providers in the fallback chain failed');
  }

  /**
   * TOKENKILLER chat (L2.5 / LBI-09): assemble the request as S0–S3 segments,
   * 64-token block aligned, track the prefix in the PrefixCache, and emit a
   * cache-hit metric. Stable S0–S2 prefixes hit the local cache (and the
   * provider's prefix cache); only S3 varies per call. The >97% target is
   * measurable via getStats().tokenkiller.ratio.
   */
  async chatWithTokenKiller(messages: Message[], options: ChatOptions): Promise<ChatResult> {
    const tk = options.tokenkiller;
    if (!tk) {
      throw new Error('chatWithTokenKiller: tokenkiller options required');
    }

    const prefixVersion = tk.prefixVersion ?? 'v1';
    const segments: TokenKillerSegments = {
      S0: buildS0(tk.profile),
      S1: buildS1(tk.platform as Parameters<typeof buildS1>[0]),
      S2: buildS2(tk.exemplars ?? []),
      S3: buildS3(tk.task),
    };
    const prefix = alignBlocks(segments.S0 + segments.S1 + segments.S2);

    // Content-addressed prefix key; same (model, platform, version, exemplar
    // set) ⇒ same key ⇒ local prefix-cache hit (provider prefix cache also
    // hits because the emitted prefix is byte-stable).
    const key = cacheKey(tk.modelId, tk.platform, prefixVersion, segments.S2);
    const cachedPrefix = this.prefixCache.get(key);
    if (cachedPrefix === undefined) {
      this.prefixCache.set(key, prefix, tk.modelId, tk.platform, prefixVersion, segments.S2);
    }

    const assembled = assemblePrompt(segments);
    const tokenkillerMessages: Message[] = [
      { role: 'system', content: assembled },
      ...messages.filter((m) => m.role !== 'system'),
    ];

    const { tokenkiller: _tk, ...rest } = options;
    const result = await this.chat(tokenkillerMessages, {
      ...rest,
      model: options.model ?? this.defaultModelFor(tk),
      tokenkiller: undefined,
    });
    return {
      ...result,
      model: result.model,
      provider: result.provider,
    };
  }

  /** Choose a sensible model for a tokenkiller call (fallback for tests). */
  private defaultModelFor(_tk: TokenKillerOptions): string {
    for (const [, cfg] of this.providers) {
      if (cfg.name === 'vllm' || cfg.subscriptionSupported) {
        return cfg.defaultModel;
      }
    }
    return 'default';
  }

  /**
   * Streaming chat completion.
   * Returns an AsyncIterable of content chunks.
   */
  async chatStream(messages: Message[], options: ChatOptions = {}): Promise<AsyncIterable<string>> {
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
      userId: options.userId ?? '',
      signal: options.signal!,
      egress: options.egress ?? false,
    } as Required<ChatOptions>;

    // Run pipeline before-hooks
    const [processedMessages] = await this.pipeline.runBefore(messages, {
      ...requiredOptions,
    } as unknown as PipelineOptions);

    // Select provider and build fallback chain
    const ordered = this.selectProvider(policy, options.provider);
    const chain = this.buildFallbackChain(ordered, Boolean(options.provider));

    // Build a combined async generator that tries each provider in chain
    const checkRateLimit = (providerName: string) => this.checkRateLimit(providerName);
    const recordRequest = () => {
      this.requestCount++;
    };
    const recordFailure = () => {
      this.failureCount++;
    };
    const cacheResponse = (key: string, content: string) => {
      this.cache.set(key, { content, usage: { prompt: 0, completion: 0 } });
    };
    const subscriptionTransport = this.subscriptionTransport;
    const egressFetchImpl =
      requiredOptions.egress && chain.some((provider) => provider.name === 'vllm')
        ? await this.resolveEgressFetch(requiredOptions.model)
        : undefined;
    async function* streamWithFallback(): AsyncIterable<string> {
      let lastError: Error | null = null;

      for (const provider of chain) {
        try {
          // Rate limit check
          if (!checkRateLimit(provider.name)) {
            throw new Error(`Rate limit exceeded for ${provider.name}`);
          }

          const resolvedModel = requiredOptions.model || provider.defaultModel;

          let stream: AsyncIterable<string>;

          if (provider.subscriptionSupported) {
            if (!requiredOptions.userId) {
              throw new ProviderError('Authenticated user is required', 401, provider.name);
            }
            if (requiredOptions.egress) {
              throw new ProviderError(
                'Subscription CLI transports cannot use model egress bindings',
                422,
                provider.name,
              );
            }
            stream = subscriptionTransport.stream({
              provider: provider.name as SubscriptionProvider,
              userId: requiredOptions.userId,
              model: resolvedModel,
              messages: processedMessages,
              signal: options.signal,
            });
          } else if (provider.name === 'vllm') {
            stream = streamVLLM(
              {
                model: resolvedModel,
                messages: processedMessages,
                temperature: requiredOptions.temperature,
                max_tokens: requiredOptions.maxTokens,
              },
              options.signal,
              egressFetchImpl ?? fetch,
            );
          } else {
            throw new Error(`Unsupported provider for streaming: ${provider.name}`);
          }

          recordRequest();
          let fullContent = '';
          for await (const chunk of stream) {
            fullContent += chunk;
            yield chunk;
          }

          // Cache the full response
          const streamCacheKey = responseCacheKey(
            processedMessages,
            resolvedModel,
            requiredOptions.userId,
          );
          cacheResponse(streamCacheKey, fullContent);

          return; // Success — stop iterating fallback chain
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          recordFailure();
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
