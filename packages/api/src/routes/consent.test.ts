import { describe, expect, it, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';
import { mockState, mockDbFactory } from './test-utils.js';

vi.mock('@axiom/db', () => ({
  ...mockDbFactory({ consentRecord: {} }),
  getPublishingConsentStatus: vi.fn(async () => ({ ok: false, missing: ['2257'] })),
}));

import { getPublishingConsentStatus } from '@axiom/db';
import { consentRouter } from './consent.js';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const MODEL_ID = '22222222-2222-4222-8222-222222222222';
const RECORD_ID = '33333333-3333-4333-8333-333333333333';

function appWithOrg(orgId: string | null) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    if (orgId) c.set('orgId', orgId);
    c.set('userId', 'user-1');
    await next();
  });
  app.route('/', consentRouter);
  return app;
}

beforeEach(() => {
  mockState.result = [];
  mockState.results = [];
  vi.mocked(getPublishingConsentStatus).mockClear();
});

describe('Consent & Records Vault', () => {
  it('rejects a malformed document digest before database writes', async () => {
    const res = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/consent-records`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        platform: 'instagram',
        docKind: 'model_release',
        subjectRef: 'performer-1',
        blobRef: 'consent/model-1/release.pdf',
        sha256: 'not-a-digest',
        validFrom: '2026-09-01',
      }),
    });

    expect(res.status).toBe(400);
  });

  it('stores a reference and digest without accepting document bytes', async () => {
    const row = {
      id: RECORD_ID,
      orgId: ORG_ID,
      modelId: MODEL_ID,
      docKind: 'model_release',
      platform: 'instagram',
    };
    mockState.results = [[], [{ orgId: ORG_ID }], [row], []];

    const res = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/consent-records`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        platform: 'instagram',
        docKind: 'model_release',
        subjectRef: 'performer-1',
        blobRef: 'consent/model-1/release.pdf',
        sha256: 'a'.repeat(64),
        validFrom: '2026-09-01',
      }),
    });

    expect(res.status).toBe(201);
    expect(((await res.json()) as any).data.id).toBe(RECORD_ID);
  });

  it('returns a fail-closed publish status for an incomplete set', async () => {
    mockState.results = [[], [{ orgId: ORG_ID }]];
    vi.mocked(getPublishingConsentStatus).mockResolvedValueOnce({
      ok: false,
      missing: ['2257', 'platform_consent:instagram'],
    });

    const res = await appWithOrg(ORG_ID).request(
      `/models/${MODEL_ID}/consent-status?platform=instagram`,
    );

    expect(res.status).toBe(200);
    expect(((await res.json()) as any).data).toMatchObject({
      platform: 'instagram',
      ok: false,
      missing: ['2257', 'platform_consent:instagram'],
    });
  });

  it('revokes a record within the tenant and model scope', async () => {
    mockState.results = [[], [{ id: RECORD_ID, revokedAt: new Date() }], []];

    const res = await appWithOrg(ORG_ID).request(
      `/models/${MODEL_ID}/consent-records/${RECORD_ID}/revoke`,
      { method: 'POST' },
    );

    expect(res.status).toBe(200);
    expect(((await res.json()) as any).data.id).toBe(RECORD_ID);
  });
});
