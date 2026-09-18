import { beforeEach, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';
import { mockDbFactory, mockState } from './test-utils.js';

vi.mock('@axiom/db', () => mockDbFactory({ scrapeRun: {}, modelProfile: {}, job: {}, auditLog: {} }));
vi.mock('@axiom/worker', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  asPlatform: (value: string) => value,
  enqueueJob: vi.fn(),
}));

import { scrapeRouter } from './scrape.js';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const MODEL_ID = '22222222-2222-4222-8222-222222222222';
const RUN_ID = '33333333-3333-4333-8333-333333333333';

function appWithOrg(orgId: string | null) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    if (orgId) c.set('orgId', orgId);
    await next();
  });
  app.route('/', scrapeRouter);
  return app;
}

beforeEach(() => {
  mockState.result = [];
  mockState.results = [];
});

it('requires organization context for saved research history', async () => {
  expect((await appWithOrg(null).request(`/models/${MODEL_ID}/scrape-runs`)).status).toBe(401);
});

it('returns bounded research history with a continuation cursor', async () => {
  mockState.result = [{ id: RUN_ID, orgId: ORG_ID, modelId: MODEL_ID, kind: 'social', state: 'completed', createdAt: new Date('2026-09-17T00:00:00Z') }];
  const response = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/scrape-runs?limit=1`);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    data: [{ id: RUN_ID, state: 'completed' }],
    meta: { limit: 1, total: 1, next_cursor: expect.any(String) },
  });
});

it('returns an exhausted page without inventing a continuation', async () => {
  mockState.result = [{ id: RUN_ID, orgId: ORG_ID, modelId: MODEL_ID, kind: 'social', state: 'failed', createdAt: new Date('2026-09-17T00:00:00Z') }];
  const response = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/scrape-runs?cursor=invalid`);
  expect(response.status).toBe(200);
  expect((await response.json() as { meta: { next_cursor: string | null } }).meta.next_cursor).toBeNull();
});
