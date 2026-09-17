// ─── Dashboard server-side API client ───
// Server Components fetch the Hono BFF through the same-origin rewrite
// (/api/* → API_ORIGIN). Cookies are forwarded so Better Auth sessions work.

import { cookies } from 'next/headers';
import {
  AXIOM_ERROR_RESPONSE_MAX_BYTES,
  readBoundedResponseJson,
  readBoundedResponseText,
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
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');

  const headers = new Headers({
    'content-type': 'application/json',
    ...(cookieHeader ? { cookie: cookieHeader } : {}),
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
    context: string; exemplarIds: string[]; captionSha256: string }>;
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
  blobRef: string;
  sha256: string | Uint8Array;
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

export interface FanContact {
  id: string;
  modelId: string;
  platform: string;
  displayName: string | null;
  tier: string;
  lifetimeValueUsd: string;
  lastActiveAt: string | null;
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
  threshold: number;
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

export interface VariantCandidate { id: string; variantType: string; outputAssetId: string | null; createdAt: string; copy?: { platform: string; text: string } | null }

export interface ScrapeRun {
  id: string;
  modelId: string;
  kind: 'social' | 'competitor' | string;
  request: Record<string, unknown>;
  result: Record<string, unknown> | null;
  state: 'queued' | 'running' | 'completed' | 'failed' | string;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface TeamMember { id: string; email: string; role: string }
export interface TeamShift { id: string; modelId: string; assigneeUserId: string; queue: string; startsAt: string; endsAt: string; status: string; note: string | null }
export interface TeamNote { id: string; modelId: string; authorUserId: string; targetType: string; targetId: string | null; body: string; createdAt: string }
export interface MediaOperation { id: string; modelId: string; sourceAssetId: string; resultVariantId: string | null; outputAssetId?: string | null; type: string; options: Record<string, unknown>; state: string; error: string | null; createdAt: string; completedAt: string | null }
export interface PlaybookGuideline { id: string; modelId: string; platform: string; optimalTimes: string[]; cadencePerWeek: number; upsellStrategy: string; revision: number; updatedAt: string }

export const api = {
  myShifts: (cursor?: string) => apiFetch<{ data: Array<Omit<TeamShift, 'assigneeUserId'> & { modelName: string }>; meta: { next_cursor: string | null } }>(`/api/v1/my-shifts${cursor ? `?${new URLSearchParams({ cursor })}` : ''}`),
  fans: {
    get: (id: string) => apiFetch<{ data: FanTimeline }>(`/api/v1/fans/${encodeURIComponent(id)}`),
  },
  models: {
    media: (id: string, cursor?: string) => apiFetch<{ data: Array<{ id: string; kind: string; origin: string; mimeType: string; fileSize: number; width: number | null; height: number | null; createdAt: string }>; meta?: { next_cursor?: string | null } }>(`/api/v1/models/${encodeURIComponent(id)}/media${cursor ? `?${new URLSearchParams({ cursor })}` : ''}`),
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
    viral: (id: string) => apiFetch<{ data: unknown }>(`/api/v1/models/${id}/viral`),
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
    relayBindings: (id: string) =>
      apiFetch<{ data: RelayBinding[]; meta?: { total: number } }>(`/api/v1/models/${id}/relay-bindings`),
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
    scrapeRuns: (id: string) =>
      apiFetch<{ data: ScrapeRun[] }>(`/api/v1/models/${id}/scrape-runs`),
    teamOperations: (id: string) =>
      apiFetch<{ data: { members: TeamMember[]; shifts: TeamShift[]; notes: TeamNote[] } }>(`/api/v1/models/${id}/team-operations`),
    mediaOperations: (id: string) =>
      apiFetch<{ data: MediaOperation[] }>(`/api/v1/models/${id}/media-operations`),
    playbookGuidelines: (id: string) =>
      apiFetch<{ data: PlaybookGuideline[] }>(`/api/v1/models/${id}/playbook-guidelines`),
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
  },
  social: {
    list: (modelId: string) =>
      apiFetch<{ data: SocialConnection[] }>(`/api/v1/social-accounts?modelId=${modelId}`),
  },
  llm: {
    providers: () => apiFetch<{ providers: string[] }>('/api/v1/llm/providers'),
  },
  orgSettings: {
    get: () => apiFetch<{ data: { viralSharing: boolean; publishingEnabled: boolean; weeklyDigestEnabled: boolean } }>('/api/v1/org-settings'),
  },
  digests: {
    list: (cursor?: string) => apiFetch<{ data: Array<{ id: string; title: string; description: string | null; state: string; createdAt: string; config: Record<string, unknown> | null }>; schedule?: { enabled: boolean; workspacePermitted: boolean; latest: { state: string; runAfter: string; attempts: number } | null } | null; meta?: { next_cursor?: string | null } }>(`/api/v1/digests${cursor ? `?${new URLSearchParams({ cursor })}` : ''}`),
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
      user?: { id: string; email?: string; orgId?: string | null; role?: string };
    } | null>(res);
    return body?.user ? body : null;
  } catch {
    return null;
  } finally {
    requestSignal.cleanup();
  }
}
