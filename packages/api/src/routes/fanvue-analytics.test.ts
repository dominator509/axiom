import { beforeEach, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';
import { mockState, mockDbFactory } from './test-utils.js';

const enqueue = vi.hoisted(() => vi.fn());
vi.mock('@axiom/db', () => mockDbFactory());
vi.mock('@axiom/worker', () => ({ enqueueJob: enqueue }));
import { fanvueAnalyticsRouter } from './fanvue-analytics.js';

const modelId = '22222222-2222-4222-8222-222222222222';
function app(role = 'owner', authenticated = true) {
  const a = new Hono<AppBindings>();
  a.use('*', async (c, next) => {
    if (authenticated) { c.set('orgId', '11111111-1111-4111-8111-111111111111'); c.set('userId', 'user-1'); }
    c.set('role', role as AppBindings['Variables']['role']);
    await next();
  });
  a.route('/', fanvueAnalyticsRouter);
  return a;
}
function results(...queries: unknown[]) { mockState.results = queries.flatMap(q => [[], q]); }
beforeEach(() => { mockState.results = []; enqueue.mockReset(); });

it('requires an authenticated workspace for account analytics', async () => {
  expect((await app('owner', false).request(`/models/${modelId}/fanvue/analytics`)).status).toBe(401);
});

it('returns only the projected metric and CRM fields', async () => {
  results(
    [{ id: 'metric', ts: '2026-09-19T00:00:00Z', subscribers: 12, earningsUsd: '4.25', messages: 2, tips: 1, tipEarningsUsd: '1.00', subscriberEventsNew: 3, subscriberEventsCancelled: 1, unreadMessages: 2, topSpenderCount: 1, windowStart: null, windowEnd: null }],
    [{ id: 'fan', displayName: 'Fan', tier: 'whale', lifetimeValueUsd: '100.00', lastActiveAt: null, secret: 'not selected' }],
  );
  const response = await app().request(`/models/${modelId}/fanvue/analytics`);
  expect(response.status).toBe(200);
  const body = await response.text();
  expect(body).toContain('topSpenderCount');
  expect(body).not.toContain('secret');
});

it('queues an operator sync job without contacting a provider', async () => {
  results([{ id: modelId }]);
  enqueue.mockResolvedValue({ id: 'job-1' });
  const response = await app('operator').request(`/models/${modelId}/fanvue/analytics/sync`, { method: 'POST', body: '{}' });
  expect(response.status).toBe(202);
  expect(await response.json()).toEqual({ data: { jobId: 'job-1', deduplicated: false } });
  expect(enqueue).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'fanvue.analytics.sync', payload: { modelId } }));
});

it('does not let a model role enqueue an account sync', async () => {
  expect((await app('model').request(`/models/${modelId}/fanvue/analytics/sync`, { method: 'POST', body: '{}' })).status).toBe(403);
  expect(enqueue).not.toHaveBeenCalled();
});

