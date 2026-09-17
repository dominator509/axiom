import { beforeEach, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';
import { mockDbFactory, mockState } from './test-utils.js';
vi.mock('@axiom/db', () => mockDbFactory());
vi.mock('@axiom/worker', () => ({ asPlatform: (value: string) => value }));
import { variantExperimentsRouter } from './variant-experiments.js';
const id = '11111111-1111-4111-8111-111111111111';
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
beforeEach(() => { mockState.results = []; mockState.result = []; mockState.updates = []; });
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
