// ─── Org settings Router (F-86) — Vitest Suite ───
// GET  /org-settings → current settings
// PATCH /org-settings → toggle viral_sharing / publishing_enabled (audited)

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';
import { mockState, mockDbFactory } from './test-utils.js';

vi.mock('@axiom/db', () => mockDbFactory({ orgSettings: {}, auditLog: {} }));

import { orgSettingsRouter } from './org-settings.js';

const ORG_ID = '11111111-1111-4111-8111-111111111111';

function appWithOrg(orgId: string | null) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    if (orgId) c.set('orgId', orgId);
    c.set('userId', 'user-1');
    await next();
  });
  app.route('/', orgSettingsRouter);
  return app;
}

const settingsRow = {
  orgId: ORG_ID,
  publishingEnabled: true,
  viralSharing: false,
  updatedAt: new Date('2026-08-07T00:00:00Z'),
};

beforeEach(() => {
  mockState.result = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /org-settings', () => {
  it('requires org (401 without session)', async () => {
    const res = await appWithOrg(null).request('/org-settings');
    expect(res.status).toBe(401);
  });

  it('returns current settings', async () => {
    mockState.result = [settingsRow];
    const res = await appWithOrg(ORG_ID).request('/org-settings');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.viralSharing).toBe(false);
    expect(body.data.publishingEnabled).toBe(true);
  });

  it('404s when the org has no settings row', async () => {
    const res = await appWithOrg(ORG_ID).request('/org-settings');
    expect(res.status).toBe(404);
  });
});

describe('PATCH /org-settings', () => {
  it('rejects an empty update body', async () => {
    const res = await appWithOrg(ORG_ID).request('/org-settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('enables viral_sharing (opt-in) and returns updated settings', async () => {
    mockState.result = [{ ...settingsRow, viralSharing: true }];
    const res = await appWithOrg(ORG_ID).request('/org-settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ viralSharing: true }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.viralSharing).toBe(true);
  });

  it('404s when no settings row exists to update', async () => {
    const res = await appWithOrg(ORG_ID).request('/org-settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ viralSharing: true }),
    });
    expect(res.status).toBe(404);
  });
});
