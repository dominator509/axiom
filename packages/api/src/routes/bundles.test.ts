// ─── Bundles Router (real DB-backed) — Vitest Suite ───
// Covers: org-scoped list/get/create + approve/revise/reject lifecycle with
// ToS gating (LBI-11) and audit writes, using the chainable @axiom/db mock.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { createHash } from 'node:crypto';
import type { AppBindings } from '../index.js';
import { mockState, mockDbFactory } from './test-utils.js';

vi.mock('@axiom/db', () => ({
  ...mockDbFactory({ contentBundle: {}, postTarget: {}, asset: {}, platformConnection: {}, orgSettings: {} }),
  getPublishingConsentStatus: vi.fn(async () => ({ ok: true, missing: [] })),
  getTosScanState: vi.fn(async () => 'completed'),
  tosScanSnapshotDigest: vi.fn((snapshot: { orgId: string; bundleId: string; modelId: string; assetId: string;
    assetSha256: string; revisionId: string | null; captions: Record<string, string>; hashtags: string[] }) =>
    createHash('sha256').update(JSON.stringify({
      orgId: snapshot.orgId, bundleId: snapshot.bundleId, modelId: snapshot.modelId, assetId: snapshot.assetId,
      assetSha256: snapshot.assetSha256, revisionId: snapshot.revisionId,
      captions: Object.entries(snapshot.captions).sort(([left], [right]) => left.localeCompare(right)),
      hashtags: snapshot.hashtags,
    })).digest('hex')),
  consentRequirementMessage: vi.fn(
    (_status: unknown, platform: string) => `consent required for ${platform}`,
  ),
}));
vi.mock('@axiom/worker', () => ({
  enqueueJob: vi.fn(async () => ({ id: 'job-1' })),
  resolveCapabilities: vi.fn((platform: string) => ({
    media: platform === 'youtube' || platform === 'tiktok' ? ['video', 'short']
      : platform === 'x' || platform === 'reddit' ? ['text', 'image', 'video'] : ['image'],
  })),
  asPlatform: vi.fn((platform: string) => {
    const supported = [
      'instagram',
      'tiktok',
      'x',
      'youtube',
      'reddit',
      'threads',
      'discord',
      'telegram',
      'facebook',
      'snapchat',
      'fanvue',
    ];
    if (!supported.includes(platform)) throw new Error(`unsupported target platform '${platform}'`);
    return platform;
  }),
}));

import { bundlesRouter } from './bundles.js';
import { assetPreview } from '../asset-preview.js';
vi.mock('../asset-preview.js', () => ({ assetPreview: vi.fn() }));
import { enqueueJob, resolveCapabilities } from '@axiom/worker';
import { getPublishingConsentStatus, getTosScanState } from '@axiom/db';
import { captionSha256 } from '../variant-guidance.js';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const MODEL_ID = '22222222-2222-4222-8222-222222222222';
const BUNDLE_ID = '33333333-3333-4333-8333-333333333333';
const INSTAGRAM_CONNECTION_ID = '44444444-4444-4444-8444-444444444444';
const X_CONNECTION_ID = '55555555-5555-4555-8555-555555555555';
const GUIDANCE_BUNDLE_ID = '66666666-6666-4666-8666-666666666666';

describe('explicit ToS rescan', () => {
  const assetId = GUIDANCE_BUNDLE_ID;
  const hash = '12'.repeat(32);
  const bundle = (overrides: Record<string, unknown> = {}) => ({
    id: BUNDLE_ID, orgId: ORG_ID, modelId: MODEL_ID, state: 'generated', assetId,
    captions: { instagram: 'Saved caption' }, hashtags: ['#safe'],
    tosReport: { verdict: 'pending', revisionId: null }, ...overrides,
  });
  const asset = (overrides: Record<string, unknown> = {}) => ({
    id: assetId, orgId: ORG_ID, modelId: MODEL_ID, kind: 'image', sha256: Buffer.from(hash, 'hex'), ...overrides,
  });
  const failedScan = () => ({
    id: '77777777-7777-4777-8777-777777777777', state: 'ready', attempts: 1,
    lastError: 'fetch failed', lockedBy: null, lockedAt: null,
  });
  const body = (overrides: Record<string, unknown> = {}) => ({
    modelId: MODEL_ID, assetId, expectedRevisionId: null, ...overrides,
  });
  const request = (input: unknown, role: 'owner' | 'manager' | 'operator' | 'content_creator' | 'chatter' = 'owner') =>
    appWithOrg(ORG_ID, role).request(`/${BUNDLE_ID}/tos-rescan`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
    });

  it('retires only the failed attempt and queues a snapshot-bound ToS job', async () => {
    mockState.results = [[], [bundle()], [asset()], [failedScan()], [{ id: '77777777-7777-4777-8777-777777777777' }]];
    const response = await request(body());
    expect(response.status).toBe(202);
    const receipt = (await response.json() as any).data;
    expect(receipt).toMatchObject({ bundleId: BUNDLE_ID, modelId: MODEL_ID, state: 'queued', approvalBlocked: true });
    expect(receipt.scanJobId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(mockState.updates[0]).toMatchObject({ state: 'dead', lockedBy: null, lockedAt: null });
    expect(mockState.updates[0]).not.toHaveProperty('attempts');
    expect(mockState.updates[0]).not.toHaveProperty('lastError');
    const call = vi.mocked(enqueueJob).mock.calls[0][1];
    expect(call).toMatchObject({
      id: receipt.scanJobId, queue: 'tos', kind: 'tos.scan',
      payload: {
        bundleId: BUNDLE_ID, rescanJobId: receipt.scanJobId,
        retryOfJobId: '77777777-7777-4777-8777-777777777777',
        assetId, assetSha256: hash, revisionId: null,
      },
    });
    expect(call.payload).toHaveProperty('rescanRequestId');
    expect(call.payload).toHaveProperty('contentDigest');
    expect(vi.mocked(enqueueJob).mock.calls.every(([, value]) => value.kind === 'tos.scan')).toBe(true);
    expect(mockState.updates[1]).toMatchObject({
      tosReport: { verdict: 'pending', revisionId: null, rescan: { state: 'queued', jobId: receipt.scanJobId } },
    });
    expect(mockState.insertValues).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'bundle.tos-rescan.requested', target: BUNDLE_ID }),
    ]));
  });

  it('requires owner, manager, or operator and rejects stale or out-of-scope snapshots', async () => {
    expect((await request(body(), 'content_creator')).status).toBe(403);
    mockState.results = [[], [bundle({ modelId: '99999999-9999-4999-8999-999999999999' })]];
    expect((await request(body())).status).toBe(404);
    mockState.results = [[], [bundle({ orgId: '99999999-9999-4999-8999-999999999999' })]];
    expect((await request(body())).status).toBe(404);
    mockState.results = [[], [bundle({ tosReport: { verdict: 'pending', revisionId: '88888888-8888-4888-8888-888888888888' } })]];
    expect((await request(body())).status).toBe(409);
    mockState.results = [[], [bundle()], [asset({ modelId: '99999999-9999-4999-8999-999999999999' })]];
    expect((await request(body())).status).toBe(409);
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('does not enqueue again after a committed retry is visible to a duplicate click', async () => {
    mockState.results = [[], [bundle()], [asset()], [failedScan()], [{ id: '77777777-7777-4777-8777-777777777777' }]];
    const first = await request(body());
    expect(first.status).toBe(202);
    const receipt = (await first.json() as any).data;

    mockState.results = [
      [],
      [bundle({ tosReport: { verdict: 'pending', revisionId: null, rescan: { state: 'queued', jobId: receipt.scanJobId } } })],
      [asset()],
      [{ id: receipt.scanJobId, state: 'ready', attempts: 0, lastError: null }],
    ];
    const duplicate = await request(body());
    expect(duplicate.status).toBe(409);
    expect(enqueueJob).toHaveBeenCalledTimes(1);
  });

  it('leaves queued, running, and first-attempt scans alone', async () => {
    mockState.results = [[], [bundle()], [asset()], [{ ...failedScan(), attempts: 0 }]];
    expect((await request(body())).status).toBe(409);
    expect(enqueueJob).not.toHaveBeenCalled();
    expect(mockState.updates).toHaveLength(0);

    mockState.results = [[], [bundle()], [asset()], [{ ...failedScan(), state: 'running' }]];
    expect((await request(body())).status).toBe(409);
    expect(enqueueJob).not.toHaveBeenCalled();
    expect(mockState.updates).toHaveLength(0);
  });
});


describe('generation safety snapshot', () => {
  it.each(['failed', 'pending', 'completed', 'missing'] as const)('reports durable scan state %s without redispatching', async state => {
    vi.mocked(getTosScanState).mockResolvedValueOnce(state);
    mockState.results = [[], [{ id: BUNDLE_ID, orgId: ORG_ID, modelId: MODEL_ID,
      state: 'generated', assetId: 'saved-asset', tosReport: { verdict: 'pending' } }]];
    const response = await appWithOrg(ORG_ID).request(`/${BUNDLE_ID}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ scanFailed: state === 'failed', data: { assetId: 'saved-asset' } });
    expect(getTosScanState).toHaveBeenCalledWith(expect.anything(), ORG_ID, BUNDLE_ID);
    expect(enqueueJob).not.toHaveBeenCalled();
  });
  it.each([
    { state: 'generated', assetId: 'saved-asset' },
    { state: 'hold', assetId: null },
    { state: 'approved', assetId: null },
  ])('does not label a bundle that is not awaiting generation as paused (%j)', async values => {
    mockState.results = [[], [{ id: BUNDLE_ID, orgId: ORG_ID, modelId: MODEL_ID, ...values }]];
    const result = await appWithOrg(ORG_ID).request(`/${BUNDLE_ID}`);
    expect(result.status).toBe(200);
    expect(await result.json()).not.toHaveProperty('generationPaused');
  });
  it.each([true, false, undefined])('reports existing workspace pause state (%s)', async enabled => {
    mockState.results = [[], [{ id: BUNDLE_ID, orgId: ORG_ID, modelId: MODEL_ID, state: 'generated', assetId: null }],
      enabled === undefined ? [] : [{ publishingEnabled: enabled }]];
    const result = await appWithOrg(ORG_ID).request(`/${BUNDLE_ID}`);
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ generationPaused: enabled !== true });
    expect(enqueueJob).not.toHaveBeenCalled();
  });
});

describe('bundle media preview authorization', () => {
  it('requires organization context', async () => {
    const response = await appWithOrg(null).request(`/${BUNDLE_ID}/media`);
    expect(response.status).toBe(401);
    expect(assetPreview).not.toHaveBeenCalled();
  });
  it('rejects invalid identifiers before storage access', async () => {
    const response = await appWithOrg(ORG_ID).request('/bad-id/media');
    expect(response.status).toBe(400);
    expect(assetPreview).not.toHaveBeenCalled();
  });
  it.each([
    { rows: [] },
    { rows: [{ id: 'asset-1', orgId: 'another-org', modelId: MODEL_ID }] },
    { rows: [{ id: 'asset-1', orgId: ORG_ID, modelId: 'another-model' }] },
    { rows: [{ id: 'another-asset', orgId: ORG_ID, modelId: MODEL_ID }] },
  ])('does not serve missing or mismatched assets', async ({ rows }) => {
    mockState.results = [[], [{ id: BUNDLE_ID, orgId: ORG_ID, modelId: MODEL_ID, assetId: 'asset-1' }], rows];
    const response = await appWithOrg(ORG_ID).request(`/${BUNDLE_ID}/media`);
    expect(response.status).toBe(404);
    expect(assetPreview).not.toHaveBeenCalled();
  });
  it('serves a matching asset and suppresses filesystem error details', async () => {
    const row = { id: 'asset-1', orgId: ORG_ID, modelId: MODEL_ID };
    const results = () => [[], [{ id: BUNDLE_ID, orgId: ORG_ID, modelId: MODEL_ID, assetId: row.id }], [row]];
    mockState.results = results();
    vi.mocked(assetPreview).mockResolvedValue(new Response(null, { headers: { 'content-type': 'video/mp4' } }));
    expect((await appWithOrg(ORG_ID).request(`/${BUNDLE_ID}/media`, { method: 'HEAD' })).status).toBe(200);
    expect(assetPreview).toHaveBeenCalledOnce();
    mockState.results = results();
    vi.mocked(assetPreview).mockRejectedValue(new Error('private/storage/path'));
    const response = await appWithOrg(ORG_ID).request(`/${BUNDLE_ID}/media`);
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain('private/storage/path');
  });
});

describe('explicit video review route', () => {
  function fixture() {
    const hash = '01'.repeat(32);
    const scanId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const bundle = { id: BUNDLE_ID, orgId: ORG_ID, modelId: MODEL_ID, state: 'generated', assetId: 'asset-1',
      captions: { instagram: 'Safe' }, hashtags: [] };
    const contentDigest = createHash('sha256').update(JSON.stringify({ bundleId: bundle.id, assetId: bundle.assetId,
      assetSha256: hash, captions: Object.entries(bundle.captions), hashtags: bundle.hashtags })).digest('hex');
    const score = { platform: 'instagram', score: 0, threshold: 20, verdict: 'review', reasons: [] };
    return { bundle: { ...bundle, tosReport: { verdict: 'review', scores: [score], videoScan: {
      policy: 'sampled-2fps-v1', scanId, contentDigest, assetSha256: hash, durationSeconds: 6, frameCount: 12,
      automatedScores: [{ ...score, verdict: 'pass' }],
    } } },
      asset: { id: 'asset-1', orgId: ORG_ID, modelId: MODEL_ID, kind: 'video', mimeType: 'video/mp4', sha256: Buffer.from(hash, 'hex') },
      input: { scanId, platforms: ['instagram'], fullVideoAndAudioReviewed: true, reason: 'Reviewed all video and audio' } };
  }
  const request = (input: unknown, orgId: string | null = ORG_ID) => appWithOrg(orgId).request(`/${BUNDLE_ID}/video-review`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
  });
  it('records an explicit human decision without scheduling or publishing', async () => {
    const { bundle, asset, input } = fixture();
    mockState.results = [[], [bundle], [asset]];
    vi.mocked(assetPreview).mockResolvedValue(new Response(null));
    const response = await request(input);
    expect(response.status).toBe(200);
    expect(mockState.updates[0]).toMatchObject({ tosReport: { decisionSource: 'human-review', verdict: 'pass',
      humanReview: { actorId: 'user-1', scanId: input.scanId } } });
    expect(enqueueJob).not.toHaveBeenCalled();
  });
  it.each(['pending-scan', 'wrong-model', 'blocked', 'changed-scan', 'missing-file', 'already-approved'])(
    'rejects %s without updating compliance', async failure => {
      const { bundle, asset, input } = fixture();
      if (failure === 'pending-scan') vi.mocked(getTosScanState).mockResolvedValue('pending');
      if (failure === 'wrong-model') asset.modelId = 'other-model';
      if (failure === 'blocked') bundle.tosReport.verdict = 'block';
      if (failure === 'changed-scan') input.scanId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
      if (failure === 'already-approved') bundle.state = 'approved';
      mockState.results = [[], [bundle], [asset]];
      if (failure === 'missing-file') vi.mocked(assetPreview).mockRejectedValue(new Error('Private filesystem path'));
      else vi.mocked(assetPreview).mockResolvedValue(new Response(null));
      const response = await request(input);
      expect(response.status).toBe(409);
      expect(await response.text()).not.toContain('Private filesystem path');
      expect(mockState.updates).toHaveLength(0);
      expect(enqueueJob).not.toHaveBeenCalled();
    });
  it('requires authentication and explicit attestation', async () => {
    const { input } = fixture();
    expect((await request(input, null)).status).toBe(401);
    expect((await request({ ...input, fullVideoAndAudioReviewed: false })).status).toBe(400);
    expect(mockState.updates).toHaveLength(0);
  });
});

function passingTos(...platforms: string[]) {
  return {
    verdict: 'pass',
    scores: platforms.map((platform) => ({ platform, verdict: 'pass' })),
  };
}

function appWithOrg(orgId: string | null, role: 'owner' | 'manager' | 'operator' | 'content_creator' | 'chatter' = 'owner') {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    if (orgId) c.set('orgId', orgId);
    c.set('userId', 'user-1');
    c.set('role', role);
    await next();
  });
  app.route('/', bundlesRouter);
  return app;
}

beforeEach(() => {
  vi.mocked(assetPreview).mockReset();
  mockState.updates = [];
  mockState.result = [];
  mockState.results = [];
  mockState.insertValues = [];
  vi.mocked(enqueueJob).mockReset().mockImplementation(async (_tx, input) => ({ id: input.id ?? 'job-1' }));
  vi.mocked(getPublishingConsentStatus).mockClear();
  vi.mocked(getTosScanState).mockReset().mockResolvedValue('completed');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GET / — list bundles', () => {
  it('returns rows for the org (optionally filtered by modelId/state)', async () => {
    mockState.result = [{ id: BUNDLE_ID, orgId: ORG_ID, modelId: MODEL_ID, state: 'generated' }];
    const res = await appWithOrg(ORG_ID).request(`/?modelId=${MODEL_ID}&state=generated`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toHaveLength(1);
    expect(body.data[0].state).toBe('generated');
  });

  it('returns an empty list when no bundles exist', async () => {
    const res = await appWithOrg(ORG_ID).request('/');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toEqual([]);
  });

  it('rejects without org context (401)', async () => {
    const res = await appWithOrg(null).request('/');
    expect(res.status).toBe(401);
  });
});

describe('GET /:id — get bundle', () => {
  it('returns the bundle when in the org', async () => {
    mockState.result = [{ id: BUNDLE_ID, orgId: ORG_ID, modelId: MODEL_ID, state: 'generated' }];
    const res = await appWithOrg(ORG_ID).request(`/${BUNDLE_ID}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.id).toBe(BUNDLE_ID);
  });

  it('returns 404 when the bundle is not in the org', async () => {
    const res = await appWithOrg(ORG_ID).request(`/${BUNDLE_ID}`);
    expect(res.status).toBe(404);
  });
});

describe('POST / — create bundle', () => {
  it.each(['image_clip', 'image_resize', 'video_clip', 'video_transcode'])('reviews a stored %s variant with explicit bounded copy', async variantType => {
    mockState.insertValues = [];
    const asset = { id: X_CONNECTION_ID, orgId: ORG_ID, modelId: MODEL_ID, mimeType: variantType.startsWith('video') ? 'video/mp4' : 'image/jpeg' };
    mockState.results = [[], [{ orgId: ORG_ID }], [{ id: INSTAGRAM_CONNECTION_ID, outputAssetId: asset.id, variantType, settings: {} }], [asset], [{ id: BUNDLE_ID }]];
    vi.mocked(assetPreview).mockResolvedValue(new Response(null));
    const response = await appWithOrg(ORG_ID).request('/', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelId: MODEL_ID, variantId: INSTAGRAM_CONNECTION_ID, variantCaption: { platform: 'instagram', text: 'A ceramic vase' } }) });
    expect(response.status).toBe(201);
    expect(mockState.insertValues[0]).toMatchObject({ sourceVariantId: INSTAGRAM_CONNECTION_ID, assetId: asset.id, captions: { instagram: 'A ceramic vase' }, tosReport: { verdict: 'pending' } });
  });
  it('does not allow explicit variantCaption to replace saved caption-variant text', async () => {
    mockState.results = [[], [{ orgId: ORG_ID }], [{ id: INSTAGRAM_CONNECTION_ID, outputAssetId: X_CONNECTION_ID, variantType: 'caption', settings: { copy: { platform: 'instagram', text: 'Original' } } }]];
    const response = await appWithOrg(ORG_ID).request('/', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelId: MODEL_ID, variantId: INSTAGRAM_CONNECTION_ID, variantCaption: { platform: 'instagram', text: 'Override' } }) });
    expect(response.status).toBe(404); expect(enqueueJob).not.toHaveBeenCalled();
  });
  it('reuses the allocated review bundle without enqueueing another scan', async () => {
    mockState.insertValues = [];
    mockState.results = [[], [{ orgId: ORG_ID }], [{ experimentId: MODEL_ID }],
      [{ id: MODEL_ID, platform: 'instagram', status: 'completed', variantIds: [INSTAGRAM_CONNECTION_ID] }],
      [{ variantId: INSTAGRAM_CONNECTION_ID, reviewBundleId: BUNDLE_ID }], [{ id: BUNDLE_ID }]];
    const response = await appWithOrg(ORG_ID).request('/', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelId: MODEL_ID, variantId: INSTAGRAM_CONNECTION_ID, assignmentId: X_CONNECTION_ID }) });
    expect(response.status).toBe(201); expect(await response.json()).toEqual({ data: { id: BUNDLE_ID } });
    expect(mockState.insertValues).toEqual([]); expect(enqueueJob).not.toHaveBeenCalled();
  });
  it('rejects an allocation for a different variant', async () => {
    mockState.results = [[], [{ orgId: ORG_ID }], [{ experimentId: MODEL_ID }],
      [{ id: MODEL_ID, platform: 'instagram', status: 'running', variantIds: [INSTAGRAM_CONNECTION_ID] }], [{ variantId: X_CONNECTION_ID }]];
    const response = await appWithOrg(ORG_ID).request('/', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelId: MODEL_ID, variantId: INSTAGRAM_CONNECTION_ID, assignmentId: X_CONNECTION_ID }) });
    expect(response.status).toBe(404); expect(enqueueJob).not.toHaveBeenCalled();
  });
  it('binds a saved copy variant using server-owned copy and media with fresh scan', async () => {
    mockState.insertValues = [];
    const asset = { id: X_CONNECTION_ID, orgId: ORG_ID, modelId: MODEL_ID, mimeType: 'image/jpeg' };
    mockState.results = [[], [{ orgId: ORG_ID }], [{ id: INSTAGRAM_CONNECTION_ID, outputAssetId: asset.id, variantType: 'caption', settings: { copy: { platform: 'instagram', text: 'Saved vase caption' } } }], [asset], [{ id: BUNDLE_ID }]];
    vi.mocked(assetPreview).mockResolvedValue(new Response(null));
    const response = await appWithOrg(ORG_ID).request('/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ modelId: MODEL_ID, variantId: INSTAGRAM_CONNECTION_ID }) });
    expect(response.status).toBe(201);
    expect(mockState.insertValues[0]).toMatchObject({ sourceVariantId: INSTAGRAM_CONNECTION_ID, assetId: asset.id, captions: { instagram: 'Saved vase caption' }, tosReport: { verdict: 'pending' } });
    expect(enqueueJob).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'tos.scan' }));
  });
  it('re-verifies stored guidance against its source bundle before creating review', async () => {
    mockState.insertValues = [];
    const caption = 'Saved vase caption';
    const receipt = { version: 'caption-guidance-v1' as const, selectedArm: 'short:question', context: 'learn-v1:scheduled-utc-unknown', exemplarIds: [], captionSha256: captionSha256(caption), hookType: 'question' };
    const sourceBundle = { id: GUIDANCE_BUNDLE_ID, sourceVariantId: null, assetId: X_CONNECTION_ID, captions: { instagram: caption }, captionGuidance: { instagram: receipt } };
    const { exemplarIds: _exemplarIds, ...receiptWithoutExemplars } = receipt;
    const provenance = { ...receiptWithoutExemplars, sourceBundleId: GUIDANCE_BUNDLE_ID, sourceVariantId: null, platform: 'instagram' };
    const asset = { id: X_CONNECTION_ID, orgId: ORG_ID, modelId: MODEL_ID, mimeType: 'image/jpeg' };
    mockState.results = [[], [{ orgId: ORG_ID }], [{ id: INSTAGRAM_CONNECTION_ID, assetId: asset.id, outputAssetId: asset.id, variantType: 'caption', settings: { copy: { platform: 'instagram', text: caption }, guidance: provenance } }], [sourceBundle], [asset], [{ id: BUNDLE_ID }]];
    vi.mocked(assetPreview).mockResolvedValue(new Response(null));
    const response = await appWithOrg(ORG_ID).request('/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ modelId: MODEL_ID, variantId: INSTAGRAM_CONNECTION_ID }) });
    expect(response.status).toBe(201);
    expect(mockState.insertValues[0]).toMatchObject({ captionGuidance: { instagram: receipt } });
  });
  it('blocks review when stored guidance no longer matches the source bundle', async () => {
    const caption = 'Saved vase caption';
    const receipt = { version: 'caption-guidance-v1' as const, selectedArm: null, context: 'learn-v1:scheduled-utc-unknown', exemplarIds: [], captionSha256: captionSha256(caption) };
    const { exemplarIds: _exemplarIds, ...receiptWithoutExemplars } = receipt;
    const provenance = { ...receiptWithoutExemplars, sourceBundleId: GUIDANCE_BUNDLE_ID, sourceVariantId: null, platform: 'instagram' };
    mockState.results = [[], [{ orgId: ORG_ID }], [{ id: INSTAGRAM_CONNECTION_ID, assetId: X_CONNECTION_ID, outputAssetId: X_CONNECTION_ID, variantType: 'caption', settings: { copy: { platform: 'instagram', text: caption }, guidance: provenance } }], [{ id: GUIDANCE_BUNDLE_ID, sourceVariantId: null, assetId: X_CONNECTION_ID, captions: { instagram: 'Edited source' }, captionGuidance: { instagram: receipt } }]];
    const response = await appWithOrg(ORG_ID).request('/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ modelId: MODEL_ID, variantId: INSTAGRAM_CONNECTION_ID }) });
    expect(response.status).toBe(409);
    expect(mockState.insertValues).toEqual([]);
  });
  it('rejects overriding copy in an attributed variant review', async () => {
    const response = await appWithOrg(ORG_ID).request('/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ modelId: MODEL_ID, variantId: INSTAGRAM_CONNECTION_ID, captions: { instagram: 'Different copy' } }) });
    expect(response.status).toBe(400); expect(enqueueJob).not.toHaveBeenCalled();
  });
  it('rejects a variant that is missing from the scoped model', async () => {
    mockState.results = [[], [{ orgId: ORG_ID }], []];
    const response = await appWithOrg(ORG_ID).request('/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ modelId: MODEL_ID, variantId: INSTAGRAM_CONNECTION_ID }) });
    expect(response.status).toBe(404); expect(enqueueJob).not.toHaveBeenCalled();
  });
  it('links owned saved media with fresh pending scan in the bundle transaction', async () => {
    mockState.insertValues = [];
    const asset = { id: X_CONNECTION_ID, orgId: ORG_ID, modelId: MODEL_ID, mimeType: 'image/jpeg' };
    mockState.results = [[], [{ orgId: ORG_ID }], [asset], [{ id: BUNDLE_ID }]];
    vi.mocked(assetPreview).mockResolvedValue(new Response(null));
    const response = await appWithOrg(ORG_ID).request('/', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelId: MODEL_ID, assetId: asset.id, captions: { instagram: 'A ceramic vase' }, tosReport: { verdict: 'pass' } }) });
    expect(response.status).toBe(201);
    expect(mockState.insertValues[0]).toMatchObject({ assetId: asset.id, state: 'generated', tosReport: { verdict: 'pending', scores: [] } });
    expect(enqueueJob).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'tos.scan', payload: { bundleId: BUNDLE_ID } }));
    expect(assetPreview).toHaveBeenCalledWith(
      asset,
      expect.objectContaining({ method: 'HEAD' }),
      expect.any(String),
      { orgId: ORG_ID, modelId: MODEL_ID },
      expect.anything(),
    );
  });
  it.each(['other-org', 'other-model', 'missing', 'webm', 'missing-file'])('rejects unusable saved media: %s', async failure => {
    mockState.insertValues = [];
    const asset = { id: X_CONNECTION_ID, orgId: failure === 'other-org' ? 'other' : ORG_ID,
      modelId: failure === 'other-model' ? 'other' : MODEL_ID, mimeType: failure === 'webm' ? 'video/webm' : 'image/jpeg' };
    mockState.results = [[], [{ orgId: ORG_ID }], failure === 'missing' ? [] : [asset]];
    vi.mocked(assetPreview).mockRejectedValue(new Error('private storage path'));
    const response = await appWithOrg(ORG_ID).request('/', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelId: MODEL_ID, assetId: asset.id, captions: { instagram: 'Caption' } }) });
    expect(response.status).toBe(404);
    expect(mockState.insertValues).toEqual([]);
    expect(enqueueJob).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain('private storage path');
  });
  it.each([{}, { instagram: ' ' }, { unknown: 'Caption' }])('rejects saved-media captions that cannot be scanned: %j', async captions => {
    const response = await appWithOrg(ORG_ID).request('/', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelId: MODEL_ID, assetId: X_CONNECTION_ID, captions }) });
    expect(response.status).toBe(400);
    expect(enqueueJob).not.toHaveBeenCalled();
  });
  it('creates a bundle in generated state with captions and audits', async () => {
    mockState.result = [{ id: BUNDLE_ID, orgId: ORG_ID, modelId: MODEL_ID, state: 'generated' }];
    const res = await appWithOrg(ORG_ID).request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        modelId: MODEL_ID,
        captions: { instagram: 'hello' },
        hashtags: ['model'],
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.data.state).toBe('generated');
    expect(body.data.orgId).toBe(ORG_ID);
  });

  it('rejects a non-uuid modelId', async () => {
    const res = await appWithOrg(ORG_ID).request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelId: 'not-a-uuid' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a missing modelId', async () => {
    const res = await appWithOrg(ORG_ID).request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a model outside the organization before inserting', async () => {
    mockState.result = [];
    const res = await appWithOrg(ORG_ID).request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelId: MODEL_ID }),
    });
    expect(res.status).toBe(404);
  });
});

describe('POST /:id/approve — ToS-gated approval (LBI-11)', () => {
  it('rejects an unqualified datetime-local slot before mutation', async () => {
    const res = await appWithOrg(ORG_ID).request(`/${BUNDLE_ID}/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platforms: ['x'], slot: '2030-07-10T18:30' }),
    });
    expect(res.status).toBe(400);
    expect(mockState.updates).toHaveLength(0);
    expect(enqueueJob).not.toHaveBeenCalled();
  });
  it('rejects approval when the compliance record set is incomplete', async () => {
    const generatedBundle = {
      id: BUNDLE_ID,
      orgId: ORG_ID,
      modelId: MODEL_ID,
      state: 'generated',
      assetId: 'asset-1',
      tosReport: passingTos('instagram'),
    };
    mockState.results = [[], [generatedBundle]];
    vi.mocked(getPublishingConsentStatus).mockResolvedValueOnce({
      ok: false,
      missing: ['2257', 'platform_consent:instagram'],
    });

    const res = await appWithOrg(ORG_ID).request(`/${BUNDLE_ID}/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platforms: ['instagram'] }),
    });

    expect(res.status).toBe(409);
    expect(((await res.json()) as any).detail).toContain('consent required for instagram');
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it.each([undefined, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'])(
    'approves a reviewed passing bundle and creates post targets (revision %s)',
    async (revisionId) => {
      const slot = revisionId ? new Date(Date.now() + 3_600_000).toISOString() : undefined;
      const generatedBundle = {
        id: BUNDLE_ID,
        orgId: ORG_ID,
        modelId: MODEL_ID,
        state: 'generated',
        assetId: 'asset-1',
        tosReport: { ...passingTos('instagram', 'x'), revisionId },
      };
      const approvedBundle = { ...generatedBundle, state: 'approved' };
      mockState.result = [approvedBundle];
      mockState.results = [
        [],
        [generatedBundle],
        [{ id: 'asset-1', kind: 'image' }],
        [
          { id: INSTAGRAM_CONNECTION_ID, platform: 'instagram' },
          { id: X_CONNECTION_ID, platform: 'x' },
        ],
        [approvedBundle],
        [{ id: BUNDLE_ID }],
        [{ id: BUNDLE_ID }],
      ];
      const res = await appWithOrg(ORG_ID).request(`/${BUNDLE_ID}/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          platforms: ['instagram', 'x'],
          revisionId,
          slot,
          connectionIds: { instagram: INSTAGRAM_CONNECTION_ID, x: X_CONNECTION_ID },
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.data.state).toBe('approved');
      expect(enqueueJob).toHaveBeenCalledTimes(2);
      expect(enqueueJob).toHaveBeenNthCalledWith(
        1,
        expect.anything(),
        expect.objectContaining({
          queue: 'publish',
          kind: 'publish.target',
          runAfter: slot ? new Date(slot) : expect.any(Date),
          dedupeParts: ['publish.target', BUNDLE_ID],
        }),
      );
    },
  );

  it('blocks approval until the queued ToS scan has completed', async () => {
    const generatedBundle = {
      id: BUNDLE_ID,
      orgId: ORG_ID,
      modelId: MODEL_ID,
      state: 'generated',
      assetId: 'asset-1',
      tosReport: passingTos('instagram'),
    };
    vi.mocked(getTosScanState).mockResolvedValue('pending');
    mockState.results = [[], [generatedBundle], [{ id: 'asset-1', kind: 'image' }]];

    const res = await appWithOrg(ORG_ID).request(`/${BUNDLE_ID}/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platforms: ['instagram'] }),
    });

    expect(res.status).toBe(409);
    expect(((await res.json()) as any).detail).toContain('ToS scan is still running');
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('returns a conflict when the bundle changes before approval is committed', async () => {
    const generatedBundle = {
      id: BUNDLE_ID,
      orgId: ORG_ID,
      modelId: MODEL_ID,
      state: 'generated',
      assetId: 'asset-1',
      tosReport: passingTos('instagram'),
    };
    mockState.results = [
      [],
      [generatedBundle],
      [{ id: 'asset-1', kind: 'image' }],
      [{ id: INSTAGRAM_CONNECTION_ID, platform: 'instagram' }],
      [],
    ];

    const res = await appWithOrg(ORG_ID).request(`/${BUNDLE_ID}/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platforms: ['instagram'] }),
    });

    expect(res.status).toBe(409);
    expect(((await res.json()) as any).detail).toContain(
      'bundle changed while approval was being applied',
    );
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('rejects approval when the selected platform has ambiguous accounts', async () => {
    const generatedBundle = {
      id: BUNDLE_ID,
      orgId: ORG_ID,
      modelId: MODEL_ID,
      state: 'generated',
      assetId: 'asset-1',
      tosReport: passingTos('instagram'),
    };
    mockState.results = [
      [],
      [generatedBundle],
      [{ id: 'asset-1', kind: 'image' }],
      [
        { id: INSTAGRAM_CONNECTION_ID, platform: 'instagram' },
        { id: X_CONNECTION_ID, platform: 'instagram' },
      ],
    ];

    const res = await appWithOrg(ORG_ID).request(`/${BUNDLE_ID}/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platforms: ['instagram'] }),
    });

    expect(res.status).toBe(409);
    expect(((await res.json()) as any).detail).toContain('multiple connected instagram accounts');
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('rejects approval when the bundle asset is not owned by its org and model', async () => {
    const generatedBundle = {
      id: BUNDLE_ID,
      orgId: ORG_ID,
      modelId: MODEL_ID,
      state: 'generated',
      assetId: 'asset-missing',
      tosReport: passingTos('instagram'),
    };
    mockState.results = [[], [generatedBundle], []];

    const res = await appWithOrg(ORG_ID).request(`/${BUNDLE_ID}/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platforms: ['instagram'] }),
    });

    expect(res.status).toBe(409);
    expect(((await res.json()) as any).detail).toContain('unavailable or unsupported media asset');
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it.each(['youtube', 'tiktok'])('rejects image approval for video-only %s before mutation', async (platform) => {
    mockState.results = [[], [{
      id: BUNDLE_ID, orgId: ORG_ID, modelId: MODEL_ID,
      state: 'generated', assetId: 'asset-1', tosReport: passingTos(platform),
    }], [{ id: 'asset-1', kind: 'image' }]];
    const res = await appWithOrg(ORG_ID).request(`/${BUNDLE_ID}/approve`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platforms: [platform] }),
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { detail: string }).detail).toContain(`${platform} does not support image assets`);
    expect(mockState.updates).toHaveLength(0);
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('fails closed when asset capabilities cannot be resolved', async () => {
    mockState.results = [[], [{
      id: BUNDLE_ID, orgId: ORG_ID, modelId: MODEL_ID,
      state: 'generated', assetId: 'asset-1', tosReport: passingTos('instagram'),
    }], [{ id: 'asset-1', kind: 'image' }]];
    vi.mocked(resolveCapabilities).mockImplementationOnce(() => { throw new Error('registry unavailable'); });
    const res = await appWithOrg(ORG_ID).request(`/${BUNDLE_ID}/approve`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platforms: ['instagram'] }),
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { detail: string }).detail).toContain('media support is unknown');
    expect(mockState.updates).toHaveLength(0);
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('rejects approval when the ToS verdict is block (409)', async () => {
    mockState.result = [
      {
        id: BUNDLE_ID,
        orgId: ORG_ID,
        modelId: MODEL_ID,
        state: 'generated',
        tosReport: { verdict: 'block', scores: [] },
      },
    ];
    const res = await appWithOrg(ORG_ID).request(`/${BUNDLE_ID}/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platforms: ['instagram'] }),
    });
    expect(res.status).toBe(409);
  });

  it('rejects approval when the ToS report is missing or incomplete (409)', async () => {
    mockState.result = [
      {
        id: BUNDLE_ID,
        orgId: ORG_ID,
        modelId: MODEL_ID,
        state: 'generated',
        tosReport: { verdict: 'pass', scores: [] },
      },
    ];
    const res = await appWithOrg(ORG_ID).request(`/${BUNDLE_ID}/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platforms: ['instagram'] }),
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).detail).toContain('ToS check unavailable');
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('rejects media-only approval when the bundle has no asset', async () => {
    mockState.result = [
      {
        id: BUNDLE_ID,
        orgId: ORG_ID,
        modelId: MODEL_ID,
        state: 'generated',
        assetId: null,
        tosReport: passingTos('instagram'),
      },
    ];
    const res = await appWithOrg(ORG_ID).request(`/${BUNDLE_ID}/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platforms: ['instagram'] }),
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).detail).toContain('requires media');
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('rejects approval of a bundle that is no longer generated (409)', async () => {
    mockState.result = [
      {
        id: BUNDLE_ID,
        orgId: ORG_ID,
        modelId: MODEL_ID,
        state: 'approved',
        tosReport: passingTos('instagram'),
      },
    ];
    const res = await appWithOrg(ORG_ID).request(`/${BUNDLE_ID}/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platforms: ['instagram'] }),
    });
    expect(res.status).toBe(409);
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('rejects an unsupported target platform before creating a job (400)', async () => {
    const res = await appWithOrg(ORG_ID).request(`/${BUNDLE_ID}/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platforms: ['onlyfans'] }),
    });
    expect(res.status).toBe(400);
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('rejects a bundle with an empty platforms array (400)', async () => {
    mockState.result = [
      { id: BUNDLE_ID, orgId: ORG_ID, state: 'generated', tosReport: { verdict: 'pass' } },
    ];
    const res = await appWithOrg(ORG_ID).request(`/${BUNDLE_ID}/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platforms: [] }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 when the bundle is not in the org', async () => {
    const res = await appWithOrg(ORG_ID).request(`/${BUNDLE_ID}/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platforms: ['instagram'] }),
    });
    expect(res.status).toBe(404);
  });
});

describe('POST /:id/revise — queue generation', () => {
  it.each(['approved', 'revising', 'published'])(
    'does not enqueue revision in %s state',
    async (state) => {
      mockState.results = [[], [{ id: BUNDLE_ID, state }]];
      const res = await appWithOrg(ORG_ID).request(`/${BUNDLE_ID}/revise`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ instructions: 'Make it warmer' }),
      });
      expect(res.status).toBe(409);
      expect(enqueueJob).not.toHaveBeenCalled();
      expect(mockState.updates).toHaveLength(0);
    },
  );
  it('rejects approval for a revision the operator has not reviewed', async () => {
    mockState.results = [
      [],
      [
        {
          id: BUNDLE_ID,
          state: 'generated',
          tosReport: { ...passingTos('x'), revisionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
        },
      ],
    ];
    const res = await appWithOrg(ORG_ID).request(`/${BUNDLE_ID}/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platforms: ['x'] }),
    });
    expect(res.status).toBe(409);
    expect(mockState.updates).toHaveLength(0);
    expect(enqueueJob).not.toHaveBeenCalled();
  });
  it('revises a bundle with instructions', async () => {
    mockState.results = [
      [],
      [{ id: BUNDLE_ID, state: 'generated' }],
      [{ id: BUNDLE_ID, state: 'revising' }],
    ];
    const res = await appWithOrg(ORG_ID).request(`/${BUNDLE_ID}/revise`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instructions: 'make it warmer' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.state).toBe('revising');
    expect(mockState.updates).toContainEqual(
      expect.objectContaining({
        state: 'revising',
        sourceVariantId: null,
        tosReport: expect.objectContaining({ verdict: 'pending', revisionId: expect.any(String) }),
      }),
    );
    expect(enqueueJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        queue: 'content',
        kind: 'content.generate',
        payload: {
          bundleId: BUNDLE_ID,
          revision: { id: expect.any(String), instructions: 'make it warmer', userId: 'user-1' },
        },
      }),
    );
  });

  it('rejects missing instructions (400)', async () => {
    const res = await appWithOrg(ORG_ID).request(`/${BUNDLE_ID}/revise`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('rejects revising an approved bundle (409)', async () => {
    mockState.results = [[], [{ id: BUNDLE_ID, state: 'approved' }]];
    const res = await appWithOrg(ORG_ID).request(`/${BUNDLE_ID}/revise`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instructions: 'make it warmer' }),
    });
    expect(res.status).toBe(409);
  });
});

describe.each(['revise', 'reject'])('versioned %s requests', (action) => {
  const revisionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  it.each([undefined, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'])(
    'rejects missing or stale review versions (%s) before any mutation',
    async (supplied) => {
      mockState.results = [[], [{ id: BUNDLE_ID, state: 'generated', tosReport: { revisionId } }]];
      const res = await appWithOrg(ORG_ID).request(`/${BUNDLE_ID}/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ instructions: 'Make it warmer', revisionId: supplied }),
      });
      expect(res.status).toBe(409);
      expect(mockState.updates).toHaveLength(0);
      expect(enqueueJob).not.toHaveBeenCalled();
    },
  );
  it.each(['generated', 'hold'])('accepts the reviewed version in %s state', async (state) => {
    mockState.results = [
      [],
      [{ id: BUNDLE_ID, state, tosReport: { revisionId } }],
      [{ id: BUNDLE_ID, state: action === 'revise' ? 'revising' : 'rejected' }],
    ];
    const res = await appWithOrg(ORG_ID).request(`/${BUNDLE_ID}/${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instructions: 'Make it warmer', revisionId }),
    });
    expect(res.status).toBe(200);
    expect(mockState.updates.length).toBeGreaterThan(0);
  });
  it('rejects malformed revision IDs before database mutation', async () => {
    const res = await appWithOrg(ORG_ID).request(`/${BUNDLE_ID}/${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instructions: 'Make it warmer', revisionId: 'bad' }),
    });
    expect(res.status).toBe(400);
    expect(mockState.updates).toHaveLength(0);
  });
});

describe('POST /:id/reject', () => {
  it('rejects a bundle', async () => {
    mockState.results = [
      [],
      [{ id: BUNDLE_ID, state: 'generated' }],
      [{ id: BUNDLE_ID, orgId: ORG_ID, modelId: MODEL_ID, state: 'rejected' }],
    ];
    const res = await appWithOrg(ORG_ID).request(`/${BUNDLE_ID}/reject`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.state).toBe('rejected');
  });

  it('rejects an approved bundle without leaving its publish work eligible (409)', async () => {
    mockState.results = [[], [{ id: BUNDLE_ID, state: 'approved' }]];
    const res = await appWithOrg(ORG_ID).request(`/${BUNDLE_ID}/reject`, { method: 'POST' });
    expect(res.status).toBe(409);
  });

  it('returns 404 when the bundle is not in the org', async () => {
    const res = await appWithOrg(ORG_ID).request(`/${BUNDLE_ID}/reject`, { method: 'POST' });
    expect(res.status).toBe(404);
  });
});
