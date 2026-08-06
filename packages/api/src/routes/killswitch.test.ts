// ─── Killswitch Router (real DB-backed) — Vitest Suite ───
// Covers: org-scoped org_settings persistence + audit on enable/disable.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';
import { mockState, mockDbFactory } from './test-utils.js';

vi.mock('@axiom/db', () => mockDbFactory({ orgSettings: {} }));

import { killswitchRouter } from './killswitch.js';

const ORG_ID = '11111111-1111-4111-8111-111111111111';

function appWithOrg(orgId: string | null) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    if (orgId) c.set('orgId', orgId);
    c.set('userId', 'user-1');
    await next();
  });
  app.route('/', killswitchRouter);
  return app;
}

beforeEach(() => {
  mockState.result = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GET /killswitch — status', () => {
  it('reports the kill switch disabled when settings exist and publishing is enabled', async () => {
    mockState.result = [
      { orgId: ORG_ID, publishingEnabled: true, killSwitchReason: null, killSwitchAt: null, updatedAt: new Date().toISOString() },
    ];
    const res = await appWithOrg(ORG_ID).request('/killswitch');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.enabled).toBe(false);
  });

  it('reports enabled when publishing is disabled', async () => {
    mockState.result = [
      { orgId: ORG_ID, publishingEnabled: false, killSwitchReason: 'Emergency', killSwitchAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ];
    const res = await appWithOrg(ORG_ID).request('/killswitch');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.enabled).toBe(true);
    expect(body.data.reason).toBe('Emergency');
  });

  it('returns default disabled state when a settings row is present', async () => {
    mockState.result = [
      { orgId: ORG_ID, publishingEnabled: true, killSwitchReason: null, killSwitchAt: null, updatedAt: new Date().toISOString() },
    ];
    const res = await appWithOrg(ORG_ID).request('/killswitch');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.enabled).toBe(false);
  });

  it('rejects without org context (401)', async () => {
    const res = await appWithOrg(null).request('/killswitch');
    expect(res.status).toBe(401);
  });
});

describe('POST /killswitch/enable', () => {
  it('enables with a custom reason', async () => {
    mockState.result = [{ orgId: ORG_ID, publishingEnabled: false, killSwitchReason: 'Manual', killSwitchAt: new Date().toISOString() }];
    const res = await appWithOrg(ORG_ID).request('/killswitch/enable', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'Manual override' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.enabled).toBe(true);
  });

  it('rejects a malformed JSON body (400)', async () => {
    mockState.result = [{ orgId: ORG_ID, publishingEnabled: false }];
    const res = await appWithOrg(ORG_ID).request('/killswitch/enable', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not-json',
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /killswitch/disable', () => {
  it('disables and clears the reason', async () => {
    mockState.result = [{ orgId: ORG_ID, publishingEnabled: true, killSwitchReason: null, killSwitchAt: null }];
    const res = await appWithOrg(ORG_ID).request('/killswitch/disable', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.enabled).toBe(false);
  });
});

describe('POST /kill-switch (L3.0 alias)', () => {
  it('enables the org kill switch via the contract route', async () => {
    mockState.result = [{ orgId: ORG_ID, publishingEnabled: false, killSwitchReason: 'Shutdown', killSwitchAt: new Date().toISOString() }];
    const res = await appWithOrg(ORG_ID).request('/kill-switch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'Shutdown' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.enabled).toBe(true);
  });
});
