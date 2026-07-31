// ─── linkBioRoutes — Vitest Suite ───
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { linkBioRoutes } from './routes.js';
import { registry } from './registry.js';
import { NativeLinkBioProvider } from './native.js';

// The routes module reads the app-level singleton registry. Register a known
// set of providers for deterministic assertions.
beforeEach(() => {
  registry.register(new NativeLinkBioProvider());
});

afterEach(() => {
  vi.restoreAllMocks();
});

function appWithOrg(orgId = 'org-1'): Hono {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('orgId' as never, orgId as never);
    await next();
  });
  app.route('/', linkBioRoutes);
  return app;
}

describe('GET /api/v1/models/:id/linkbio', () => {
  it('returns active providers and the primary', async () => {
    const res = await appWithOrg().request('/api/v1/models/model-1/linkbio');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { modelId: string; activeProviders: string[]; primaryProvider: string | null } };
    expect(body.data.modelId).toBe('model-1');
    expect(body.data.activeProviders).toContain('native');
    expect(body.data.primaryProvider).toBe('native');
  });

  it('returns null primary when no providers are active', async () => {
    // Overwrite the default native provider with a disabled one
    registry.register({
      getKind: () => 'native' as const,
      isEnabled: () => false,
      getProfile: async () => '',
      updateProfile: async () => undefined,
      getAnalytics: async () => [],
    });
    registry.register({
      getKind: () => 'fanlynks' as const,
      isEnabled: () => false,
      getProfile: async () => ({}),
      updateProfile: async () => undefined,
      getAnalytics: async () => [],
    });
    const res = await appWithOrg().request('/api/v1/models/model-9/linkbio');
    const body = (await res.json()) as { data: { primaryProvider: string | null; activeProviders: string[] } };
    expect(body.data.primaryProvider).toBeNull();
    expect(body.data.activeProviders).toEqual([]);
  });
});
