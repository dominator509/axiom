import { beforeEach, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';
import { mockState, mockDbFactory } from './test-utils.js';
const provider = vi.hoisted(() => vi.fn());
vi.mock('@axiom/db', () => mockDbFactory());
vi.mock('@axiom/worker', () => ({ inboxForConnection: provider }));
import { inboxRouter } from './inbox.js';
import { scopedReadTarget } from '../model-access.js';
const model = '22222222-2222-4222-8222-222222222222';
const account = '33333333-3333-4333-8333-333333333333';
const user = '44444444-4444-4444-8444-444444444444';
const path = `/models/${model}/inbox`;
function app(role = 'owner', authenticated = true) {
  const a = new Hono<AppBindings>();
  a.use('*', async (c, next) => {
    if (authenticated) { c.set('orgId', '11111111-1111-4111-8111-111111111111'); c.set('userId', 'user-1'); }
    c.set('role', role as AppBindings['Variables']['role']); await next();
  });
  a.route('/', inboxRouter); return a;
}
function results(...queries: unknown[]) { mockState.results = queries.flatMap(q => [[], q]); }
beforeEach(() => { mockState.results = []; mockState.result = []; provider.mockReset(); });
it('requires authentication', async () => {
  expect((await app('owner', false).request(path)).status).toBe(401);
  expect(provider).not.toHaveBeenCalled();
});
it.each(['analyst', 'agent', 'content_creator', 'unknown'])('denies %s before provider access', async role => {
  expect((await app(role).request(path)).status).toBe(403);
  expect(provider).not.toHaveBeenCalled();
});
it('permits scoped model/chatter reads only', () => {
  for (const role of ['model', 'chatter'] as const) {
    expect(scopedReadTarget(role, 'GET', `/api/v1${path}`)).toBe(model);
    expect(scopedReadTarget(role, 'POST', `/api/v1${path}`)).toBeNull();
  }
  expect(scopedReadTarget('content_creator', 'GET', `/api/v1${path}`)).toBeNull();
});
it.each(['page=0', 'page=1.5', 'page=1000000', 'connectionId=bad', `userUuid=${user}`])('validates %s before provider access', async query => {
  expect((await app().request(`${path}?${query}`)).status).toBe(400);
  expect(provider).not.toHaveBeenCalled();
});
it('lists accounts without fetching any private conversations', async () => {
  results([{ id: model }], [{ id: account, displayName: 'Fanvue' }]);
  const response = await app('chatter').request(path);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(await response.json()).toEqual({ data: { accounts: [{ id: account, displayName: 'Fanvue' }] } });
  expect(provider).not.toHaveBeenCalled();
});
it('denies unavailable model or selected account before provider access', async () => {
  results([]);
  expect((await app('chatter').request(path)).status).toBe(404);
  results([{ id: model }], []);
  expect((await app().request(`${path}?connectionId=${account}`)).status).toBe(404);
  expect(provider).not.toHaveBeenCalled();
});
it('binds the counterpart and page to the exact selected account without leaking credentials', async () => {
  const row = { id: account, encToken: 'never-serialize' };
  results([{ id: model }], [row], [{ id: model }], [{ id: account }]);
  provider.mockResolvedValue({ kind: 'messages', data: [], pagination: { page: 2, size: 0, hasMore: false } });
  const response = await app('chatter').request(`${path}?connectionId=${account}&userUuid=${user}&page=2`);
  expect(response.status).toBe(200);
  expect(provider).toHaveBeenCalledWith(row, 2, user);
  expect(await response.text()).not.toContain('never-serialize');
});
it('does not return messages after shift expiry or assignment revocation', async () => {
  results([{ id: model }], [{ id: account }], []);
  provider.mockResolvedValue({ privateText: 'must-not-return' });
  const response = await app('chatter').request(`${path}?connectionId=${account}`);
  expect(response.status).toBe(404);
  expect(await response.text()).not.toContain('must-not-return');
});
it('does not return messages after account revocation', async () => {
  results([{ id: model }], [{ id: account }], [{ id: model }], []);
  provider.mockResolvedValue({ privateText: 'must-not-return' });
  expect((await app().request(`${path}?connectionId=${account}`)).status).toBe(404);
});
it('returns a private failure, not an empty inbox, when provider access fails', async () => {
  results([{ id: model }], [{ id: account }]);
  provider.mockRejectedValue(new Error('private-provider-details'));
  const response = await app().request(`${path}?connectionId=${account}`);
  expect(response.status).toBe(502);
  expect(await response.text()).not.toContain('private-provider-details');
});
