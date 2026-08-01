// @axiom/llm-gateway — Unified multi-provider LLM gateway

// Core gateway
export { LLMGateway } from './gateway.js';
export type {
  Message,
  MessageRole,
  ChatOptions,
  ChatResult,
  ProviderConfig,
  ProviderPolicy,
  RateLimitBucket,
} from './gateway.js';

// HTTP router (Hono) for the gateway
export { createRouter as createLLMRouter } from './routes.js';

// Prompt management (TOKENKILLER S0-S3 segments)
export {
  buildS0,
  buildS1,
  buildS2,
  buildS3,
  assemblePrompt,
  generatePhotoshootPrompts,
  calculateCourseAdherence,
} from './prompts.js';
export type {
  TokenKillerSegments,
  ModelProfile,
  PlatformRules,
  ViralExemplar,
  TaskVariables,
  AssembledPrompt,
  PhotoshootConfig,
  PhotoshootVariant,
  CourseAdherenceInput,
  CourseAdherenceScore,
} from './prompts.js';

// Prefix cache
export { PrefixCache, ResponseCache, cacheKey, alignBlocks } from './cache.js';
export type {
  PrefixCacheEntry,
  PrefixCacheStats,
} from './cache.js';

// Pipeline
export { Pipeline } from './pipeline.js';
export type {
  PipelineTransform,
  PipelineOptions,
  PipelineResult,
} from './pipeline.js';

// Providers
export type {
  BaseProvider,
  ProviderMessage,
  ProviderChatResult,
  ProviderStreamChunk,
  ProviderOptions,
} from './providers/types.js';
export {
  OpenAIProvider,
  AnthropicProvider,
  VeniceProvider,
  MistralProvider,
  LightningProvider,
  GoogleProvider,
  VLLMProvider,
} from './providers/index.js';
