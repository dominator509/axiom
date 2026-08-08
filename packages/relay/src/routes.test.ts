// ─── Relay Routes (Hono) — Vitest Suite ───
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Hono } from 'hono';
import { CardRenderer, type BundleContent } from './card.js';
import { CommandRouter } from './commands.js';
import { ViralLoop, type PostMetrics } from './viral/loop.js';
import { Bandit } from './viral/bandit.js';
import { IncidentManager } from './observability/incidents.js';
import { HealthCheckRegistry } from './observability/health.js';
import { createRelayRoutes, type RelayDependencies } from './routes.js';
import type { ViralPersistence } from './viral/persistence.js';

function buildDeps(overrides: Partial<RelayDependencies> = {}): RelayDependencies {
  return {
    cardRenderer: new CardRenderer(),
    commandRouter: new CommandRouter('route-secret', 5),
    viralLoop: new ViralLoop(),
    bandit: new Bandit(),
    incidentManager: new IncidentManager(),
    healthRegistry: new HealthCheckRegistry(),
    ...overrides,
  };
}

let deps: RelayDependencies;
let app: ReturnType<typeof createRelayRoutes>;

beforeAll(() => {
  deps = buildDeps();
  app = createRelayRoutes(deps);
});

afterAll(() => {
  vi.restoreAllMocks();
});

function makeBundle(overrides: Partial<BundleContent> = {}): BundleContent {
  return {
    id: 'bundle-1',
    mediaUrls: ['https://cdn.example/1.jpg'],
    caption: 'Launch day!',
    captionVariants: {},
    hashtagSets: { tiktok: ['#launch'] },
    tosScores: { tiktok: 0.95 },
    targetPlatforms: ['tiktok'],
    ...overrides,
  };
}

function makePostMetrics(postId: string, er: number): PostMetrics {
  return {
    postId,
    platform: 'tiktok',
    modelName: 'flux-pro',
    impressions: 1000,
    likes: 100,
    comments: 10,
    shares: 5,
    saves: 20,
    engagementRate: er,
    timestamp: Date.now(),
  };
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/v1/relay/card', () => {
  it('renders and returns a card for a valid bundle', async () => {
    const res = await postJson('/api/v1/relay/card', makeBundle());
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.card).toMatchObject({ bundleId: 'bundle-1', format: 'html' });
    expect(body.card.verdicts[0]).toMatchObject({ platform: 'tiktok', passed: true });
    expect(body.card.actions).toContain('approve');
  });

  it('returns a card with regenerate actions for ToS-failing bundles', async () => {
    const res = await postJson('/api/v1/relay/card', makeBundle({ tosScores: { tiktok: 0.3 } }));
    const body = (await res.json()) as any;
    expect(body.card.actions).toEqual(['regenerate', 'revise', 'reject', 'hold']);
  });

  it('returns 500 for a malformed body', async () => {
    const res = await app.request('/api/v1/relay/card', { method: 'POST' });
    expect(res.status).toBe(500);
    const body = (await res.json()) as any;
    expect(body.success).toBe(false);
    expect(body.error).toBeTruthy();
  });
});

describe('POST /api/v1/relay/command', () => {
  it('processes a command signed by the router', async () => {
    const nonce = deps.commandRouter.generateNonce();
    const sig = deps.commandRouter.signCommand(nonce, 'approve', 'bundle-1');
    const res = await postJson('/api/v1/relay/command', {
      signature: sig,
      nonce,
      action: 'approve',
      cardId: 'bundle-1',
      params: { note: 'ok' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.action).toBe('approve');
    expect(body.cardId).toBe('bundle-1');
  });

  it('rejects an invalid signature with 403', async () => {
    const res = await postJson('/api/v1/relay/command', {
      signature: 'deadbeef',
      nonce: 'n1',
      action: 'approve',
      cardId: 'bundle-1',
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as any;
    expect(body).toMatchObject({ success: false, error: 'Invalid or expired command signature' });
  });

  it('rejects nonce replay with 403 even with a valid signature', async () => {
    const nonce = deps.commandRouter.generateNonce();
    const sig = deps.commandRouter.signCommand(nonce, 'reject', 'bundle-2');
    const first = await postJson('/api/v1/relay/command', {
      signature: sig,
      nonce,
      action: 'reject',
      cardId: 'bundle-2',
    });
    expect(first.status).toBe(200);
    const second = await postJson('/api/v1/relay/command', {
      signature: sig,
      nonce,
      action: 'reject',
      cardId: 'bundle-2',
    });
    expect(second.status).toBe(403);
  });

  it('returns 500 for a malformed body', async () => {
    const res = await app.request('/api/v1/relay/command', { method: 'POST' });
    expect(res.status).toBe(500);
    const body = (await res.json()) as any;
    expect(body.success).toBe(false);
  });
});

describe('POST /api/v1/viral/ingest', () => {
  it('ingests metrics and returns a label', async () => {
    const res = await postJson('/api/v1/viral/ingest', {
      postId: 'p1',
      metrics: makePostMetrics('p1', 0.03),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.label).toBe('baseline'); // insufficient data for percentiles
  });

  it('labels posts after enough data accumulates', async () => {
    for (let i = 1; i <= 4; i++) {
      await postJson('/api/v1/viral/ingest', {
        postId: `p${i}`,
        metrics: makePostMetrics(`p${i}`, i / 100),
      });
    }
    const res = await postJson('/api/v1/viral/ingest', {
      postId: 'p5',
      metrics: makePostMetrics('p5', 0.05),
    });
    const body = (await res.json()) as any;
    expect(body.label).toBe('viral');
  });

  it('returns 500 for a malformed body', async () => {
    const res = await app.request('/api/v1/viral/ingest', { method: 'POST' });
    expect(res.status).toBe(500);
  });
});

describe('GET /api/v1/viral/exemplars', () => {
  it('returns exemplars filtered by platform', async () => {
    await postJson('/api/v1/viral/ingest', {
      postId: 'ex1',
      metrics: makePostMetrics('ex1', 0.06),
    });
    const res = await app.request('/api/v1/viral/exemplars?platform=tiktok&limit=5');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(Array.isArray(body.exemplars)).toBe(true);
  });

  it('defaults to platform=all and limit=10', async () => {
    const res = await app.request('/api/v1/viral/exemplars');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.exemplars.length).toBeLessThanOrEqual(10);
  });
});

describe('POST /api/v1/viral/ingest — DB-backed path (M-7)', () => {
  it('persists through the injected ViralPersistence and returns its label', async () => {
    const persist = vi.fn(async () => ({ label: 'viral' as const }));
    const listExemplars = vi.fn(async () => [{ label: 'viral', platform: 'tiktok' }]);
    const persistence: ViralPersistence = { persist, listExemplars };
    const localDeps = buildDeps({ viralPersistence: persistence });
    const localApp = createRelayRoutes(localDeps);

    const res = await localApp.request('/api/v1/viral/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postId: 'db1', metrics: makePostMetrics('db1', 0.05) }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body).toEqual({ success: true, label: 'viral' });
    expect(persist).toHaveBeenCalledWith({
      postId: 'db1',
      metrics: expect.objectContaining({ postId: 'db1', engagementRate: 0.05 }),
      orgId: undefined,
    });
    // The in-memory loop must NOT be touched when persistence is injected.
    expect(localDeps.viralLoop.getExemplarCount()).toBe(0);
  });

  it('passes the authenticated orgId from the request context', async () => {
    const persist = vi.fn(async () => ({ label: 'baseline' as const }));
    const persistence: ViralPersistence = { persist, listExemplars: async () => [] };
    const localDeps = buildDeps({ viralPersistence: persistence });
    const localApp = createRelayRoutes(localDeps);

    // Mirror the API mount: requireAuth middleware on a parent app sets orgId
    // on the shared context BEFORE the relay routes are reached (the API
    // registers app.use(...requireAuth) ahead of app.route('/', relay)).
    const parent = new Hono<{ Variables: { orgId?: string } }>();
    parent.use('*', async (c, next) => {
      c.set('orgId', 'org-123');
      await next();
    });
    parent.route('/', localApp);

    const res = await parent.request('/api/v1/viral/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postId: 'db2', metrics: makePostMetrics('db2', 0.01) }),
    });
    expect(res.status).toBe(200);
    expect(persist).toHaveBeenCalledWith({
      postId: 'db2',
      metrics: expect.any(Object),
      orgId: 'org-123',
    });
  });

  it('reads exemplars through the injected ViralPersistence', async () => {
    const listExemplars = vi.fn(async () => [
      { label: 'strong', platform: 'tiktok', perfScore: 1.2 },
    ]);
    const persistence: ViralPersistence = { persist: vi.fn(), listExemplars };
    const localDeps = buildDeps({ viralPersistence: persistence });
    const localApp = createRelayRoutes(localDeps);

    const res = await localApp.request('/api/v1/viral/exemplars?platform=tiktok&limit=3');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.exemplars).toEqual([{ label: 'strong', platform: 'tiktok', perfScore: 1.2 }]);
    expect(listExemplars).toHaveBeenCalledWith({ platform: 'tiktok', limit: 3, orgId: undefined });
  });

  it('returns 500 when persistence throws (fail closed, no silent in-memory fallback)', async () => {
    const persistence: ViralPersistence = {
      persist: vi.fn(async () => {
        throw new Error('no post_target');
      }),
      listExemplars: async () => [],
    };
    const localDeps = buildDeps({ viralPersistence: persistence });
    const localApp = createRelayRoutes(localDeps);

    const res = await localApp.request('/api/v1/viral/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postId: 'db3', metrics: makePostMetrics('db3', 0.02) }),
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as any;
    expect(body.success).toBe(false);
    expect(body.error).toBe('Failed to ingest metrics');
    expect(localDeps.viralLoop.getExemplarCount()).toBe(0);
  });
});

describe('POST /api/v1/incidents/report', () => {
  it('reports an incident', async () => {
    const res = await postJson('/api/v1/incidents/report', {
      severity: 'sev-2',
      message: 'latency spike',
      source: 'poller',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.incident).toMatchObject({
      severity: 'sev-2',
      message: 'latency spike',
      source: 'poller',
    });
  });

  it('returns 500 for a malformed body', async () => {
    const res = await app.request('/api/v1/incidents/report', { method: 'POST' });
    expect(res.status).toBe(500);
  });
});

describe('POST /api/v1/incidents/:id/replay', () => {
  it('returns success:false for an unknown DLQ id', async () => {
    const res = await app.request('/api/v1/incidents/dlq-unknown/replay', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body).toEqual({ success: false });
  });

  it('replays an enqueued DLQ entry successfully', async () => {
    const entry = deps.incidentManager.enqueueDLQ({
      originalPayload: { postId: 'p9' },
      error: 'timeout',
      source: 'publisher',
      maxRetries: 3,
    });
    const res = await app.request(`/api/v1/incidents/${entry.id}/replay`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body).toEqual({ success: true });
    expect(deps.incidentManager.getDLQ()).toHaveLength(0);
  });
});

describe('GET /api/v1/metrics', () => {
  it('exposes prometheus text metrics', async () => {
    const res = await app.request('/api/v1/metrics');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/plain');
    const text = await res.text();
    expect(text).toContain('# TYPE relay_cards_sent counter');
    expect(text).toContain('relay_cards_sent{platforms="tiktok"}');
  });
});

describe('GET /api/v1/health', () => {
  it('returns 200 ok when no checks are registered', async () => {
    const res = await app.request('/api/v1/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.status).toBe('ok');
  });

  it('returns 503 when a registered check fails', async () => {
    const localDeps = buildDeps();
    localDeps.healthRegistry.registerCheck('boom', async () => {
      throw new Error('down');
    });
    const localApp = createRelayRoutes(localDeps);
    const res = await localApp.request('/api/v1/health');
    expect(res.status).toBe(503);
    const body = (await res.json()) as any;
    expect(body.status).toBe('fail');
    expect(body.checks[0]).toMatchObject({ name: 'boom', status: 'fail', message: 'down' });
  });
});
