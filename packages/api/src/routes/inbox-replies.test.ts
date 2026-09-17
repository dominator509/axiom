import { beforeEach, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';
const dispatch = vi.hoisted(() => vi.fn());
vi.mock('../reply-dispatch.js', () => ({ dispatchReply: dispatch }));
import { inboxRepliesRouter } from './inbox-replies.js';
const id = '11111111-1111-4111-8111-111111111111';
function request(role: AppBindings['Variables']['role'] = 'operator', body: unknown = { confirm: true }, userId = 'actor', replyId = id) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => { c.set('orgId', id); c.set('userId', userId); c.set('role', role); await next(); });
  app.route('/', inboxRepliesRouter);
  return app.request(`/models/${id}/inbox/replies/${replyId}/send`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
beforeEach(() => { dispatch.mockReset(); });
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
