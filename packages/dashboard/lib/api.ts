// ─── Dashboard server-side API client ───
// Server Components fetch the Hono BFF through the same-origin rewrite
// (/api/* → API_ORIGIN). Cookies are forwarded so Better Auth sessions work.

import { cookies } from 'next/headers';

const API_BASE = process.env.API_ORIGIN ?? 'http://127.0.0.1:3001';

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

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = await res.text();
    }
    throw new ApiError(res.status, body);
  }
  return (await res.json()) as T;
}

export interface ModelProfile {
  id: string;
  orgId: string;
  displayName: string;
  handle: string;
  avatarUrl: string | null;
  bio: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ContentBundle {
  id: string;
  orgId: string;
  modelId: string;
  captions: Record<string, string>;
  hashtags: string[];
  tosReport: { verdict: string; scores: Array<{ platform: string; verdict: string }> } | null;
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

export interface KillSwitchState {
  enabled: boolean;
  reason: string;
  startedAt: string | null;
  updatedAt: string | null;
}

export interface NetworkConfig {
  modelId: string;
  egressMode: string;
  healthy: boolean;
  lastCheck: string | null;
  latencyMs: number | null;
  lastEgressIp: string | null;
  failCount: number;
  lastError: string | null;
}

export const api = {
  models: {
    list: () => apiFetch<{ data: ModelProfile[]; meta: { total: number } }>('/api/v1/models'),
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
    fans: (id: string) => apiFetch<{ data: FanContact[] }>(`/api/v1/models/${id}/fans`),
    customRequests: (id: string) =>
      apiFetch<{ data: CustomRequest[] }>(`/api/v1/models/${id}/custom-requests`),
    analytics: (id: string, days = 30) =>
      apiFetch<{ data: unknown }>(`/api/v1/models/${id}/analytics?days=${days}`),
    viral: (id: string) => apiFetch<{ data: unknown }>(`/api/v1/models/${id}/viral`),
    playbookScore: (id: string) =>
      apiFetch<{ data: unknown }>(`/api/v1/models/${id}/playbook-score`),
    generate: (id: string, body: Record<string, unknown>) =>
      apiFetch<{ data: { bundle: ContentBundle; variants: unknown[]; tosReport: unknown } }>(
        `/api/v1/models/${id}/generate`,
        { method: 'POST', body: JSON.stringify(body) },
      ),
    linkbio: (id: string) => apiFetch<{ data: unknown }>(`/api/v1/models/${id}/linkbio`),
    linkbioAnalytics: (id: string) =>
      apiFetch<{ data: unknown }>(`/api/v1/models/${id}/linkbio/analytics`),
  },
  bundles: {
    list: (modelId?: string, state?: string) =>
      apiFetch<{ data: ContentBundle[] }>(
        `/api/v1/bundles${modelId || state ? `?${new URLSearchParams({ ...(modelId ? { modelId } : {}), ...(state ? { state } : {}) })}` : ''}`,
      ),
    get: (id: string) => apiFetch<{ data: ContentBundle }>(`/api/v1/bundles/${id}`),
    approve: (id: string, body: { platforms: string[]; slot?: string }) =>
      apiFetch<{ data: ContentBundle }>(`/api/v1/bundles/${id}/approve`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    revise: (id: string, instructions: string) =>
      apiFetch<{ data: ContentBundle }>(`/api/v1/bundles/${id}/revise`, {
        method: 'POST',
        body: JSON.stringify({ instructions }),
      }),
    reject: (id: string) =>
      apiFetch<{ data: ContentBundle }>(`/api/v1/bundles/${id}/reject`, { method: 'POST' }),
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
    list: () => apiFetch<{ data: Array<Record<string, unknown>> }>('/api/v1/incidents'),
    replay: (jobId: string) =>
      apiFetch<{ success: boolean }>(`/api/v1/incidents/${jobId}/replay`, { method: 'POST' }),
  },
  social: {
    list: (modelId: string) =>
      apiFetch<{ data: Array<Record<string, unknown>> }>(
        `/api/v1/social-accounts?modelId=${modelId}`,
      ),
  },
  llm: {
    providers: () => apiFetch<{ providers: string[] }>('/api/v1/llm/providers'),
  },
};

/** Resolve the Better Auth session server-side (for layout redirects). */
export async function getSession() {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  try {
    const res = await fetch(`${API_BASE}/api/auth/get-session`, {
      headers: cookieHeader ? { cookie: cookieHeader } : {},
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { user?: { id: string } } | null;
    return body?.user ? body : null;
  } catch {
    return null;
  }
}
