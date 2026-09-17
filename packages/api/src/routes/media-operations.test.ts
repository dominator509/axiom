import { beforeEach, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';
import { mockDbFactory, mockState } from './test-utils.js';
vi.mock('@axiom/db', () => mockDbFactory());
vi.mock('@axiom/worker', () => ({ enqueueJob: vi.fn() }));
import { enqueueJob } from '@axiom/worker';
import { mediaOperationsRouter } from './media-operations.js';
const id = '11111111-1111-4111-8111-111111111111';
function request(body: unknown) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => { c.set('orgId', id); await next(); });
  app.route('/', mediaOperationsRouter);
  return app.request(`/models/${id}/media-operations?assetId=${id}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}
beforeEach(() => { vi.clearAllMocks(); mockState.results = []; mockState.result = []; });
it.each([[16385, 1], [1, 16385], [4097, 4096], [0, 100]])('rejects unsafe output %sx%s before queueing', async (width, height) => {
  expect((await request({ type: 'image_resize', width, height })).status).toBe(400);
  expect(enqueueJob).not.toHaveBeenCalled();
});
it.each([[11, 0, 90, 100], [0, 1, 100, 100]])('rejects a crop outside source bounds', async (x, y, width, height) => {
  mockState.results = [[], [{ id, kind: 'image', width: 100, height: 100 }]];
  expect((await request({ type: 'image_clip', x, y, width, height })).status).toBe(400);
  expect(enqueueJob).not.toHaveBeenCalled();
});
it('does not guess missing source dimensions', async () => {
  mockState.results = [[], [{ id, kind: 'image', width: null, height: null }]];
  expect((await request({ type: 'image_clip', x: 0, y: 0, width: 10, height: 10 })).status).toBe(409);
  expect(enqueueJob).not.toHaveBeenCalled();
});
it('queues a crop that reaches the exact source edge', async () => {
  mockState.results = [[], [{ id, kind: 'image', width: 100, height: 100 }], [{ id, type: 'image_clip' }]];
  expect((await request({ type: 'image_clip', x: 10, y: 20, width: 90, height: 80 })).status).toBe(202);
  expect(enqueueJob).toHaveBeenCalledOnce();
});
