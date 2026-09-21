// @axiom/llm-gateway — Unified multi-provider LLM gateway

// Core gateway
export { LLMGateway } from './gateway.js';
export { resolveEgressProxy, buildEgressFetch, clearEgressCache } from './egress.js';
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
export type { TokenKillerOptions } from './gateway.js';

// Prefix cache
export { PrefixCache, ResponseCache, cacheKey, alignBlocks } from './cache.js';
export type { PrefixCacheEntry, PrefixCacheStats } from './cache.js';

// Pipeline
export { Pipeline } from './pipeline.js';
export type { PipelineTransform, PipelineOptions, PipelineResult } from './pipeline.js';

// Providers
export type {
  BaseProvider,
  ProviderMessage,
  ProviderChatResult,
  ProviderStreamChunk,
  ProviderOptions,
} from './providers/types.js';
// Paid API providers remain internal compatibility code and are intentionally
// absent from the public package surface.
export { VLLMProvider } from './providers/vllm.js';
export { OfficialSubscriptionTransport } from './providers/subscription.js';
export {
  CACHE_CONTROL_PROVIDERS,
  anthropicCacheControl,
  deepseekCacheFields,
  openaiCacheFields,
  applyCacheControl,
  defaultCacheControlSetting,
  isCacheControlProvider,
  isValidPromptCacheKey,
  canonicalCacheControls,
  CACHE_CONTROL_UNSUPPORTED_CODE,
} from './cache-controls.js';
export type { CacheControlProvider, CacheControlSetting } from './cache-controls.js';
export { characterLockSnapshot, buildMediaPrompt } from './media-prompt.js';
export type { CharacterLockSnapshot } from './media-prompt.js';
export type { GrokMediaRequest } from './providers/subscription.js';
export {
  normalizeR2ObjectKey,
  withinR2ObjectLimits,
} from './grok-r2-storage.js';
export type { R2ObjectKeyKind, R2ObjectScope } from './grok-r2-storage.js';
export { createObjectStorage, LocalObjectStorage, R2ObjectStorage } from './object-storage.js';
export type {
  ObjectStorage,
  ObjectStorageScope,
  StorageDeleteResult,
  StorageObjectMetadata,
  StorageObjectRead,
  StoragePutInput,
} from './object-storage.js';
export {
  boundRoleplayMemory,
  formatRoleplayHandoff,
  formatRoleplayMemory,
  formatRoleplayPersona,
  formatRoleplayPromptContext,
  loadRoleplaySoulSnapshot,
  parseRoleplayHandoff,
  serializeRoleplayHandoff,
  validateRoleplayHandoff,
  validateRoleplayMemoryPolicy,
  validateRoleplayPersonaSnapshot,
  ROLEPLAY_ACTOR_TYPES,
  ROLEPLAY_HANDOFF_SCHEMA,
  ROLEPLAY_HANDOFF_VERSION,
  ROLEPLAY_LIMITS,
  ROLEPLAY_MEMORY_ROLES,
  ROLEPLAY_PERSONA_SOURCES,
} from './roleplay-context.js';
export type {
  RoleplayActor,
  RoleplayActorType,
  RoleplayHandoff,
  RoleplayMemoryPolicy,
  RoleplayMemoryRole,
  RoleplayMemoryTurn,
  RoleplayPromptContext,
  RoleplaySoulDocument,
  RoleplaySoulReader,
  RoleplaySoulScope,
  RoleplayHandoffDocument,
  RoleplayPersonaSnapshot,
  RoleplayPersonaMetadata,
  RoleplayPersonaSource,
} from './roleplay-context.js';
