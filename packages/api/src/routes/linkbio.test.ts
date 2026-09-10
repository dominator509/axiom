// ─── Link-in-bio (F-48..F-53) — Vitest Suite ───
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';
import { mockState, mockDbFactory } from './test-utils.js';

vi.mock('@axiom/db', () =>
  mockDbFactory({ linkbioProvider: {}, linkbioClick: {}, shortLink: {}, linkbioAnalytics: {} }),
);

import { linkbioRouter, publicLinkbioRouter } from './linkbio.js';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const MODEL_ID = '22222222-2222-4222-8222-222222222222';
const PROVIDER_ID = '33333333-3333-4333-8333-333333333333';

function appWithOrg(orgId: string | null) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    if (orgId) c.set('orgId', orgId);
    c.set('userId', 'user-1');
    await next();
  });
  app.route('/', linkbioRouter);
  return app;
}

function publicApp() {
  const app = new Hono<AppBindings>();
  app.route('/', publicLinkbioRouter);
  return app;
}

beforeEach(() => {
  mockState.result = [];
  mockState.results = [];
  mockState.updates = [];
  mockState.conflictUpdates = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GET /models/:modelId/linkbio', () => {
  it('returns providers + primary + native flag', async () => {
    mockState.result = [
      {
        id: PROVIDER_ID,
        orgId: ORG_ID,
        modelId: MODEL_ID,
        kind: 'native',
        enabled: true,
        isPrimary: true,
      },
    ];
    const res = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/linkbio`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.providers).toHaveLength(1);
    expect(body.data.nativeEnabled).toBe(true);
    expect(body.data.primary.kind).toBe('native');
  });

  it('returns empty provider list when none configured', async () => {
    const res = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/linkbio`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.providers).toEqual([]);
    expect(body.data.primary).toBeNull();
    expect(body.data.nativeEnabled).toBe(false);
  });
});

describe('POST /models/:modelId/linkbio', () => {
  it('enables a provider (201)', async () => {
    mockState.result = [
      {
        id: PROVIDER_ID,
        orgId: ORG_ID,
        modelId: MODEL_ID,
        kind: 'native',
        enabled: true,
        isPrimary: false,
      },
    ];
    const res = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/linkbio`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'native', config: { handle: '@luna' } }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.data.kind).toBe('native');
    expect(body.data.enabled).toBe(true);
  });

  it('persists an explicit primary-provider selection when re-enabling', async () => {
    mockState.result = [
      {
        id: PROVIDER_ID,
        orgId: ORG_ID,
        modelId: MODEL_ID,
        kind: 'native',
        enabled: true,
        isPrimary: true,
      },
    ];
    const res = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/linkbio`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'native', isPrimary: true, config: {} }),
    });
    expect(res.status).toBe(201);
    expect(
      mockState.conflictUpdates.find((update: any) => update.set?.isPrimary !== undefined),
    ).toEqual(
      expect.objectContaining({
        set: expect.objectContaining({ enabled: true, isPrimary: true }),
      }),
    );
  });

  it('rejects an unknown provider kind (400)', async () => {
    const res = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/linkbio`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'myspace' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects unsupported external providers instead of creating a label row', async () => {
    const res = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/linkbio`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'linktree' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects enabling a provider for a model outside the organization', async () => {
    mockState.result = [];
    const res = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/linkbio`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'native' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /models/:modelId/linkbio/:kind', () => {
  it('disables a provider', async () => {
    mockState.result = [
      {
        id: PROVIDER_ID,
        orgId: ORG_ID,
        modelId: MODEL_ID,
        kind: 'native',
        enabled: false,
        isPrimary: false,
      },
    ];
    const res = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/linkbio/native`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.enabled).toBe(false);
  });

  it('returns 404 when the provider is not enabled', async () => {
    const res = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/linkbio/native`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(404);
  });

  it('rejects an unknown kind (400)', async () => {
    const res = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/linkbio/myspace`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /models/:modelId/linkbio/analytics', () => {
  it('returns normalized per-provider analytics', async () => {
    // Empty result — no providers, no clicks: totalClicks = 0.
    mockState.result = [];
    const res = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/linkbio/analytics`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.providers).toBeDefined();
    expect(body.data.totalClicks).toBe(0);
  });
});

describe('POST /linkbio/clicks', () => {
  it('records a click (200)', async () => {
    mockState.result = [
      {
        id: PROVIDER_ID,
        kind: 'native',
        enabled: true,
        config: { links: [{ label: 'Fanvue', url: 'https://fanvue.com/luna' }] },
      },
    ];
    const res = await appWithOrg(ORG_ID).request('/linkbio/clicks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        providerId: PROVIDER_ID,
        target: 'https://fanvue.com/luna',
        source: 'bio',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
  });

  it('rejects a target that is not configured for the provider', async () => {
    mockState.result = [
      {
        id: PROVIDER_ID,
        kind: 'native',
        enabled: true,
        config: { links: [{ label: 'Fanvue', url: 'https://fanvue.com/luna' }] },
      },
    ];
    const res = await appWithOrg(ORG_ID).request('/linkbio/clicks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ providerId: PROVIDER_ID, target: 'https://attacker.example' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects clicks for a provider outside the organization', async () => {
    mockState.result = [];
    const res = await appWithOrg(ORG_ID).request('/linkbio/clicks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ providerId: PROVIDER_ID, target: 'https://fanvue.com/luna' }),
    });
    expect(res.status).toBe(404);
  });

  it('rejects enabled legacy external providers instead of treating them as native', async () => {
    mockState.result = [
      {
        id: PROVIDER_ID,
        kind: 'linktree',
        enabled: true,
        config: { links: [{ label: 'External', url: 'https://linktree.example/luna' }] },
      },
    ];
    const res = await appWithOrg(ORG_ID).request('/linkbio/clicks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        providerId: PROVIDER_ID,
        target: 'https://linktree.example/luna',
      }),
    });
    expect(res.status).toBe(404);
  });

  it('rejects a bad providerId (400)', async () => {
    const res = await appWithOrg(ORG_ID).request('/linkbio/clicks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ providerId: 'not-a-uuid', target: 'x' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('public Native Link-in-Bio page', () => {
  const model = {
    id: MODEL_ID,
    displayName: 'Luna Vex',
    handle: 'luna.vex',
    avatarUrl: null,
    bio: 'Official links',
  };
  const provider = {
    id: PROVIDER_ID,
    config: { links: [{ label: 'Fanvue', url: 'https://fanvue.example/luna' }] },
  };

  it('serves the configured page without an operator session', async () => {
    mockState.results = [{ rows: [{ org_id: ORG_ID }] }, [], [model], [provider]];
    const res = await publicApp().request(`/${MODEL_ID}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
    const html = await res.text();
    expect(html).toContain('Luna Vex');
    expect(html).toContain('Fanvue');
    expect(html).toContain('/s/');
    expect(html).not.toContain(provider.config.links[0].url);
  });

  it('records only configured links before redirecting the visitor', async () => {
    mockState.result = [{ id: 'short-link-id' }];
    mockState.results = [{ rows: [{ org_id: ORG_ID }] }, [], [model], [provider]];
    const digest = createHash('sha256')
      .update(`${MODEL_ID}:0:${provider.config.links[0].url}`)
      .digest('hex')
      .slice(0, 16);
    const slug = `lb-22222222-1-${digest}`;
    const res = await publicApp().request(`/${MODEL_ID}/s/${slug}`, {
      headers: { referer: 'https://social.example/post', 'user-agent': 'test-browser' },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain(`${provider.config.links[0].url}?`);
    expect(res.headers.get('location')).toContain('utm_source=axiom');
    expect(mockState.updates).toHaveLength(1);
  });

  it('rejects a tampered target instead of becoming an open redirect', async () => {
    mockState.results = [{ rows: [{ org_id: ORG_ID }] }, [], [model], [provider]];
    const res = await publicApp().request(`/${MODEL_ID}/s/not-a-configured-short-link`);
    expect(res.status).toBe(404);
  });

  it('rate-limits the unauthenticated page and redirect surface', async () => {
    const headers = { 'X-API-Key': 'linkbio-rate-limit-regression' };
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 61; attempt += 1) {
      const res = await publicApp().request(`/${MODEL_ID}/s/not-a-configured-short-link`, {
        headers,
      });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 60).every((status) => status === 404)).toBe(true);
    expect(statuses[60]).toBe(429);
  });
});
