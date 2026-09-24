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
  /** True only when this connection can execute its declared publish mode. */
  publish: boolean;
  media: MediaType[];
  maxMediaBytes: number;
  maxMediaCount: number;
  caption: boolean;
  maxCaptionLength: number;
  scheduling: SchedulingCapability;
  metrics: MetricName[];
  refreshMetrics: boolean;
  /** Explicit, granted-scope-backed community operations; absent means none. */
  operations?: SocialOperationName[];
  /** Exact comment moderation actions this credential can perform. */
  moderationActions?: SocialModerationAction[];
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
  state: 'published' | 'pending' | 'failed' | 'skipped' | 'manual_assist';
  error?: string;
  /** Platform-specific post URL */
  postUrl?: string;
  /** Time in ms spent on the publish call */
  latencyMs?: number;
  /** Explicit operator handoff for assisted platforms; never a success claim. */
  handoff?: RelayHandoff;
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

/** Normalized community operation names exposed to API and dashboard clients. */
export type SocialOperationName =
  | 'comments.read'
  | 'comments.reply'
  | 'comments.moderate'
  | 'messages.read'
  | 'messages.send'
  | 'youtube.playlists.read'
  | 'youtube.playlist.create'
  | 'youtube.playlist.add-video'
  | 'youtube.playlist.remove-video'
  | 'youtube.thumbnail.set'
  | 'youtube.captions.list'
  | 'youtube.captions.upload'
  | 'youtube.captions.delete'
  | 'vault.folders.read'
  | 'vault.folder.read'
  | 'vault.folder.create'
  | 'vault.folder.rename'
  | 'vault.folder.delete'
  | 'vault.media.read'
  | 'vault.media.add'
  | 'vault.media.remove'
  | 'vault.media.update';

export type SocialModerationAction = 'hide' | 'delete' | 'approve' | 'reject' | 'block';

export type SocialOperationInput =
  | { type: 'comments.read'; postId: string; cursor?: string; limit?: number }
  | { type: 'comments.reply'; commentId: string; text: string }
  | { type: 'comments.moderate'; commentId: string; action: SocialModerationAction }
  | { type: 'messages.read'; conversationId?: string; cursor?: string; limit?: number }
  | { type: 'messages.send'; recipientId: string; text: string }
  | { type: 'youtube.playlists.read'; cursor?: string; limit?: number }
  | { type: 'youtube.playlist.create'; title: string; description?: string; privacyStatus: 'private' | 'public' | 'unlisted' }
  | { type: 'youtube.playlist.add-video'; playlistId: string; videoId: string; position?: number }
  | { type: 'youtube.playlist.remove-video'; playlistItemId: string }
  | { type: 'youtube.thumbnail.set'; videoId: string; mediaUrl: string; mimeType?: 'image/jpeg' | 'image/png' }
  | { type: 'youtube.captions.list'; videoId: string }
  | { type: 'youtube.captions.upload'; videoId: string; language: string; name: string; mediaUrl: string; isDraft?: boolean }
  | { type: 'youtube.captions.delete'; captionId: string }
  | { type: 'vault.folders.read'; page?: number; size?: number; mediaName?: string }
  | { type: 'vault.folder.read'; folderName: string }
  | { type: 'vault.folder.create'; name: string }
  | { type: 'vault.folder.rename'; folderName: string; name: string }
  | { type: 'vault.folder.delete'; folderName: string }
  | {
      type: 'vault.media.read';
      folderName: string;
      page?: number;
      size?: number;
      mediaType?: 'image' | 'video' | 'audio' | 'document';
      name?: string;
      startDate?: string;
      endDate?: string;
      variants?: Array<'blurred' | 'main' | 'thumbnail' | 'thumbnail_gallery'>;
    }
  | { type: 'vault.media.add'; folderName: string; mediaUuids: string[] }
  | { type: 'vault.media.remove'; folderName: string; mediaUuid: string }
  | {
      type: 'vault.media.update';
      folderName: string;
      mediaUuid: string;
      name?: string | null;
      recommendedPrice?: number | null;
    };

export interface FanvueVaultFolder {
  name: string;
  createdAt: string | null;
  mediaCount: number;
}

/** Deliberately excludes private media variant URLs from the dashboard contract. */
export interface FanvueVaultMedia {
  uuid: string;
  status: string;
  createdAt?: string | null;
  name?: string | null;
  mediaType?: 'image' | 'video' | 'audio' | 'document';
  caption?: string | null;
  description?: string | null;
  recommendedPrice?: number | null;
}

export interface SocialOperationPagination {
  page: number;
  size: number;
  hasMore: boolean;
}

export interface NormalizedSocialComment {
  id: string;
  postId: string;
  text: string;
  authorId?: string;
  authorName?: string;
  createdAt?: string;
  permalink?: string;
}

export interface NormalizedSocialMessage {
  id: string;
  conversationId: string;
  senderId: string;
  text: string;
  createdAt?: string;
}

export interface YouTubePlaylist {
  id: string;
  title: string;
  description?: string;
  privacyStatus?: 'private' | 'public' | 'unlisted';
}

export interface YouTubeCaptionTrack {
  id: string;
  language: string;
  name?: string;
  status?: string;
  isDraft?: boolean;
}

export type SocialOperationResult =
  | { type: 'comments'; items: NormalizedSocialComment[]; nextCursor?: string }
  | { type: 'messages'; items: NormalizedSocialMessage[]; nextCursor?: string }
  | { type: 'youtube.playlists'; items: YouTubePlaylist[]; nextCursor?: string }
  | { type: 'youtube.captions'; items: YouTubeCaptionTrack[] }
  | { type: 'mutation'; remoteId?: string; success: true; affectedCount?: number }
  | { type: 'vault.folders'; items: FanvueVaultFolder[]; pagination: SocialOperationPagination }
  | { type: 'vault.folder'; folder: FanvueVaultFolder }
  | { type: 'vault.media'; items: FanvueVaultMedia[]; pagination: SocialOperationPagination };

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

  /** Execute a community operation only when advertised by capability(). */
  executeOperation?(input: SocialOperationInput): Promise<SocialOperationResult>;

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
  state: 'published' | 'pending' | 'failed' | 'skipped' | 'manual_assist';
  completedAt: string;
}

/** Pre-Post Script hook result (Fanvue) */
export interface PrePostScriptResult {
  passed: boolean;
  script: string;
  output: string;
  modifiedInput?: Partial<ConnectorPublishInput>;
}
