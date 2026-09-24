import { beforeEach, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';
import { mockState, mockDbFactory } from './test-utils.js';
const provider = vi.hoisted(() => vi.fn());
vi.mock('@axiom/db', () => mockDbFactory());
vi.mock('@axiom/worker', () => ({ earningsForConnection: provider }));
import { earningsRouter } from './earnings.js';
import { scopedReadTarget } from '../model-access.js';
const modelId = '22222222-2222-4222-8222-222222222222';
const connectionId = '33333333-3333-4333-8333-333333333333';
const base = `/models/${modelId}/earnings`;
function app(role = 'owner', authenticated = true) {
  const a = new Hono<AppBindings>();
  a.use('*', async (c, next) => {
    if (authenticated) { c.set('orgId', '11111111-1111-4111-8111-111111111111'); c.set('userId', 'user-1'); }
    c.set('role', role as AppBindings['Variables']['role']);
    await next();
  });
  a.route('/', earningsRouter);
  return a;
}
// Each withOrgContext consumes one set_config result before its query.
function results(...queries: unknown[]) { mockState.results = queries.flatMap(q => [[], q]); }
beforeEach(() => { mockState.results = []; mockState.result = []; provider.mockReset(); });
it('requires a signed-in workspace', async () => {
  expect((await app('owner', false).request(base)).status).toBe(401);
  expect(provider).not.toHaveBeenCalled();
});
it.each(['operator', 'analyst', 'agent', 'chatter', 'content_creator', 'unknown'])('denies financial reads for %s', async role => {
  expect((await app(role).request(base)).status).toBe(403);
  expect(provider).not.toHaveBeenCalled();
});
it('extends the scoped boundary only for model reads', () => {
  expect(scopedReadTarget('model', 'GET', `/api/v1${base}`)).toBe(modelId);
  for (const role of ['chatter', 'content_creator'] as const)
    expect(scopedReadTarget(role, 'GET', `/api/v1${base}`)).toBeNull();
  expect(scopedReadTarget('model', 'POST', `/api/v1${base}`)).toBeNull();
});
it('validates identifiers before database access', async () => {
  expect((await app().request(`${base}?connectionId=bad`)).status).toBe(400);
  expect(provider).not.toHaveBeenCalled();
});
it('requires an accessible model before looking up accounts', async () => {
  results([]);
  expect((await app('model').request(base)).status).toBe(404);
  expect(provider).not.toHaveBeenCalled();
});
it('lists account choices without contacting the provider', async () => {
  results([{ id: modelId }], [{ id: connectionId, displayName: 'Own account' }]);
  const response = await app().request(base);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(await response.json()).toEqual({ data: { accounts: [{ id: connectionId, displayName: 'Own account' }] } });
  expect(provider).not.toHaveBeenCalled();
});
it('does not choose an account implicitly', async () => {
  results([{ id: modelId }], []);
  expect(await (await app().request(base)).json()).toEqual({ data: { accounts: [] } });
  expect(provider).not.toHaveBeenCalled();
});
it('rejects unavailable selected accounts before decryption or network use', async () => {
  results([{ id: modelId }], []);
  expect((await app().request(`${base}?connectionId=${connectionId}`)).status).toBe(404);
  expect(provider).not.toHaveBeenCalled();
});
it('returns observed cents without serializing the credential row', async () => {
  const row = { id: connectionId, encToken: 'must-not-leak' };
  results([{ id: modelId }], [row], [{ id: modelId }], [{ id: connectionId }]);
  provider.mockResolvedValue({ totals: { allTime: { gross: 100, net: 80 } } });
  const response = await app('model').request(`${base}?connectionId=${connectionId}`);
  expect(response.status).toBe(200);
  const body = await response.text();
  expect(body).toContain('"unit":"cents"');
  expect(body).not.toContain('must-not-leak');
  expect(provider).toHaveBeenCalledWith(row);
});
it('discards data if the assignment is revoked during a provider read', async () => {
  results([{ id: modelId }], [{ id: connectionId }], []);
  provider.mockResolvedValue({ privateEarnings: 123 });
  const response = await app('model').request(`${base}?connectionId=${connectionId}`);
  expect(response.status).toBe(404);
  expect(await response.text()).not.toContain('privateEarnings');
});
it('discards data if the account is disconnected during a provider read', async () => {
  results([{ id: modelId }], [{ id: connectionId }], [{ id: modelId }], []);
  provider.mockResolvedValue({ privateEarnings: 123 });
  expect((await app().request(`${base}?connectionId=${connectionId}`)).status).toBe(404);
});
it('keeps provider errors private and does not claim zero earnings', async () => {
  results([{ id: modelId }], [{ id: connectionId }]);
  provider.mockRejectedValue(new Error('credential-secret'));
  const response = await app().request(`${base}?connectionId=${connectionId}`);
  expect(response.status).toBe(502);
  expect(await response.text()).not.toContain('credential-secret');
});
