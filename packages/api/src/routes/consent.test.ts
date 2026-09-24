import { describe, expect, it, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';
import { mockState, mockDbFactory } from './test-utils.js';

vi.mock('@axiom/db', () => ({
  ...mockDbFactory({ consentRecord: {} }),
  getPublishingConsentStatus: vi.fn(async () => ({ ok: false, missing: ['2257'] })),
}));

import { getPublishingConsentStatus } from '@axiom/db';
import { consentDocumentSha256, openConsentDocument } from '../consent-vault.js';
import { consentRouter } from './consent.js';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const MODEL_ID = '22222222-2222-4222-8222-222222222222';
const RECORD_ID = '33333333-3333-4333-8333-333333333333';

function appWithOrg(orgId: string | null, role: AppBindings['Variables']['role'] = 'owner') {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    if (orgId) c.set('orgId', orgId);
    c.set('userId', 'user-1');
    c.set('role', role);
    await next();
  });
  app.route('/', consentRouter);
  return app;
}

beforeEach(() => {
  mockState.result = [];
  mockState.results = [];
  mockState.insertValues = [];
  mockState.updates = [];
  process.env.BETTER_AUTH_SECRET = 'consent-vault-test-secret-with-32-bytes-minimum';
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

  it('encrypts a validated document, persists its digest and serves it only to vault roles', async () => {
    const source = Buffer.from('%PDF-1.7 encrypted test document');
    const row = {
      orgId: ORG_ID,
      modelId: MODEL_ID,
      docKind: 'model_release',
      platform: 'instagram',
      documentMimeType: 'application/pdf',
      documentSize: Buffer.byteLength('%PDF-1.7 encrypted test document'),
    };
    mockState.results = [
      [],
      [{ orgId: ORG_ID }],
      () => [{ ...row, id: (mockState.insertValues[0] as { id: string }).id }],
      [],
    ];
    const form = new FormData();
    form.set('platform', 'instagram');
    form.set('docKind', 'model_release');
    form.set('subjectRef', 'performer-1');
    form.set('validFrom', '2026-09-01');
    form.set('document', new Blob([source], { type: 'application/pdf' }), 'release.pdf');

    const res = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/consent-records`, {
      method: 'POST',
      body: form,
    });

    expect(res.status).toBe(201);
    const body = await res.json() as any;
    const stored = mockState.insertValues[0] as any;
    expect(body.data).toMatchObject({ id: stored.id, hasDocument: true, documentMimeType: 'application/pdf', documentSize: source.byteLength });
    expect(Buffer.from(stored.sha256)).toEqual(consentDocumentSha256(source));
    expect(Buffer.from(stored.documentCiphertext).includes(source)).toBe(false);
    expect(openConsentDocument(stored.documentCiphertext, { orgId: ORG_ID, modelId: MODEL_ID, recordId: stored.id })).toEqual(source);

    mockState.results = [[], [{ ...stored }]];
    const downloaded = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/consent-records/${stored.id}/document`);
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get('content-type')).toBe('application/pdf');
    expect(downloaded.headers.get('cache-control')).toContain('no-store');
    expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(source);

    mockState.results = [[{ ...stored }]];
    const denied = await appWithOrg(ORG_ID, 'chatter').request(`/models/${MODEL_ID}/consent-records/${stored.id}/document`);
    expect(denied.status).toBe(403);
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
    expect(mockState.updates[0]).toMatchObject({
      granted: false,
      documentCiphertext: null,
      documentMimeType: null,
      documentSize: null,
      blobRef: null,
    });
  });
});
