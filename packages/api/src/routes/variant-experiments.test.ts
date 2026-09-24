import { beforeEach, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';
import { mockDbFactory, mockState } from './test-utils.js';
import { captionSha256 } from '../variant-guidance.js';
vi.mock('@axiom/db', () => mockDbFactory());
vi.mock('@axiom/worker', async importOriginal => ({ ...(await importOriginal<Record<string, unknown>>()), asPlatform: (value: string) => value }));
import { variantExperimentsRouter } from './variant-experiments.js';
const id = '11111111-1111-4111-8111-111111111111';
const sourceBundleId = '22222222-2222-4222-8222-222222222222';
const guidanceText = 'A ceramic vase';

function guidanceSource(sourceVariantId: string | null = null) {
  return {
    id: sourceBundleId,
    sourceVariantId,
    assetId: id,
    captions: { instagram: guidanceText },
    captionGuidance: { instagram: {
      version: 'caption-guidance-v1', selectedArm: 'short:question', context: 'learn-v1:scheduled-utc-unknown',
      exemplarIds: [], captionSha256: captionSha256(guidanceText), hookType: 'question', format: 'single',
    } },
  };
}
it('returns bounded published performance without conflating manual outcomes', async () => {
  mockState.results = [[], [{ id, platform: 'instagram', variantIds: [id] }], Array.from({ length: 101 }, () => ({ targetId: id, variantId: id, views: 5 }))];
  const response = await app().request(`/models/${id}/variant-experiments/${id}/performance`);
  expect(response.status).toBe(200);
  const result = await response.json() as { data: unknown[]; meta: unknown; assessment: { status: string } };
  expect(result.data).toHaveLength(100);
  expect(result.meta).toEqual({ truncated: true, source: 'published-target-metrics' });
  expect(result.assessment.status).toBe('unavailable');
});
it('does not expose performance for an absent scoped experiment', async () => {
  mockState.results = [[], []];
  expect((await app().request(`/models/${id}/variant-experiments/${id}/performance`)).status).toBe(404);
});
it('rejects malformed performance lookup identities', async () => {
  expect((await app().request(`/models/${id}/variant-experiments/invalid/performance`)).status).toBe(400);
});
function app() {
  const server = new Hono<AppBindings>();
  server.use('*', async (c, next) => { c.set('orgId', id); await next(); });
  server.route('/', variantExperimentsRouter);
  return server;
}
function outcome(converted = true) {
  return app().request(`/models/${id}/variant-experiments/${id}/outcomes`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ assignmentId: id, converted }),
  });
}
beforeEach(() => { mockState.results = []; mockState.result = []; mockState.updates = []; mockState.insertValues = []; });
function promote(variantId = id) {
  return app().request(`/models/${id}/variant-experiments/${id}/promote`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ variantId }) });
}
it('refuses to reopen a completed experiment', async () => {
  mockState.results = [[], [{ id, status: 'completed' }]];
  const response = await app().request(`/models/${id}/variant-experiments/${id}`, { method: 'PATCH',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'running' }) });
  expect(response.status).toBe(409); expect(mockState.updates).toEqual([]);
});
it('replays the same completed winner without rewriting history', async () => {
  mockState.results = [[], [{ id, status: 'completed', variantIds: [id], winnerVariantId: id }]];
  expect((await promote()).status).toBe(200); expect(mockState.updates).toEqual([]);
});
it('refuses a different winner after completion', async () => {
  mockState.results = [[], [{ id, status: 'completed', variantIds: [id], winnerVariantId: 'other' }]];
  expect((await promote()).status).toBe(409); expect(mockState.updates).toEqual([]);
});
it('does not promote an unstarted experiment', async () => {
  mockState.results = [[], [{ id, status: 'draft', variantIds: [id] }]];
  expect((await promote()).status).toBe(409); expect(mockState.updates).toEqual([]);
});
it('requires outcomes for every candidate', async () => {
  mockState.results = [[], [{ id, status: 'running', variantIds: [id, 'other'] }], [{ variantId: id, outcomeAt: new Date() }]];
  expect((await promote()).status).toBe(409); expect(mockState.updates).toEqual([]);
});
it('records a winner after all candidates have outcomes', async () => {
  mockState.results = [[], [{ id, status: 'paused', variantIds: [id, 'other'] }],
    [{ variantId: id, outcomeAt: new Date() }, { variantId: 'other', outcomeAt: new Date() }], [{ id, winnerVariantId: id }]];
  expect((await promote()).status).toBe(200);
  expect(mockState.updates[0]).toMatchObject({ status: 'completed', winnerVariantId: id });
});
it('lists variant candidate identities with a bounded page and continuation cursor', async () => {
  mockState.results = [[], [{ id, variantType: 'image_resize', outputAssetId: id, createdAt: new Date('2026-09-17T00:00:00Z') }]];
  const response = await app().request(`/models/${id}/variant-experiments/candidates?limit=1`);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ data: [{ id, outputAssetId: id }], meta: { next_cursor: expect.any(String) } });
});
it('rejects invalid model identity before candidate lookup', async () => {
  expect((await app().request('/models/not-a-model/variant-experiments/candidates')).status).toBe(400);
});
it('requires organization context for variant discovery', async () => {
  const server = new Hono<AppBindings>(); server.route('/', variantExperimentsRouter);
  expect((await server.request(`/models/${id}/variant-experiments/candidates`)).status).toBe(401);
});
it('counts completed conversion outcomes without numeric metrics', async () => {
  mockState.results = [[], [{ id, variantIds: ['a'] }], [
    { experimentId: id, variantId: 'a', converted: true, metricValue: null, outcomeAt: new Date() },
    { experimentId: id, variantId: 'a', converted: false, metricValue: null, outcomeAt: null },
  ]];
  const response = await app().request(`/models/${id}/variant-experiments`);
  expect(response.status).toBe(200);
  expect((await response.json() as any).data[0].stats[0]).toMatchObject({ exposures: 2, outcomes: 1, conversions: 1, metricTotal: 0 });
});
it('exposes selected guidance attribution from scoped assignment outcomes', async () => {
  const secondVariant = '33333333-3333-4333-8333-333333333333';
  const guidance = {
    version: 'caption-guidance-v1', sourceBundleId, sourceVariantId: null, platform: 'instagram',
    selectedArm: 'short:question', context: 'learn-v1:scheduled-utc-unknown', captionSha256: captionSha256(guidanceText),
    hookType: 'question', format: 'single',
  };
  mockState.results = [[], [{ id, modelId: id, variantIds: [id, secondVariant] }], [
    { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', experimentId: id, variantId: id, converted: true, metricValue: 10 },
    { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', experimentId: id, variantId: secondVariant, converted: false, metricValue: 20 },
  ], [
    { id, settings: { guidance } },
    { id: secondVariant, settings: { guidance } },
  ]];
  const response = await app().request(`/models/${id}/variant-experiments/${id}/guidance-attribution`);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    data: [{ guidanceReceiptId: `${sourceBundleId}:instagram`, variantIds: [id, secondVariant], exposures: 2, conversions: 1, averageMetric: 15 }],
    meta: { source: 'assignment-outcomes', attribution: 'verified-guidance-receipt' },
  });
});
it('does not expose guidance attribution for an absent scoped experiment', async () => {
  mockState.results = [[], []];
  expect((await app().request(`/models/${id}/variant-experiments/${id}/guidance-attribution`)).status).toBe(404);
});
it('does not update an assignment when the scoped experiment is absent', async () => {
  mockState.results = [[], []];
  expect((await outcome()).status).toBe(404);
  expect(mockState.updates).toEqual([]);
});
it('returns an identical completed outcome without rewriting its timestamp', async () => {
  const assignment = { id, converted: true, metricValue: null, outcomeAt: '2026-09-01T00:00:00Z' };
  mockState.results = [[], [{ id }], [assignment]];
  const response = await outcome();
  expect(response.status).toBe(200);
  expect((await response.json() as any).data.outcomeAt).toBe(assignment.outcomeAt);
  expect(mockState.updates).toEqual([]);
});
it('rejects a conflicting completed outcome without an update', async () => {
  mockState.results = [[], [{ id }], [{ id, converted: false, metricValue: null, outcomeAt: new Date() }]];
  expect((await outcome()).status).toBe(409);
  expect(mockState.updates).toEqual([]);
});
it('freezes new outcomes once a winner has been selected', async () => {
  mockState.results = [[], [{ id, status: 'completed' }], [{ id, outcomeAt: null }]];
  expect((await outcome()).status).toBe(409);
  expect(mockState.updates).toEqual([]);
});
it('allows identical outcome replay after experiment completion', async () => {
  mockState.results = [[], [{ id, status: 'completed' }], [{ id, converted: true, metricValue: null, outcomeAt: new Date() }]];
  expect((await outcome()).status).toBe(200);
  expect(mockState.updates).toEqual([]);
});
it('lists paginated assignments after checking scoped experiment ownership', async () => {
  mockState.results = [[], [{ id }], [{ id, variantId: id, assignedAt: new Date('2026-09-17T00:00:00Z'), outcomeAt: null, converted: false, metricValue: null }]];
  const response = await app().request(`/models/${id}/variant-experiments/${id}/assignments?limit=1`);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ data: [{ id, variantId: id }], meta: { next_cursor: expect.any(String) } });
});
it('does not list assignments for an absent scoped experiment', async () => {
  mockState.results = [[], []];
  expect((await app().request(`/models/${id}/variant-experiments/${id}/assignments`)).status).toBe(404);
});
it('rejects malformed assignment history identities', async () => {
  expect((await app().request(`/models/${id}/variant-experiments/invalid/assignments`)).status).toBe(400);
});
function copyVariant(body: Record<string, unknown>) {
  return app().request(`/models/${id}/variant-experiments/candidates`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
it.each(['caption', 'teaser'])('saves owned %s copy without exposing storage or queuing publication', async type => {
  mockState.results = [[], [{ id, storageKey: '/private/source.jpg' }], [{ id }]];
  const response = await copyVariant({ assetId: id, type, platform: 'instagram', text: 'A ceramic vase' });
  expect(response.status).toBe(201); expect(await response.json()).toEqual({ data: { id } });
});
it('accepts only a same-org/model/asset guidance source and stores bounded provenance', async () => {
  mockState.results = [[], [{ id, storageKey: '/private/source.jpg' }], [guidanceSource()], [{ id }]];
  const response = await copyVariant({ assetId: id, type: 'caption', platform: 'instagram', text: guidanceText, guidanceBundleId: sourceBundleId });
  expect(response.status).toBe(201);
  const settings = (mockState.insertValues[0] as any).settings;
  expect(settings.guidance).toMatchObject({ sourceBundleId, platform: 'instagram', sourceVariantId: null });
  expect(settings.guidance).not.toHaveProperty('exemplarIds');
});
it('accepts a guidance source only when its source variant belongs to the selected asset', async () => {
  mockState.results = [[], [{ id, storageKey: '/private/source.jpg' }], [guidanceSource(id)], [{ id }], [{ id }]];
  const response = await copyVariant({ assetId: id, type: 'caption', platform: 'instagram', text: guidanceText, guidanceBundleId: sourceBundleId });
  expect(response.status).toBe(201);
  expect((mockState.insertValues[0] as any).settings.guidance).toMatchObject({ sourceBundleId, sourceVariantId: id });
});
it('rejects a guidance source whose source variant belongs to another asset', async () => {
  mockState.results = [[], [{ id, storageKey: '/private/source.jpg' }], [guidanceSource('33333333-3333-4333-8333-333333333333')], []];
  const response = await copyVariant({ assetId: id, type: 'caption', platform: 'instagram', text: guidanceText, guidanceBundleId: sourceBundleId });
  expect(response.status).toBe(409);
  expect(mockState.insertValues).toEqual([]);
});
it('rejects a missing or mismatched guidance source before inserting a candidate', async () => {
  mockState.results = [[], [{ id, storageKey: '/private/source.jpg' }], []];
  const response = await copyVariant({ assetId: id, type: 'caption', platform: 'instagram', text: guidanceText, guidanceBundleId: sourceBundleId });
  expect(response.status).toBe(409);
  expect(mockState.insertValues).toEqual([]);
});
it('does not save copy against another model asset', async () => {
  mockState.results = [[], []];
  expect((await copyVariant({ assetId: id, type: 'caption', platform: 'instagram', text: 'A vase' })).status).toBe(404);
});
it.each(['', ' '.repeat(5), 'a'.repeat(10001)])('rejects empty or oversized copy', async text => {
  expect((await copyVariant({ assetId: id, type: 'caption', platform: 'instagram', text })).status).toBe(400);
});
it('returns only bounded copy settings from candidate discovery', async () => {
  mockState.results = [[], [{ id, variantType: 'caption', settings: { copy: { platform: 'instagram', text: 'A vase' }, privatePath: '/secret' }, createdAt: new Date() }]];
  const response = await app().request(`/models/${id}/variant-experiments/candidates`);
  const body = await response.json() as { data: Record<string, unknown>[] };
  expect(body.data[0].copy).toEqual({ platform: 'instagram', text: 'A vase' });
  expect(body.data[0]).not.toHaveProperty('settings');
});
it('projects stored guidance without exposing its fingerprint', async () => {
  const verified = (await import('../variant-guidance.js')).readVerifiedGuidance(guidanceSource(), 'instagram', guidanceText)!;
  mockState.results = [[], [{ id, variantType: 'caption', settings: { copy: { platform: 'instagram', text: guidanceText }, guidance: verified.provenance }, createdAt: new Date() }]];
  const response = await app().request(`/models/${id}/variant-experiments/candidates`);
  const body = await response.json() as { data: Record<string, unknown>[] };
  expect(body.data[0].guidance).toMatchObject({ sourceBundleId, hookType: 'question' });
  expect(body.data[0].guidance).not.toHaveProperty('captionSha256');
});
it('lists only eligible guidance sources for the requested asset and platform', async () => {
  mockState.results = [[], [guidanceSource()]];
  const response = await app().request(`/models/${id}/variant-experiments/guidance-sources?assetId=${id}&platform=instagram`);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ data: [{ id: sourceBundleId, caption: guidanceText, guidance: { platform: 'instagram' } }] });
});
it('omits guidance sources whose source variant is not on the requested asset', async () => {
  mockState.results = [[], [{ ...guidanceSource('33333333-3333-4333-8333-333333333333'), sourceVariantAssetId: '44444444-4444-4444-8444-444444444444' }]];
  const response = await app().request(`/models/${id}/variant-experiments/guidance-sources?assetId=${id}&platform=instagram`);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ data: [] });
});
it('rejects copy variants for a different experiment platform', async () => {
  const other = '22222222-2222-4222-8222-222222222222';
  mockState.results = [[], [{ id }], [{ id, variantType: 'caption', settings: { copy: { platform: 'x', text: 'A vase' } } }, { id: other, variantType: 'crop' }]];
  const response = await app().request(`/models/${id}/variant-experiments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Copy test', platform: 'instagram', variantIds: [id, other] }) });
  expect(response.status).toBe(409);
});
