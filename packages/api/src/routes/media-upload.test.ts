import { beforeEach, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';
import { mockState, mockDbFactory } from './test-utils.js';
const store = vi.hoisted(() => vi.fn());
vi.mock('@axiom/db', () => mockDbFactory());
vi.mock('@axiom/worker', () => ({ storeGeneratedAsset: store }));
vi.mock('./helpers.js', async original => ({ ...await original<typeof import('./helpers.js')>(), writeAudit: vi.fn() }));
import { mediaUploadRouter } from './media-upload.js';
const modelId = '22222222-2222-4222-8222-222222222222';
function app(auth = true, bounded = true) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    if (auth) { c.set('orgId', '11111111-1111-4111-8111-111111111111'); c.set('userId', 'operator'); }
    // Unit fixture for the assembled app's separately tested body boundary.
    if (bounded) await c.req.arrayBuffer();
    await next();
  });
  return app.route('/', mediaUploadRouter);
}
function request(server = app(), sanitize = 'true', type = 'image/png') {
  return server.request(`/models/${modelId}/media-upload?sanitize=${sanitize}`, {
    method: 'POST', headers: { 'content-type': type }, body: new Uint8Array(24),
  });
}
beforeEach(() => {
  mockState.result = [{ id: modelId }]; mockState.results = []; store.mockReset();
  store.mockResolvedValue({ storageKey: 'generated/unit.png', fileName: 'unit.png', mimeType: 'image/png',
    sha256: Buffer.alloc(32), fileSize: 24 });
});
it.each(['true', 'false'])('passes the exact upload privacy choice %s to storage', async selection => {
  const response = await request(app(), selection);
  expect(response.status).toBe(201);
  expect(store).toHaveBeenCalledWith(expect.objectContaining({ mimeType: 'image/png' }),
    expect.objectContaining({ modelId, sanitizeMetadata: selection === 'true' }));
  expect(await response.json()).toMatchObject({ data: { sanitized: selection === 'true', tosStatus: 'not-scanned' } });
});
it('does not store unauthenticated uploads', async () => {
  expect((await request(app(false))).status).toBe(401); expect(store).not.toHaveBeenCalled();
});
it('does not store media for an inaccessible model', async () => {
  mockState.result = [];
  expect((await request()).status).toBe(404); expect(store).not.toHaveBeenCalled();
});
it('fails closed if the bounded body middleware is absent', async () => {
  expect((await request(app(true, false))).status).toBe(503); expect(store).not.toHaveBeenCalled();
});
it('never falls back to the original after sanitizer failure', async () => {
  store.mockRejectedValue(new Error('failed decode'));
  expect((await request()).status).toBe(422); expect(store).toHaveBeenCalledOnce();
});
it('rejects unsupported formats and ambiguous privacy choices', async () => {
  expect((await request(app(), 'true', 'image/svg+xml')).status).toBe(415);
  expect((await request(app(), 'yes')).status).toBe(400); expect(store).not.toHaveBeenCalled();
});
