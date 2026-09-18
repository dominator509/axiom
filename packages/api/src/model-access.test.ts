import { expect, it } from 'vitest';
import { scopedReadTarget, isScopedHumanRole } from './model-access.js';
import { enforceModelAccess } from './model-access.js';
import { Hono } from 'hono';
import type { AppBindings } from './index.js';
const id = '11111111-1111-4111-8111-111111111111';
it('permits Chatter reply preparation only on the exact scoped conversation route', () => {
  const path = `/api/v1/models/${id}/inbox/replies`;
  for (const method of ['GET', 'HEAD', 'POST']) expect(scopedReadTarget('chatter', method, path)).toBe(id);
  for (const method of ['PUT', 'PATCH', 'DELETE']) expect(scopedReadTarget('chatter', method, path)).toBeNull();
  expect(scopedReadTarget('model', 'GET', path)).toBe(id);
  expect(scopedReadTarget('model', 'POST', path)).toBeNull();
  expect(scopedReadTarget('content_creator', 'GET', path)).toBeNull();
  expect(scopedReadTarget('chatter', 'POST', `${path}/${id}/send`)).toBe(id);
  expect(scopedReadTarget('chatter', 'POST', `${path}/${id}/cancel`)).toBe(id);
  expect(scopedReadTarget('model', 'POST', `${path}/${id}/cancel`)).toBeNull();
  for (const method of ['GET', 'HEAD', 'POST']) expect(scopedReadTarget('chatter', method, `${path}/${id}/reviews`)).toBe(id);
  expect(scopedReadTarget('model', 'GET', `${path}/${id}/reviews`)).toBe(id);
  expect(scopedReadTarget('model', 'POST', `${path}/${id}/reviews`)).toBeNull();
  expect(scopedReadTarget('content_creator', 'GET', `${path}/${id}/reviews`)).toBeNull();
  expect(scopedReadTarget('chatter', 'DELETE', `${path}/${id}/reviews`)).toBeNull();
  for (const role of ['model', 'content_creator'] as const) expect(scopedReadTarget(role, 'POST', `${path}/${id}/send`)).toBeNull();
  for (const method of ['GET', 'PUT', 'DELETE']) expect(scopedReadTarget('chatter', method, `${path}/${id}/send`)).toBeNull();
  for (const other of [`${path}/send`, `${path}/${id}`, '/api/v1/org-settings', '/api/v1/posts', `/api/v1/bundles/${id}/approve`])
    expect(scopedReadTarget('chatter', 'POST', other)).toBeNull();
});
it('allows only the creator own-user Grok lifecycle and storage, not arbitrary gateway work', () => {
  const base = '/api/v1/llm/subscriptions/grok';
  for (const [path, methods] of [[base, ['GET', 'HEAD', 'DELETE']], [`${base}/login-attempt`, ['GET', 'HEAD', 'POST']], [`${base}/login-attempt/${id}`, ['GET', 'HEAD', 'DELETE']]] as const)
    for (const method of methods) {
      expect(scopedReadTarget('content_creator', method, path)).toBe('self-subscription');
      for (const role of ['model', 'chatter'] as const) expect(scopedReadTarget(role, method, path)).toBeNull();
    }
  for (const [path, methods] of [[`${base}/r2-storage`, ['GET', 'HEAD', 'PUT', 'DELETE']], [`${base}/r2-storage/verify`, ['POST']]] as const)
    for (const method of methods) {
      expect(scopedReadTarget('content_creator', method, path)).toBe('self-subscription');
      for (const role of ['model', 'chatter'] as const) expect(scopedReadTarget(role, method, path)).toBeNull();
    }
  expect(scopedReadTarget('content_creator', 'POST', `${base}/r2-storage`)).toBeNull();
  for (const method of ['GET', 'PUT', 'DELETE', 'PATCH']) expect(scopedReadTarget('content_creator', method, `${base}/r2-storage/verify`)).toBeNull();
  for (const path of [`${base}/r2-storage/other-user`, `${base}/r2-storage/verify/extra`, `${base}/login`, `${base}/login-attempt/not-a-uuid`, `${base}/login-attempt/${id}/extra`, '/api/v1/llm/chat', '/api/v1/llm/subscriptions/openai'])
    for (const method of ['GET', 'POST', 'PUT', 'DELETE']) expect(scopedReadTarget('content_creator', method, path)).toBeNull();
});
it.each([['user', 'org', 200], ['', 'org', 401], ['user', '', 401]])('requires authenticated identity for own-user subscription (%s/%s)', async (userId, orgId, status) => {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => { c.set('role', 'content_creator'); c.set('userId', userId as string); c.set('orgId', orgId as string); await next(); });
  app.use('*', enforceModelAccess);
  app.get('/api/v1/llm/subscriptions/grok', c => c.json({ userId: c.get('userId') }));
  const response = await app.request('/api/v1/llm/subscriptions/grok?userId=other-user');
  expect(response.status).toBe(status);
  if (status === 200) expect(await response.json()).toEqual({ userId: 'user' });
});
it.each(['chatter', 'content_creator', 'model'] as const)('denies unclassified routes and all writes for staged role %s', role => {
  for (const path of ['/api/v1/audit', '/api/v1/org-settings', '/api/v1/llm/generate', `/api/v1/bundles/${id}/approve`, `/api/v1/models/${id}/network`, `/api/v1/models/${id}/member-assignments`, `/api/v1/models/${id}/unknown`, `/api/v1/models/${id}/fans/extra`])
    expect(scopedReadTarget(role, 'GET', path)).toBeNull();
  for (const method of ['POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'])
    expect(scopedReadTarget(role, method, `/api/v1/models/${id}`)).toBeNull();
  expect(scopedReadTarget(role, 'GET', '/api/v1/models')).toBe('discovery');
  expect(scopedReadTarget(role, 'HEAD', `/api/v1/models/${id}`)).toBe(id);
});
it('allows media reads only for models and creators, never publishing or malformed paths', () => {
  expect(scopedReadTarget('content_creator', 'PATCH', `/api/v1/bundles/${id}/draft`)).toBe(`bundle:${id}`);
  for (const role of ['chatter', 'model'] as const) expect(scopedReadTarget(role, 'PATCH', `/api/v1/bundles/${id}/draft`)).toBeNull();
  expect(scopedReadTarget('content_creator', 'POST', `/api/v1/bundles/${id}/draft`)).toBeNull();
  for (const role of ['model', 'content_creator'] as const) {
    expect(scopedReadTarget(role, 'GET', '/api/v1/bundles')).toBe('discovery');
    expect(scopedReadTarget(role, 'GET', `/api/v1/bundles/${id}/media`)).toBe(`bundle:${id}`);
    expect(scopedReadTarget(role, 'GET', `/api/v1/models/${id}/media/${id}`)).toBe(id);
    expect(scopedReadTarget(role, 'GET', `/api/v1/models/${id}/media/not-a-uuid`)).toBeNull();
    expect(scopedReadTarget(role, 'POST', `/api/v1/bundles/${id}/approve`)).toBeNull();
  }
  expect(scopedReadTarget('chatter', 'GET', '/api/v1/bundles')).toBeNull();
  expect(scopedReadTarget('chatter', 'GET', `/api/v1/models/${id}/media`)).toBeNull();
});
it('matches only blueprint read surfaces for each role', () => {
  expect(scopedReadTarget('chatter', 'GET', `/api/v1/fans/${id}`)).toBe(`fan:${id}`);
  expect(scopedReadTarget('model', 'GET', `/api/v1/fans/${id}`)).toBe(`fan:${id}`);
  expect(scopedReadTarget('content_creator', 'GET', `/api/v1/fans/${id}`)).toBeNull();
  expect(scopedReadTarget('chatter', 'POST', `/api/v1/fans/${id}/touchpoints`)).toBeNull();
  expect(scopedReadTarget('chatter', 'GET', `/api/v1/models/${id}/calendar`)).toBeNull();
  expect(scopedReadTarget('content_creator', 'GET', `/api/v1/models/${id}/fans`)).toBeNull();
  expect(scopedReadTarget('model', 'GET', `/api/v1/models/${id}/fans`)).toBe(id);
  expect(scopedReadTarget('model', 'GET', '/api/v1/models/not-a-uuid')).toBeNull();
  expect(isScopedHumanRole('owner')).toBe(false);
  expect(isScopedHumanRole(null)).toBe(false);
});
it('allows read-only model Relay-card history for every scoped human role', () => {
  const path = `/api/v1/models/${id}/relay-cards`;
  for (const role of ['chatter', 'content_creator', 'model'] as const) {
    expect(scopedReadTarget(role, 'GET', path)).toBe(id);
    expect(scopedReadTarget(role, 'HEAD', path)).toBe(id);
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) expect(scopedReadTarget(role, method, path)).toBeNull();
  }
  expect(scopedReadTarget('model', 'GET', `/api/v1/models/${id}/relay-cards/extra`)).toBeNull();
  expect(scopedReadTarget('model', 'GET', '/api/v1/models/not-a-uuid/relay-cards')).toBeNull();
});
it('permits only explicit creator preparation operations, not administrative or approval writes', () => {
  for (const action of ['generate', 'media-upload', 'media-operations']) {
    expect(scopedReadTarget('content_creator', 'POST', `/api/v1/models/${id}/${action}`)).toBe(id);
    expect(scopedReadTarget('model', 'POST', `/api/v1/models/${id}/${action}`)).toBeNull();
    expect(scopedReadTarget('chatter', 'POST', `/api/v1/models/${id}/${action}`)).toBeNull();
  }
  expect(scopedReadTarget('content_creator', 'POST', '/api/v1/bundles')).toBe('bundle-create');
  expect(scopedReadTarget('model', 'POST', '/api/v1/bundles')).toBeNull();
  expect(scopedReadTarget('chatter', 'POST', '/api/v1/bundles')).toBeNull();
  for (const path of ['/api/v1/posts', `/api/v1/bundles/${id}/approve`, `/api/v1/models/${id}/playbook-guidelines`, `/api/v1/models/${id}/generate/${id}/retry`, `/api/v1/models/${id}/network`])
    expect(scopedReadTarget('content_creator', 'POST', path)).toBeNull();
});
