// ─── Connector Interface Types per L3.2 Spec ───

import type { Platform, PublishMode } from '@axiom/core';

/** Media types a connector can handle */
export type MediaType =
  'image' | 'video' | 'carousel' | 'story' | 'short' | 'text' | 'gif' | 'audio';

/** Scheduling capability */
export type SchedulingCapability = 'none' | 'native' | 'internal';

/** Metric names each platform supports */
export type MetricName =
  | 'impressions'
  | 'reach'
  | 'likes'
  | 'comments'
  | 'shares'
  | 'saves'
  | 'follows'
  | 'views'
  | 'watch_time'
  | 'engagement_rate'
  | 'clicks'
  | 'reposts'
  | 'quotes'
  | 'mentions'
  | 'favorites'
  | 'retweets';

/** Declared capability for a connector */
export interface ConnectorCapability {
  publish: true;
  media: MediaType[];
  maxMediaBytes: number;
  maxMediaCount: number;
  caption: boolean;
  maxCaptionLength: number;
  scheduling: SchedulingCapability;
  metrics: MetricName[];
  refreshMetrics: boolean;
}

/** Validation severity */
export type TosVerdict = 'pass' | 'flag' | 'block';
export type ValidationSeverity = 'error' | 'warning' | 'info';

/** Individual validation message */
export interface ValidationMessage {
  field: string;
  message: string;
  severity: ValidationSeverity;
}

/** Result of validation */
export interface ValidationReport {
  valid: boolean;
  errors: ValidationMessage[];
  warnings: ValidationMessage[];
  infos: ValidationMessage[];
  tosVerdict: TosVerdict;
}

/**
 * Publish input extended with connector-specific fields.
 * The base PublishInput from @axiom/core provides targetPlatforms,
 * captions, hashtags, mediaUrls, scheduledFor, mode.
 */
export interface ConnectorPublishInput {
  /** Content bundle / post ID for idempotency */
  idempotencyKey: string;
  /** Caption text for this platform */
  caption: string;
  /** Ordered media URLs */
  mediaUrls: string[];
  /** Hashtags (without #) */
  hashtags?: string[];
  /** ISO-8601 scheduled time */
  scheduledFor?: string;
  /** Connector-specific options (varies per platform) */
  options?: Record<string, unknown>;
  /** Tags / mentions */
  tags?: string[];
}

/** Result of a publish operation */
export interface ConnectorPublishResult {
  remoteId: string | null;
  state: 'published' | 'pending' | 'failed' | 'skipped';
  error?: string;
  /** Platform-specific post URL */
  postUrl?: string;
  /** Time in ms spent on the publish call */
  latencyMs?: number;
}

/** Metrics returned by fetchMetrics */
export interface ConnectorMetrics {
  postId: string;
  platform: Platform;
  collectedAt: string;
  metrics: Partial<Record<MetricName, number>>;
  raw?: Record<string, unknown>;
}

/** OAuth / token import for connector initialization */
export interface ConnectorAuth {
  accessToken: string;
  refreshToken?: string;
  /** For platform-specific identifiers like IG Business Account ID, YouTube Channel ID */
  externalUserId?: string;
  /** Token expiry in epoch seconds */
  expiresAt?: number;
  /** Extra auth context per platform */
  extra?: Record<string, unknown>;
}

/** Platform-specific metric period */
export type MetricPeriod = 'day' | 'week' | 'month' | 'lifetime';

/**
 * The SocialConnector contract per L3.2.
 * Every connector must implement this interface.
 */
export interface SocialConnector {
  /** Unique platform identifier */
  readonly platform: Platform;

  /** Human-readable connector name */
  readonly displayName: string;

  /** Publish mode: api, assisted, or link_share */
  readonly publishMode: PublishMode;

  /** Auth configuration for this connector instance */
  readonly auth: ConnectorAuth;

  /** Declare capabilities */
  capability(): ConnectorCapability;

  /** Validate content before publishing */
  validate(input: ConnectorPublishInput): Promise<ValidationReport>;

  /** Publish content to the platform (idempotent via idempotencyKey) */
  publish(input: ConnectorPublishInput): Promise<ConnectorPublishResult>;

  /** Fetch post metrics */
  fetchMetrics(remoteId: string, period?: MetricPeriod): Promise<ConnectorMetrics>;

  /** Revoke access / disconnect */
  revoke(): Promise<void>;
}

/** Relay handoff for assisted-publish platforms (Snapchat etc.) */
export interface RelayHandoff {
  platform: Platform;
  type: 'assisted_publish';
  instructions: string;
  assets: string[];
  caption: string;
  handoffUrl?: string;
}

/** Idempotency ledger entry */
export interface IdempotencyEntry {
  idempotencyKey: string;
  platform: Platform;
  remoteId: string | null;
  state: 'published' | 'pending' | 'failed' | 'skipped';
  completedAt: string;
}

/** Pre-Post Script hook result (Fanvue) */
export interface PrePostScriptResult {
  passed: boolean;
  script: string;
  output: string;
  modifiedInput?: Partial<ConnectorPublishInput>;
}
