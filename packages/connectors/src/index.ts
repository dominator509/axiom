// ─── Connectors Barrel Export ───

export { BaseConnector } from './base.js';
export type { LogEntry } from './base.js';
export { createConnector } from './factory.js';
export { capabilityNames } from './capabilities.js';

export { InstagramConnector } from './instagram.js';
export { TikTokConnector } from './tiktok.js';
export { YouTubeConnector } from './youtube.js';
export { XConnector } from './x.js';
export { FacebookConnector } from './facebook.js';
export { RedditConnector } from './reddit.js';
export { ThreadsConnector } from './threads.js';
export { DiscordConnector } from './discord.js';
export { TelegramConnector } from './telegram.js';
export { SnapchatConnector } from './snapchat.js';
export { FanvueConnector } from './fanvue.js';

export {
  register,
  connectorFor,
  hasConnector,
  allConnectors,
  registeredPlatforms,
  resolveCapabilities,
  validateForPlatform,
} from './registry.js';

export { validatePublish } from './validation.js';
export type { ValidationReport } from './types.js';

export type {
  SocialConnector,
  ConnectorAuth,
  ConnectorPublishInput,
  ConnectorPublishResult,
  ConnectorCapability,
  ConnectorMetrics,
  MetricPeriod,
  RelayHandoff,
  IdempotencyEntry,
  MediaType,
  MetricName,
  TosVerdict,
} from './types.js';
