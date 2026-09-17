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
