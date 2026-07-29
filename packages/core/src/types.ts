// ─── Domain Types for AXIOM FanvueCRM ───

export type Platform =
  | 'instagram'
  | 'tiktok'
  | 'x'
  | 'youtube'
  | 'reddit'
  | 'threads'
  | 'discord'
  | 'telegram'
  | 'facebook'
  | 'snapchat'
  | 'fanvue';

export type PublishMode = 'api' | 'assisted' | 'link_share';

export type UserRole = 'owner' | 'manager' | 'operator' | 'analyst' | 'agent';

export type Capability =
  | 'publish'
  | 'read_analytics'
  | 'manage_content'
  | 'manage_connections'
  | 'view_profile'
  | 'edit_profile';

export interface SocialConnector {
  id: string;
  platform: Platform;
  displayName: string;
  avatarUrl: string | null;
  capabilities: Capability[];
  connectedAt: string;
  status: 'active' | 'expired' | 'revoked';
}

export interface PublishInput {
  targetPlatforms: Platform[];
  captions: Record<string, string>;
  hashtags: string[];
  mediaUrls: string[];
  scheduledFor?: string;
  mode: PublishMode;
}

export interface PublishResult {
  id: string;
  bundleId: string;
  results: Array<{
    platform: Platform;
    remoteId: string | null;
    state: 'published' | 'failed' | 'skipped';
    error?: string;
  }>;
  publishedAt: string;
}

export type ContentBundleState =
  | 'generated'
  | 'approved'
  | 'rejected'
  | 'scheduled'
  | 'publishing'
  | 'published'
  | 'failed';

export type PostTargetState = 'pending' | 'publishing' | 'published' | 'failed' | 'skipped';

export type JobState = 'ready' | 'running' | 'done' | 'dead';

export type ViralLabel = 'viral' | 'strong' | 'baseline' | 'weak';

export interface ModelProfile {
  id: string;
  orgId: string;
  displayName: string;
  handle: string;
  avatarUrl: string | null;
  bio: string | null;
}

export interface PlatformConnection {
  id: string;
  orgId: string;
  modelId: string;
  platform: Platform;
  displayName: string;
  status: 'active' | 'expired' | 'revoked';
  capabilities: Capability[];
  connectedAt: string;
}

export interface ContentBundle {
  id: string;
  orgId: string;
  modelId: string;
  assetIds: string[];
  captions: Record<string, string>;
  hashtags: string[];
  tosReport: Record<string, unknown> | null;
  state: ContentBundleState;
  createdAt: string;
}

export interface PostTarget {
  id: string;
  orgId: string;
  bundleId: string;
  platform: Platform;
  connectionId: string;
  scheduledFor: string | null;
  state: PostTargetState;
  remoteId: string | null;
  error: string | null;
}

export interface RelayCard {
  id: string;
  orgId: string;
  title: string;
  description: string | null;
  icon: string | null;
  config: Record<string, unknown>;
  enabled: boolean;
  priority: number;
}

export interface RelayCommand {
  id: string;
  orgId: string;
  cardId: string;
  trigger: string;
  action: string;
  params: Record<string, unknown>;
  enabled: boolean;
}

export interface ViralExemplar {
  id: string;
  orgId: string;
  platform: Platform;
  title: string;
  url: string;
  thumbnailUrl: string | null;
  viralLabel: ViralLabel;
  metrics: {
    views: number;
    likes: number;
    shares: number;
    comments: number;
  };
  aiNotes: string | null;
  createdAt: string;
}

export interface PostMetric {
  id: string;
  postTargetId: string;
  platform: Platform;
  remoteId: string;
  views: number;
  likes: number;
  shares: number;
  comments: number;
  engagementRate: number;
  collectedAt: string;
}

// ─── Relay Types ───

export interface RelayEvent {
  id: string;
  cardId: string;
  trigger: string;
  payload: Record<string, unknown>;
  context: Record<string, unknown>;
}
