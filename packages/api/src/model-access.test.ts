import { expect, it } from 'vitest';
import { scopedReadTarget, isScopedHumanRole } from './model-access.js';
const id = '11111111-1111-4111-8111-111111111111';
it.each(['chatter', 'content_creator', 'model'] as const)('denies unclassified routes and all writes for staged role %s', role => {
  for (const path of ['/api/v1/audit', '/api/v1/org-settings', '/api/v1/llm/generate', '/api/v1/bundles', `/api/v1/models/${id}/network`, `/api/v1/models/${id}/member-assignments`, `/api/v1/models/${id}/unknown`, `/api/v1/models/${id}/fans/extra`])
    expect(scopedReadTarget(role, 'GET', path)).toBeNull();
  for (const method of ['POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'])
    expect(scopedReadTarget(role, method, `/api/v1/models/${id}`)).toBeNull();
  expect(scopedReadTarget(role, 'GET', '/api/v1/models')).toBe('discovery');
  expect(scopedReadTarget(role, 'HEAD', `/api/v1/models/${id}`)).toBe(id);
});
it('matches only blueprint read surfaces for each role', () => {
  expect(scopedReadTarget('chatter', 'GET', `/api/v1/models/${id}/calendar`)).toBeNull();
  expect(scopedReadTarget('content_creator', 'GET', `/api/v1/models/${id}/fans`)).toBeNull();
  expect(scopedReadTarget('model', 'GET', `/api/v1/models/${id}/fans`)).toBe(id);
  expect(scopedReadTarget('model', 'GET', '/api/v1/models/not-a-uuid')).toBeNull();
  expect(isScopedHumanRole('owner')).toBe(false);
  expect(isScopedHumanRole(null)).toBe(false);
});
