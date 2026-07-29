// ─── AXIOM Fanvue MCP Package — Barrel Export ───

export { FanvueMcpClient, FanvueMcpError } from './client.js';
export type {
  FanvueCredentials,
  ConnectResult,
  UploadResult,
  PostResult,
  AnalyticsResult,
  AnalyticsDataPoint,
  InboxResult,
  InboxMessage,
  ReplyResult,
} from './client.js';

export { ToSEngine, DEFAULT_PLATFORM_THRESHOLDS, PLATFORM_RULES } from './tos-engine.js';
export type {
  PlatformScore,
  EvaluationResult,
  ImageClassification,
  PlatformRule,
} from './tos-engine.js';

export { PrePostHook } from './prepost.js';
export type { PrePostScript, ScriptSandbox } from './prepost.js';

export { ContentGenerator } from './generator.js';
export type {
  PromptConfig,
  PlatformContent,
  ContentBundleResult,
  PlatformLimits,
} from './generator.js';

export { TokenKillerAssembler, alignBlocks, cacheKey } from './tokenkiller.js';
export type { TokenKillerSegments, CacheEntry, PrefixVersion } from './tokenkiller.js';

export { VisionEngineClient } from './vision.js';
export type {
  TosClassifyResult,
  NsfwDetectResult,
  VisionEngineConfig,
} from './vision.js';
