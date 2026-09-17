import { expect, it } from 'vitest';
import { scopedReadTarget, isScopedHumanRole } from './model-access.js';
const id = '11111111-1111-4111-8111-111111111111';
it.each(['chatter', 'content_creator', 'model'] as const)('denies unclassified routes and all writes for staged role %s', role => {
  for (const path of ['/api/v1/audit', '/api/v1/org-settings', '/api/v1/llm/generate', `/api/v1/bundles/${id}/approve`, `/api/v1/models/${id}/network`, `/api/v1/models/${id}/member-assignments`, `/api/v1/models/${id}/unknown`, `/api/v1/models/${id}/fans/extra`])
    expect(scopedReadTarget(role, 'GET', path)).toBeNull();
  for (const method of ['POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'])
    expect(scopedReadTarget(role, method, `/api/v1/models/${id}`)).toBeNull();
  expect(scopedReadTarget(role, 'GET', '/api/v1/models')).toBe('discovery');
  expect(scopedReadTarget(role, 'HEAD', `/api/v1/models/${id}`)).toBe(id);
});
it('allows media reads only for models and creators, never publishing or malformed paths', () => {
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
