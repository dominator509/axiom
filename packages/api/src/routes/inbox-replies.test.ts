import { beforeEach, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';
const { dispatch, cancel } = vi.hoisted(() => ({ dispatch: vi.fn(), cancel: vi.fn() }));
vi.mock('../reply-dispatch.js', () => ({ dispatchReply: dispatch, cancelReply: cancel }));
import { inboxRepliesRouter } from './inbox-replies.js';
const id = '11111111-1111-4111-8111-111111111111';
function request(role: AppBindings['Variables']['role'] = 'operator', body: unknown = { confirm: true }, userId = 'actor', replyId = id, action = 'send') {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => { c.set('orgId', id); c.set('userId', userId); c.set('role', role); await next(); });
  app.route('/', inboxRepliesRouter);
  return app.request(`/models/${id}/inbox/replies/${replyId}/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
beforeEach(() => { dispatch.mockReset(); cancel.mockReset(); });
it('cancels only through explicit authenticated confirmation without calling dispatch', async () => {
  cancel.mockResolvedValue({ outcome: 'cancelled', replyId: id });
  expect((await request('operator', { confirm: false }, 'actor', id, 'cancel')).status).toBe(400);
  expect((await request('model', { confirm: true }, 'actor', id, 'cancel')).status).toBe(403);
  const response = await request('chatter', { confirm: true }, 'actor', id, 'cancel');
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ data: { replyId: id, state: 'cancelled' } });
  expect(cancel).toHaveBeenCalledExactlyOnceWith({ orgId: id, modelId: id, userId: 'actor', replyId: id });
  expect(dispatch).not.toHaveBeenCalled();
});
it('reports cancellation conflicts and unknown outcomes without private details', async () => {
  cancel.mockResolvedValueOnce({ outcome: 'already-dispatched' }).mockResolvedValueOnce({ outcome: 'denied' }).mockRejectedValueOnce(new Error('private-db'));
  for (const status of [409, 404, 503]) {
    const response = await request('operator', { confirm: true }, 'actor', id, 'cancel');
    expect(response.status).toBe(status); expect(await response.text()).not.toContain('private-db');
  }
});
it.each(['owner', 'manager', 'operator', 'chatter'] as const)('dispatches only the authenticated actor and saved reply for %s', async role => {
  dispatch.mockResolvedValue({ outcome: 'finished', replyId: id, state: 'sent', privateField: 'secret' });
  const response = await request(role);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(await response.json()).toEqual({ data: { replyId: id, state: 'sent' } });
  expect(dispatch).toHaveBeenCalledExactlyOnceWith({ orgId: id, modelId: id, userId: 'actor', replyId: id });
});
it.each(['model', 'content_creator', 'analyst', 'agent'] as const)('denies %s before dispatch', async role => {
  expect((await request(role)).status).toBe(403); expect(dispatch).not.toHaveBeenCalled();
});
it('requires identity, explicit confirmation, immutable content and valid IDs', async () => {
  expect((await request('owner', { confirm: true }, '')).status).toBe(401);
  for (const body of [{}, { confirm: false }, { confirm: true, body: 'replacement' }, { confirm: true, userId: 'other' }]) expect((await request('owner', body)).status).toBe(400);
  expect((await request('owner', { confirm: true }, 'actor', 'invalid')).status).toBe(400);
  expect(dispatch).not.toHaveBeenCalled();
});
it.each([['denied', 404], ['halted', 409], ['consent-required', 409], ['account-unavailable', 409], ['already-dispatched', 409], ['unavailable', 503], ['unconfirmed', 503]])('maps %s without a retry or private details', async (outcome, status) => {
  dispatch.mockResolvedValue({ outcome, secret: 'private-token' });
  const response = await request();
  expect(response.status).toBe(status); expect(await response.text()).not.toContain('private-token'); expect(dispatch).toHaveBeenCalledOnce();
});
it('keeps a persistence exception uncertain instead of retrying the provider', async () => {
  dispatch.mockRejectedValue(new Error('private-database-detail'));
  const response = await request();
  expect(response.status).toBe(503); expect(await response.text()).not.toContain('private-database-detail'); expect(dispatch).toHaveBeenCalledOnce();
});
