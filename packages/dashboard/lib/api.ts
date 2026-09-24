// ─── Dashboard server-side API client ───
// Server Components fetch the Hono BFF through the same-origin rewrite
// (/api/* → API_ORIGIN). Cookies are forwarded so Better Auth sessions work.

import { cookies, headers as nextHeaders } from 'next/headers';
import {
  AXIOM_ERROR_RESPONSE_MAX_BYTES,
  readBoundedResponseJson,
  readBoundedResponseText,
  type ScrapeResultView,
  type SupportedLocale,
} from '@axiom/core';
import { createIdempotencyKey } from './mutation';
import { resolveApiOrigin } from './api-origin';
import type { InboxObservation } from './inbox-types';

const API_BASE = resolveApiOrigin();
export interface EarningsObservation {
  connectionId: string;
  currency: 'USD';
  unit: 'cents';
  observedAt: string;
  summary: {
    totals: {
      allTime: { gross: number; net: number };
      thisMonth: { gross: number; net: number; previousMonthGross: number; previousMonthNet: number;
        grossChangePercentage: number | null; netChangePercentage: number | null };
    };
    breakdownBySource: Record<string, { gross: number; net: number }>;
    overTime: Array<{ periodStart: string; gross: number; net: number }>;
    period: { startDate: string | null; endDate: string | null; granularity: 'day' | 'week'; timezone: string };
  };
}
export const DEFAULT_SERVER_REQUEST_TIMEOUT_MS = 10_000;

function createRequestSignal(
  parentSignal: AbortSignal | null | undefined,
  timeoutMs: number,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`server API request timed out after ${timeoutMs}ms`));
  }, timeoutMs);
  const forwardAbort = () => controller.abort(parentSignal?.reason);
  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort(parentSignal.reason);
    } else {
      parentSignal.addEventListener('abort', forwardAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', forwardAbort);
    },
  };
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`API ${status}: ${JSON.stringify(body).slice(0, 200)}`);
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const cookieStore = await cookies();
  const acceptLanguage = path === '/api/v1/ui-locale' ? (await nextHeaders()).get('accept-language') : null;
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');

  const headers = new Headers({
    'content-type': 'application/json',
    ...(cookieHeader ? { cookie: cookieHeader } : {}),
    ...(acceptLanguage ? { 'accept-language': acceptLanguage } : {}),
    ...(init?.headers ?? {}),
  });
  const method = (init?.method ?? 'GET').toUpperCase();
  const isMutation = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  const isApiRequest = path === '/api/v1' || path.startsWith('/api/v1/');
  if (isApiRequest && isMutation && !headers.has('Idempotency-Key')) {
    headers.set('Idempotency-Key', createIdempotencyKey());
  }

  const requestSignal = createRequestSignal(init?.signal, DEFAULT_SERVER_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers,
      cache: 'no-store',
      signal: requestSignal.signal,
    });

    if (!res.ok) {
      const raw = await readBoundedResponseText(
        res,
        AXIOM_ERROR_RESPONSE_MAX_BYTES,
        'dashboard API error response',
      );
      let body: unknown = raw;
      try {
        body = JSON.parse(raw) as unknown;
      } catch {
        // Keep the bounded plain-text body.
      }
      throw new ApiError(res.status, body);
    }
    return await readBoundedResponseJson<T>(res);
  } finally {
    requestSignal.cleanup();
  }
}

export interface ModelProfile {
  id: string;
  orgId: string;
  displayName: string;
  handle: string;
  avatarUrl: string | null;
  bio: string | null;
  characterLockPrompt?: string;
  characterLockVersion?: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ContentBundle {
  captionGuidance?: Record<string, { version: 'caption-guidance-v1'; selectedArm: string | null;
    context: string; exemplarIds: string[]; captionSha256: string; hookType?: string; format?: string;
    postingHourUtc?: number; timingBucket?: 'morning' | 'afternoon' | 'evening' | 'night' }>;
  publishIntent?: { action: 'schedule' | 'publish'; platform: string; scheduledAt: string | null } | null;
  assetId?: string | null;
  id: string;
  orgId: string;
  modelId: string;
  captions: Record<string, string>;
  hashtags: string[];
  tosReport: {
    decisionSource?: string;
    videoScan?: { scanId: string };
    verdict: string;
    revisionId?: string;
    scores: Array<{ platform: string; verdict: string }>;
  } | null;
  state: string;
  createdAt: string;
}

export interface PostTarget {
  id: string;
  bundleId: string;
  platform: string;
  scheduledFor: string | null;
  state: string;
  remoteId: string | null;
  error: string | null;
  providerOptions?: { tiktokDeliveryMode?: 'direct' | 'draft' };
}

export interface ConsentRecord {
  id: string;
  platform: string;
  consentType: string | null;
  granted: boolean;
  grantedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  subjectRef: string;
  docKind: string;
  blobRef: string | null;
  sha256: string | Uint8Array | null;
  documentMimeType?: string | null;
  documentSize?: number | null;
  hasDocument?: boolean;
  validFrom: string;
  validTo: string | null;
}

export interface SocialConnection {
  id: string;
  modelId: string;
  platform: string;
  displayName: string;
  capabilities: string[];
  status: string;
  connectedAt: string;
}

export interface PatreonStatus {
  connection: SocialConnection & { orgId: string };
  counts: { campaigns: number; members: number; posts: number };
  sync: Array<{ resource: string; lastCursor?: string | null; nextCursor: string | null; lastSyncedAt: string | null; lastError: string | null; updatedAt: string }>;
  lastWebhook: { providerEventId: string; eventType: string; receivedAt: string } | null;
  deniedActions: string[];
}

export interface FanContact {
  id: string;
  modelId: string;
  platform: string;
  displayName: string | null;
  tier: string;
  lifetimeValueUsd: string;
  lastActiveAt: string | null;
}

export interface FanvueAnalyticsSnapshot {
  id: string;
  ts: string;
  subscribers: number;
  earningsUsd: string;
  messages: number;
  tips: number;
  tipEarningsUsd: string;
  subscriberEventsNew: number;
  subscriberEventsCancelled: number;
  unreadMessages: number;
  topSpenderCount: number;
  windowStart: string | null;
  windowEnd: string | null;
}

export interface CustomRequest {
  id: string;
  modelId: string;
  title: string;
  status: string;
  priceUsd: string | null;
  createdAt: string;
}

export interface FanTimeline {
  fan: FanContact;
  touchpoints: Array<{ id: string; platform: string; kind: string; direction: string; content: string | null; ts: string }>;
  requests: CustomRequest[];
}

export interface KillSwitchState {
  enabled: boolean;
  reason: string;
  startedAt: string | null;
  updatedAt: string | null;
}

export interface NetworkConfig {
  id?: string;
  modelId: string;
  egressMode: string | null;
  proxyType?: string | null;
  proxyAddr?: string | null;
  wgPublicKey?: string | null;
  wgEndpoint?: string | null;
  wgAllowedIps?: string | null;
  wgPersistentKeepalive?: number | null;
  expectedEgressIp?: string | null;
  failoverProxyAddrs?: string[] | null;
  healthy: boolean;
  lastCheck: string | null;
  latencyMs: number | null;
  lastEgressIp: string | null;
  failCount: number;
  lastError: string | null;
}

export interface RelayBinding {
  id: string;
  modelId: string;
  channel: string;
  chatRef: string | null;
  enabled: boolean;
  createdAt: string;
}

export interface RelayCardHistory {
  id: string;
  bundleId: string | null;
  modelId?: string | null;
  channel: string | null;
  state: string;
  title: string;
  description: string | null;
  icon: string | null;
  enabled: boolean;
  priority: number;
  createdAt: string;
  snapchatHandoff?: {
    instructions: string;
    caption: string;
    assets: string[];
    handoffUrl?: string;
  };
}

export type RelayCardReconciliationOutcome = 'delivered' | 'not_delivered';

export interface AgentTokenMetadata {
  tokenId: string;
  expiresAt: string;
  revokedAt: string | null;
}

export interface AgentPermission {
  id: string;
  modelId: string;
  agentRef: string;
  tier: 'viewer' | 'operator' | 'manager' | 'autonomous' | string;
  canPublish: boolean;
  canEdit: boolean;
  createdAt: string;
  updatedAt: string;
  tokens: AgentTokenMetadata[];
}

export interface CascadeStep { platform: string; offsetMinutes: number }
export interface CascadeTemplate {
  id: string;
  modelId: string;
  name: string;
  steps: CascadeStep[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TriggerCondition {
  metric: 'views' | 'likes' | 'comments' | 'shares' | 'engagementRate';
  thresholdMode?: 'fixed' | 'learned_p90';
  threshold?: number;
  minimumSamples?: number;
  windowMinutes?: number;
}

export interface TriggerAction {
  type: 'content.generate' | 'relay.card';
  prompt?: string;
  style?: string;
  outfit?: string;
  location?: string;
  mood?: string;
  lighting?: string;
  aspectRatio?: '1:1' | '4:5' | '9:16' | '16:9';
  cooldownMinutes?: number;
}

export interface TriggerRule {
  id: string;
  modelId: string;
  name: string;
  platform: string;
  condition: TriggerCondition;
  action: TriggerAction;
  enabled: boolean;
  lastFiredAt: string | null;
  createdAt: string;
}

export interface VariantExperimentStat {
  variantId: string;
  exposures: number;
  outcomes: number;
  conversions?: number;
  metricTotal: number;
}

export interface VariantExperiment {
  id: string;
  modelId: string;
  name: string;
  platform: string;
  variantIds: string[];
  status: 'draft' | 'running' | 'paused' | 'completed' | string;
  winnerVariantId: string | null;
  evaluationPolicy?: 'manual' | 'fixed-post-engagement-v1';
  evaluation?: Record<string, unknown> | null;
  stats: VariantExperimentStat[];
  createdAt: string;
  updatedAt: string;
}

export interface VariantGuidanceSummary {
  guidanceReceiptId: string;
  sourceBundleId: string;
  sourceVariantId: string | null;
  platform: string;
  selectedArm: string | null;
  context: string;
  hookType?: string;
  format?: string;
  postingHourUtc?: number;
  timingBucket?: 'morning' | 'afternoon' | 'evening' | 'night';
}

export interface VariantGuidanceAttribution {
  guidanceReceiptId: string;
  variantIds: string[];
  exposures: number;
  conversions: number;
  averageMetric?: number;
}

export interface VariantGuidanceSource {
  id: string;
  sourceVariantId: string | null;
  platform: string;
  caption: string;
  guidance: VariantGuidanceSummary;
}

export interface VariantCandidate { id: string; variantType: string; outputAssetId: string | null; createdAt: string; copy?: { platform: string; text: string } | null; guidance?: VariantGuidanceSummary | null }

export interface ScrapeRun {
  id: string;
  modelId: string;
  kind: 'social' | 'competitor' | string;
  result: ScrapeResultView | null;
  state: 'queued' | 'running' | 'completed' | 'failed' | string;
  error: 'unavailable' | null;
  createdAt: string;
  completedAt: string | null;
}
export interface ScrapeCompetitorBenchmark {
  platform: string | null;
  displayName: string | null;
  profileUrl: string;
  observations: number;
  lastObservedAt: string;
  followers: number | null;
  followerChange: number | null;
  followerChangePerDay: number | null;
  posts: number | null;
  postChange: number | null;
  postsPerDay: number | null;
  measuredDays: number | null;
  history: Array<{ observedAt: string; followers: number | null; posts: number | null }>;
}

export interface TeamMember { id: string; email: string; role: string }
export interface TeamShift { id: string; modelId: string; assigneeUserId: string | null; assigneeType: 'human' | 'llm'; assigneeAgentRef: string | null; queue: string; startsAt: string; endsAt: string; status: string; note: string | null }
export interface TeamNote { id: string; modelId: string; authorUserId: string; targetType: string; targetId: string | null; body: string; createdAt: string }
export interface TeamAgentPermission { id: string; agentRef: string; tier: string; canEdit: boolean; canPublish: boolean }
export interface RoleplayActor { type: 'human' | 'llm'; ref: string }
export interface RoleplayMemoryTurn { sequence: number; role: 'user' | 'assistant'; speaker: RoleplayActor; content: string }
export interface RoleplayPersona { revision: number; source: 'soul.md' | 'model_profile' | 'playbook'; sourceRef: string; content: string }
export interface RoleplayHandoff { currentOwner: RoleplayActor; actor: RoleplayActor; orgId: string; modelId: string; shiftId: string; queue: string; conversationCursor: string | null; lastSafeSummary: string; pendingIntentId: string | null; memoryPolicy: { maxTurns: number; maxCharacters: number }; personaSource: { orgId: string; modelId: string; source: RoleplayPersona['source']; revision: number; sourceRef: string } | null; allowedNextAction: string; terminal: boolean; unresolvedUncertainty: string | null; evidenceReferences: string[] }
export interface RoleplayTurnResult { turnId: string; state: 'pending' | 'completed' | 'uncertain' | 'rejected'; provider: string; providerModel: string; content: string | null; providerRequestId: string | null; errorCode: string | null }
export interface RoleplayTurnReceipt extends RoleplayTurnResult { input: string; createdAt: string; finalizedAt: string | null }
export interface MediaOperation { id: string; modelId: string; sourceAssetId: string; resultVariantId: string | null; outputAssetId?: string | null; type: string; options: Record<string, unknown>; state: string; error: string | null; createdAt: string; completedAt: string | null }
export type MediaOrigin = 'uploaded' | 'generated' | 'transformed' | 'legacy';
export type MediaKind = 'image' | 'video';
export interface PlaybookGuideline { id: string; modelId: string; platform: string; optimalTimes: string[]; cadencePerWeek: number; upsellStrategy: string; revision: number; updatedAt: string }
export interface CacheControlView { provider: string; enabled: boolean; prefixAlignment: boolean; promptCacheKey: string | null }
export interface WatermarkPolicyView { enabled: boolean; watermarkKey: string | null; position: string; opacity: number; scale: number }

export interface AffiliateProgram {
  id: string;
  slug: string;
  name: string;
  status: 'active' | 'paused' | 'ended' | string;
  termsVersion: string;
  defaultCommissionBps: number;
  createdAt: string;
  updatedAt: string;
}
export interface AffiliatePartner {
  id: string;
  programId: string;
  displayName: string;
  email: string;
  status: 'invited' | 'active' | 'suspended' | 'revoked' | string;
  termsVersion: string | null;
  disclosureAcceptedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface AffiliateCampaign {
  id: string;
  programId: string;
  partnerId: string;
  name: string;
  slug: string;
  referralToken: string;
  status: 'draft' | 'active' | 'paused' | 'ended' | string;
  commissionBps: number;
  createdAt: string;
  updatedAt: string;
}
export interface AffiliateHold {
  id: string;
  programId: string;
  partnerId: string;
  commissionId: string | null;
  reason: 'fraud_suspected' | 'chargeback' | 'self_referral' | 'terms_violation' | string;
  state: 'open' | 'resolved' | string;
  resolvedByUserId: string | null;
  createdAt: string;
  resolvedAt: string | null;
}
export interface AffiliateSummary {
  partners: number;
  campaigns: number;
  attributionEvents: number;
  conversions: number;
  accruedCents: number;
  reversedCents: number;
  openHolds: number;
}
export interface AffiliateProgramSnapshot {
  program: AffiliateProgram;
  billingWebhook: { configured: boolean; endpoint: string; signatureHeader: string };
  partners: AffiliatePartner[];
  campaigns: AffiliateCampaign[];
  holds: AffiliateHold[];
  summary: AffiliateSummary;
}
export interface AffiliateCampaignReport {
  campaign: Pick<AffiliateCampaign, 'id' | 'name' | 'slug' | 'status' | 'commissionBps' | 'referralToken'>;
  attribution: { clicks: number; visits: number; identityStitches: number };
  conversions: number;
  commissions: { accruedCents: number; reversedCents: number; exportableCents: number; openHold: boolean };
}

export interface UiLocaleSnapshot {
  locale: SupportedLocale;
  source: 'user' | 'org' | 'accept-language' | 'default';
  userLocale: SupportedLocale | null;
  orgLocale: SupportedLocale | null;
  supportedLocales: SupportedLocale[];
  canSetOrg: boolean;
}

export interface LlmProviderCapability {
  provider: string;
  available: boolean;
  transport: 'local' | 'user-subscription' | 'unsupported';
  auth: 'oauth' | 'none' | null;
  operatorApiCost: false;
  reason: string | null;
}

export const api = {
  health: {
    liveness: () => apiFetch<{ status: 'ok'; version: string }>('/api/v1/health'),
    readiness: () => apiFetch<{
      status: 'ok' | 'unavailable';
      dependencies: { postgres: 'ok' | 'unavailable' };
    }>('/api/v1/ready'),
  },
  myShifts: (cursor?: string) => apiFetch<{ data: Array<Omit<TeamShift, 'assigneeUserId'> & { modelName: string }>; meta: { next_cursor: string | null } }>(`/api/v1/my-shifts${cursor ? `?${new URLSearchParams({ cursor })}` : ''}`),
  fans: {
    get: (id: string) => apiFetch<{ data: FanTimeline }>(`/api/v1/fans/${encodeURIComponent(id)}`),
  },
  models: {
    media: (id: string, cursor?: string, filters?: { origin?: MediaOrigin; kind?: MediaKind }) => {
      const query = new URLSearchParams();
      if (cursor) query.set('cursor', cursor);
      if (filters?.origin) query.set('origin', filters.origin);
      if (filters?.kind) query.set('kind', filters.kind);
      const suffix = query.toString();
      return apiFetch<{ data: Array<{
        id: string;
        kind: string;
        origin: string;
        mimeType: string;
        fileSize: number;
        width: number | null;
        height: number | null;
        createdAt: string;
        status: 'queued' | 'running' | 'failed' | 'completed' | 'unknown' | string;
        operationId?: string;
        sourceAssetId?: string;
        resultAssetIds: string[];
      }>; meta?: { next_cursor?: string | null } }>(`/api/v1/models/${encodeURIComponent(id)}/media${suffix ? `?${suffix}` : ''}`);
    },
    list: (cursor?: string) => apiFetch<{
      data: ModelProfile[];
      meta: { total: number; limit: number; next_cursor: string | null };
    }>(`/api/v1/models${cursor ? `?${new URLSearchParams({ cursor })}` : ''}`),
    count: () => apiFetch<{ data: { count: number } }>('/api/v1/models/stats/count'),
    get: (id: string) => apiFetch<{ data: ModelProfile }>(`/api/v1/models/${id}`),
    create: (body: { displayName: string; handle: string; bio?: string }) =>
      apiFetch<{ data: ModelProfile }>('/api/v1/models', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    network: (id: string) => apiFetch<{ data: NetworkConfig }>(`/api/v1/models/${id}/network`),
    networkHealth: (id: string) =>
      apiFetch<{ data: { modelId: string; live: unknown; db: NetworkConfig } }>(
        `/api/v1/models/${id}/network/health`,
      ),
    calendar: (id: string, from?: string, to?: string) =>
      apiFetch<{ data: PostTarget[] }>(
        `/api/v1/models/${id}/calendar${from || to ? `?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) })}` : ''}`,
      ),
    fans: (id: string, cursor?: string) => apiFetch<{ data: FanContact[]; meta?: { next_cursor: string | null } }>(`/api/v1/models/${id}/fans${cursor ? `?${new URLSearchParams({ cursor })}` : ''}`),
    customRequests: (id: string) =>
      apiFetch<{ data: CustomRequest[] }>(`/api/v1/models/${id}/custom-requests`),
    analytics: (id: string, days = 30) =>
      apiFetch<{ data: unknown }>(`/api/v1/models/${id}/analytics?days=${days}`),
    earningsAccounts: (id: string) => apiFetch<{ data: { accounts: Array<{ id: string; displayName: string }> } }>(
      `/api/v1/models/${encodeURIComponent(id)}/earnings`),
    inboxAccounts: (id: string) => apiFetch<{ data: { accounts: Array<{ id: string; displayName: string }> } }>(
      `/api/v1/models/${encodeURIComponent(id)}/inbox`),
    inbox: (id: string, connectionId: string, page: number, userUuid?: string) => apiFetch<{ data: InboxObservation }>(
      `/api/v1/models/${encodeURIComponent(id)}/inbox?${new URLSearchParams({ connectionId, page: String(page), ...(userUuid ? { userUuid } : {}) })}`),
    earnings: (id: string, connectionId: string) => apiFetch<{ data: EarningsObservation }>(
      `/api/v1/models/${encodeURIComponent(id)}/earnings?${new URLSearchParams({ connectionId })}`),
    fanvueAnalytics: (id: string) => apiFetch<{ data: { metric: FanvueAnalyticsSnapshot | null; contacts: FanContact[] } }>(
      `/api/v1/models/${encodeURIComponent(id)}/fanvue/analytics`),
    fanvueChurnRescues: (id: string) => apiFetch<{
      data: Array<{ id: string; subscriptionId: string; status: string; sentAt: string | null; remoteMessageId: string | null; createdAt: string }>;
      setup: { webhookConfigured: boolean; endpoints: string[] };
    }>(`/api/v1/models/${encodeURIComponent(id)}/fanvue/churn-rescues`),
    syncFanvueAnalytics: (id: string, connectionId?: string) => apiFetch<{ data: { jobId: string | null; deduplicated: boolean } }>(
      `/api/v1/models/${encodeURIComponent(id)}/fanvue/analytics/sync`, {
        method: 'POST',
        body: JSON.stringify(connectionId ? { connectionId } : {}),
      }),
    viral: (id: string) => apiFetch<{ data: unknown }>(`/api/v1/models/${id}/viral`),
    viralInsightSchedule: (id: string) => apiFetch<{ data: { enabled: boolean; scheduleId: string | null } }>(
      `/api/v1/models/${encodeURIComponent(id)}/viral/insight-schedule`),
    viralPatternSharing: (id: string) => apiFetch<{ data: { enabled: boolean } }>(
      `/api/v1/models/${encodeURIComponent(id)}/viral/pattern-sharing`),
    enqueueViralInsight: (id: string) =>
      apiFetch<{ success: boolean; jobId: string; windowKey: string }>(
        `/api/v1/models/${encodeURIComponent(id)}/viral/insight`,
        { method: 'POST' },
      ),
    playbookScore: (id: string) =>
      apiFetch<{ data: unknown }>(`/api/v1/models/${id}/playbook-score`),
    consentRecords: (id: string) => apiFetch<{ data: ConsentRecord[]; meta?: { total: number } }>(`/api/v1/models/${id}/consent-records`),
    generate: (id: string, body: Record<string, unknown>) =>
      apiFetch<{ data: { bundle: ContentBundle; variants: unknown[]; tosReport: unknown } }>(
        `/api/v1/models/${id}/generate`,
        { method: 'POST', body: JSON.stringify(body) },
      ),
    linkbio: (id: string) => apiFetch<{ data: unknown }>(`/api/v1/models/${id}/linkbio`),
    linkbioAnalytics: (id: string) =>
      apiFetch<{ data: unknown }>(`/api/v1/models/${id}/linkbio/analytics`),
    linkbioAttribution: (id: string) =>
      apiFetch<{ data: unknown }>(`/api/v1/models/${id}/linkbio/attribution`),
    linkbioPostLinks: (id: string) =>
      apiFetch<{ data: {
        publishedPosts: Array<{ id: string; platform: string; publishedAt: string | null; caption: string }>;
        links: Array<{ id: string; slug: string; targetUrl: string; postTargetId: string; clicks: number; createdAt: string; path: string }>;
      } }>(`/api/v1/models/${id}/linkbio/post-links`),
    recordLinkbioCampaignCost: (id: string, body: {
      eventKey: string;
      shortLinkId: string;
      amountCents: number;
      currency: string;
      occurredAt: string;
    }) => apiFetch<{ data: unknown; duplicate: boolean }>(`/api/v1/models/${id}/linkbio/campaign-costs`, {
      method: 'POST', body: JSON.stringify(body),
    }),
    relayBindings: (id: string) =>
      apiFetch<{ data: RelayBinding[]; meta?: { total: number } }>(`/api/v1/models/${id}/relay-bindings`),
    relayCards: (id: string, cursor?: string) => {
      const query = cursor
        ? `?limit=20&cursor=${encodeURIComponent(cursor)}`
        : '?limit=20';
      return apiFetch<{ data: RelayCardHistory[]; meta: { total: number; limit: number; next_cursor: string | null } }>(
        `/api/v1/models/${id}/relay-cards${query}`,
      );
    },
    reconcileRelayCard: (modelId: string, cardId: string, outcome: RelayCardReconciliationOutcome) =>
      apiFetch<{ data: RelayCardHistory; meta: { idempotent: boolean; outcome: RelayCardReconciliationOutcome } }>(
        `/api/v1/models/${encodeURIComponent(modelId)}/relay-cards/${encodeURIComponent(cardId)}/reconcile`,
        { method: 'POST', body: JSON.stringify({ outcome }) },
      ),
    agentPermissions: (id: string) =>
      apiFetch<{ data: AgentPermission[] }>(`/api/v1/models/${id}/agent-permissions`),
    cascadeTemplates: (id: string) =>
      apiFetch<{ data: CascadeTemplate[] }>(`/api/v1/models/${id}/cascade-templates`),
    triggerRules: (id: string) =>
      apiFetch<{ data: TriggerRule[] }>(`/api/v1/models/${id}/trigger-rules`),
    variantExperiments: (id: string) =>
      apiFetch<{ data: VariantExperiment[] }>(`/api/v1/models/${id}/variant-experiments`),
    variantCandidates: (id: string, cursor?: string) =>
      apiFetch<{ data: VariantCandidate[]; meta: { next_cursor: string | null } }>(`/api/v1/models/${encodeURIComponent(id)}/variant-experiments/candidates${cursor ? `?${new URLSearchParams({ cursor })}` : ''}`),
    variantGuidanceSources: (id: string, assetId: string, platform: string) =>
      apiFetch<{ data: VariantGuidanceSource[] }>(`/api/v1/models/${encodeURIComponent(id)}/variant-experiments/guidance-sources?${new URLSearchParams({ assetId, platform })}`),
    scrapeRuns: (id: string, cursor?: string) =>
      apiFetch<{ data: ScrapeRun[]; meta: { next_cursor: string | null; competitor_benchmark: ScrapeCompetitorBenchmark[] } }>(`/api/v1/models/${encodeURIComponent(id)}/scrape-runs${cursor ? `?${new URLSearchParams({ cursor })}` : ''}`),
    teamOperations: (id: string, cursors: { shiftCursor?: string; noteCursor?: string } = {}) => {
      const query = new URLSearchParams({
        ...(cursors.shiftCursor ? { shiftCursor: cursors.shiftCursor } : {}),
        ...(cursors.noteCursor ? { noteCursor: cursors.noteCursor } : {}),
      }).toString();
      return apiFetch<{ data: {
        members: TeamMember[];
        shifts: TeamShift[];
        shiftsMeta: { next_cursor: string | null };
        notes: TeamNote[];
        notesMeta: { next_cursor: string | null };
        agentPermissions: TeamAgentPermission[];
      } }>(`/api/v1/models/${id}/team-operations${query ? `?${query}` : ''}`);
    },
    roleplay: (id: string, conversationKey = 'default', actor?: RoleplayActor) => {
      const query = new URLSearchParams({ conversationKey, ...(actor ? { actorType: actor.type, actorRef: actor.ref } : {}) });
      return apiFetch<{ data: { handoff: RoleplayHandoff | null; handoffRevision: number; persona: RoleplayPersona | null; memory: RoleplayMemoryTurn[]; meta: { nextSequence: number; activeShiftId: string; queue: string; actor: RoleplayActor } } }>(`/api/v1/models/${encodeURIComponent(id)}/roleplay?${query}`);
    },
    saveRoleplayHandoff: (id: string, body: { conversationKey: string; expectedRevision: number; handoff: RoleplayHandoff }) =>
      apiFetch<{ data: { revision: number; handoff: RoleplayHandoff } }>(`/api/v1/models/${encodeURIComponent(id)}/roleplay/handoff`, { method: 'PUT', body: JSON.stringify(body) }),
    saveRoleplayPersona: (id: string, body: { expectedRevision: number; sourceRef?: string; content: string }) =>
      apiFetch<{ data: RoleplayPersona }>(`/api/v1/models/${encodeURIComponent(id)}/roleplay/persona`, { method: 'PUT', body: JSON.stringify(body) }),
    appendRoleplayMemory: (id: string, body: { conversationKey: string; sequence: number; role: 'user' | 'assistant'; speaker: RoleplayActor; content: string }) =>
      apiFetch<{ data: RoleplayMemoryTurn }>(`/api/v1/models/${encodeURIComponent(id)}/roleplay/memory`, { method: 'POST', body: JSON.stringify(body) }),
    mediaOperations: (id: string) =>
      apiFetch<{ data: MediaOperation[] }>(`/api/v1/models/${id}/media-operations`),
    playbookGuidelines: (id: string) =>
      apiFetch<{ data: PlaybookGuideline[] }>(`/api/v1/models/${id}/playbook-guidelines`),
  },
  cacheControls: {
    get: (modelId: string) => apiFetch<{ data: { modelId: string; controls: CacheControlView[] } }>(
      `/api/v1/models/${encodeURIComponent(modelId)}/cache-controls`,
    ),
  },
  watermarkPolicy: {
    get: (modelId: string) => apiFetch<{ data: { modelId: string; policy: WatermarkPolicyView } }>(
      `/api/v1/models/${encodeURIComponent(modelId)}/watermark-policy`,
    ),
  },
  bundles: {
    list: (modelId?: string, state?: string, cursor?: string) =>
      apiFetch<{ data: ContentBundle[]; meta: { next_cursor: string | null } }>(
        `/api/v1/bundles${modelId || state || cursor ? `?${new URLSearchParams({ ...(modelId ? { modelId } : {}), ...(state ? { state } : {}), ...(cursor ? { cursor } : {}) })}` : ''}`,
      ),
    get: (id: string) => apiFetch<{ data: ContentBundle }>(`/api/v1/bundles/${id}`),
    approve: (
      id: string,
      body: {
        platforms: string[];
        slot?: string;
        connectionIds?: Record<string, string>;
        revisionId?: string;
      },
    ) =>
      apiFetch<{ data: ContentBundle }>(`/api/v1/bundles/${id}/approve`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    revise: (id: string, instructions: string, revisionId?: string) =>
      apiFetch<{ data: ContentBundle }>(`/api/v1/bundles/${id}/revise`, {
        method: 'POST',
        body: JSON.stringify({ instructions, revisionId }),
      }),
    reject: (id: string, revisionId?: string) =>
      apiFetch<{ data: ContentBundle }>(`/api/v1/bundles/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ revisionId }),
      }),
  },
  killswitch: {
    get: () => apiFetch<{ data: KillSwitchState }>('/api/v1/killswitch'),
    enable: (reason?: string) =>
      apiFetch<{ data: KillSwitchState & Record<string, unknown> }>('/api/v1/killswitch/enable', {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }),
    disable: () =>
      apiFetch<{ data: KillSwitchState & Record<string, unknown> }>('/api/v1/killswitch/disable', {
        method: 'POST',
      }),
  },
  audit: {
    list: () => apiFetch<{ data: Array<Record<string, unknown>> }>('/api/v1/audit'),
    verify: () =>
      apiFetch<{ data: { rows: number; valid: boolean; brokenAt?: string } }>(
        '/api/v1/audit/verify',
      ),
  },
  incidents: {
    crashes: (status: string, cursor?: string) => apiFetch<{ data: Array<{ id: string; service: string; message: string; severity: string; status: string; count: number; lastSeen: string }>; meta?: { next_cursor?: string | null } }>(`/api/v1/crash-reports?${new URLSearchParams({ status, ...(cursor ? { cursor } : {}) })}`),
    list: (cursor?: string) => apiFetch<{ data: Array<Record<string, unknown>>; meta?: { next_cursor?: string | null } }>(`/api/v1/incidents${cursor ? `?${new URLSearchParams({ cursor })}` : ''}`),
    replay: (jobId: string) =>
      apiFetch<{ success: boolean }>(`/api/v1/incidents/${jobId}/replay`, { method: 'POST' }),
    discard: (jobId: string) =>
      apiFetch<{ success: boolean }>(`/api/v1/incidents/${jobId}/discard`, { method: 'POST' }),
  },
  social: {
    list: (modelId: string) =>
      apiFetch<{ data: SocialConnection[] }>(`/api/v1/social-accounts?modelId=${modelId}`),
    refreshOAuth: (platform: 'tiktok' | 'x' | 'youtube' | 'reddit', connectionId: string) =>
      apiFetch<{ status: string; platform: string; refreshed: boolean }>(
        `/api/v1/connectors/${platform}/refresh?connectionId=${encodeURIComponent(connectionId)}`,
        { method: 'POST' },
      ),
    operate: (modelId: string, connectionId: string, operation: Record<string, unknown>) =>
      apiFetch<{ data: Record<string, unknown> }>(
        `/api/v1/models/${encodeURIComponent(modelId)}/social-accounts/${encodeURIComponent(connectionId)}/operations`,
        { method: 'POST', body: JSON.stringify(operation) },
      ),
    connectTelegram: (body: { modelId: string; botToken: string; channelId: string }) =>
      apiFetch<{ status: string; platform: 'telegram'; connectionId: string; displayName: string; botUsername: string }>(
        '/api/v1/connectors/telegram/manual',
        { method: 'POST', body: JSON.stringify(body) },
      ),
    connectDiscordBot: (body: { modelId: string; botToken: string; channelId: string }) =>
      apiFetch<{ status: string; platform: 'discord'; mode: 'bot'; connectionId: string; displayName: string | null; botUsername: string; grantedOperations: string[] }>(
        '/api/v1/connectors/discord/manual',
        { method: 'POST', body: JSON.stringify(body) },
      ),
  },
  patreon: {
    status: (connectionId: string) => apiFetch<{ data: PatreonStatus }>(`/api/v1/connectors/patreon/status?connectionId=${encodeURIComponent(connectionId)}`),
    data: (connectionId: string, resource: 'campaign' | 'members' | 'posts') => apiFetch<{ data: Array<Record<string, unknown>> }>(`/api/v1/connectors/patreon/data?${new URLSearchParams({ connectionId, resource })}`),
    sync: (connectionId: string, resource: 'campaign' | 'members' | 'posts', cursor?: string) => apiFetch<{ data: { resource: string; count: number; nextCursor: string | null } }>(`/api/v1/connectors/patreon/sync?connectionId=${encodeURIComponent(connectionId)}`, { method: 'POST', body: JSON.stringify({ resource, ...(cursor ? { cursor } : {}) }) }),
  },
  llm: {
    providers: () => apiFetch<{ providers: string[]; capabilities: LlmProviderCapability[] }>('/api/v1/llm/providers'),
  },
  orgSettings: {
    get: () => apiFetch<{ data: { viralSharing: boolean; publishingEnabled: boolean; weeklyDigestEnabled: boolean; weeklyDigestScheduleId: string | null } }>('/api/v1/org-settings'),
  },
  uiLocale: {
    get: () => apiFetch<{ data: UiLocaleSnapshot }>('/api/v1/ui-locale'),
    set: (scope: 'user' | 'org', locale: SupportedLocale) =>
      apiFetch<{ data: UiLocaleSnapshot }>('/api/v1/ui-locale', {
        method: 'PATCH',
        body: JSON.stringify({ scope, locale }),
      }),
  },
  platformAffiliate: {
    getProgram: () => apiFetch<{ data: AffiliateProgramSnapshot }>('/api/v1/platform/affiliate/program'),
    createPartner: (body: { displayName: string; email: string; termsVersion: string; status: 'invited' | 'active'; disclosureAccepted: boolean }) =>
      apiFetch<{ data: AffiliatePartner }>('/api/v1/platform/affiliate/partners', { method: 'POST', body: JSON.stringify(body) }),
    updatePartner: (partnerId: string, body: { displayName?: string; email?: string; termsVersion?: string; status?: AffiliatePartner['status']; disclosureAccepted?: boolean }) =>
      apiFetch<{ data: AffiliatePartner }>(`/api/v1/platform/affiliate/partners/${encodeURIComponent(partnerId)}`, { method: 'PATCH', body: JSON.stringify(body) }),
    createCampaign: (body: { partnerId: string; name: string; slug: string; status: 'draft' | 'active'; commissionBps?: number }) =>
      apiFetch<{ data: AffiliateCampaign }>('/api/v1/platform/affiliate/campaigns', { method: 'POST', body: JSON.stringify(body) }),
    campaignReport: (campaignId: string) => apiFetch<{ data: AffiliateCampaignReport }>(`/api/v1/platform/affiliate/campaigns/${encodeURIComponent(campaignId)}/report`),
    resolveHold: (holdId: string, resolution: 'released' | 'upheld') =>
      apiFetch<{ data: AffiliateHold; resolution: string }>(`/api/v1/platform/affiliate/holds/${encodeURIComponent(holdId)}/resolve`, { method: 'POST', body: JSON.stringify({ resolution }) }),
  },
  digests: {
    list: (cursor?: string) => apiFetch<{ data: Array<{ id: string; title: string; description: string | null; state: string; externalDelivery?: 'not-attempted' | 'attempted' | 'unknown'; createdAt: string; config: Record<string, unknown> | null }>; schedule?: { enabled: boolean; workspacePermitted: boolean; latest: { state: string; runAfter: string; attempts: number } | null } | null; meta?: { next_cursor?: string | null } }>(`/api/v1/digests${cursor ? `?${new URLSearchParams({ cursor })}` : ''}`),
  },
};

/** Resolve the Better Auth session server-side (for layout redirects). */
export async function getSession() {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  const requestSignal = createRequestSignal(undefined, DEFAULT_SERVER_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}/api/auth/get-session`, {
      headers: cookieHeader ? { cookie: cookieHeader } : {},
      cache: 'no-store',
      signal: requestSignal.signal,
    });
    if (!res.ok) return null;
    const body = await readBoundedResponseJson<{
      user?: { id: string; name?: string | null; email?: string; orgId?: string | null; role?: string };
    } | null>(res);
    return body?.user ? body : null;
  } catch {
    return null;
  } finally {
    requestSignal.cleanup();
  }
}
