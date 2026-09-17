import { beforeEach, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';
import { mockState, mockDbFactory } from './test-utils.js';
vi.mock('@axiom/db', () => mockDbFactory());
vi.mock('./helpers.js', async original => ({ ...await original<typeof import('./helpers.js')>(), writeAudit: vi.fn() }));
import { teamOperationsRouter, canTransitionShift } from './team-operations.js';
const shift = { id: 'shift', modelId: 'model', orgId: 'org', status: 'active', note: 'handoff' };
function patch(status: string, note?: string) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => { c.set('orgId', 'org'); await next(); });
  app.route('/', teamOperationsRouter);
  return app.request('/models/model/team-shifts/shift', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status, ...(note === undefined ? {} : { note }) }) });
}
beforeEach(() => { mockState.results = []; mockState.result = []; mockState.updates = []; });
it('allows only forward shift transitions and exact status replay', () => {
  const allowed = new Set(['scheduled:scheduled', 'scheduled:active', 'scheduled:cancelled', 'active:active', 'active:completed', 'active:cancelled', 'completed:completed', 'cancelled:cancelled']);
  for (const from of ['scheduled', 'active', 'completed', 'cancelled', 'unknown'])
    for (const to of ['scheduled', 'active', 'completed', 'cancelled', 'unknown'])
      expect(canTransitionShift(from, to)).toBe(allowed.has(`${from}:${to}`));
});
it('rejects reopening a completed shift without writing', async () => {
  mockState.results = [[], [{ ...shift, status: 'completed' }]];
  expect((await patch('active')).status).toBe(409);
  expect(mockState.updates).toHaveLength(0);
});
it('preserves a completed handoff note and accepts its identical replay', async () => {
  mockState.results = [[], [{ ...shift, status: 'completed' }]];
  expect((await patch('completed', 'changed')).status).toBe(409);
  mockState.results = [[], [{ ...shift, status: 'completed' }]];
  expect((await patch('completed', 'handoff')).status).toBe(200);
  expect(mockState.updates).toHaveLength(0);
});
it('saves the handoff note atomically with completion', async () => {
  mockState.results = [[], [shift], [{ ...shift, status: 'completed', note: 'Next operator context' }]];
  expect((await patch('completed', 'Next operator context')).status).toBe(200);
  expect(mockState.updates).toEqual([expect.objectContaining({ status: 'completed', note: 'Next operator context' })]);
});
