// ─── AXIOM Fanvue MCP Package — Barrel Export ───

export { FanvueMcpClient, FanvueMcpError } from './client.js';
export type {
  FanvueCredentials,
  ConnectResult,
  StartImageUploadResult,
  PostResult,
  CreateImagePostArgs,
  AnalyticsResult,
  InboxResult,
  ReplyResult,
} from './client.js';

export {
  ToSEngine,
  DEFAULT_PLATFORM_THRESHOLDS,
  PLATFORM_RULES,
  evaluateTextToS,
} from './tos-engine.js';
export {
  PUBLIC_SFW_PLATFORMS,
  PUBLIC_SFW_SYSTEM_PROMPT,
  buildPublicSfwReply,
  isPrivateCommunityInvite,
  parsePublicSfwDraft,
  publicSfwReplyDelayMs,
  validatePublicSfwReply,
} from './public-sfw-funnel.js';
export type { PublicSfwDraft } from './public-sfw-funnel.js';
export type {
  PlatformScore,
  EvaluationResult,
  ImageClassification,
  PlatformRule,
  TextToSResult,
  TrustedVisionAnalysis,
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
export type { TosClassifyResult, NsfwDetectResult, VisionAnalysis, VisionEngineConfig } from './vision.js';
