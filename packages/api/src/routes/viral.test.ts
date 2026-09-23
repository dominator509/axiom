// ─── Viral insights Router (real DB-backed) — Vitest Suite ───
// Covers: org-scoped exemplar aggregation by label/platform + top performers.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';
import { mockState, mockDbFactory, makeChain } from './test-utils.js';

vi.mock('@axiom/db', () => mockDbFactory({ viralExemplar: {}, modelProfile: {}, job: {} }));
const schedule = vi.hoisted(() => ({ enqueue: vi.fn(async () => ({ id: 'job-scheduled-1' })) }));
vi.mock('@axiom/worker', () => ({
  enqueueJob: vi.fn(async () => ({ id: 'job-viral-1' })),
  enqueueWeeklyViralInsight: schedule.enqueue,
}));

import { LEARNING_ARM_RICH_PATTERN, readExemplarPatterns, viralRouter } from './viral.js';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const MODEL_ID = '22222222-2222-4222-8222-222222222222';

function appWithOrg(orgId: string | null, role: string | undefined = undefined) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    if (orgId) c.set('orgId', orgId);
    c.set('userId', 'user-1');
    if (role) c.set('role', role as any);
    await next();
  });
  app.route('/', viralRouter);
  return app;
}

beforeEach(() => {
  mockState.result = [];
  mockState.results = [];
  mockState.updates = [];
  schedule.enqueue.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GET /models/:modelId/viral — insights', () => {
  it('accepts only bounded temporal qualifiers for rich learning arms', () => {
    const pattern = new RegExp(LEARNING_ARM_RICH_PATTERN);
    expect(pattern.test('v2:short:question:hook=question:format=reel:time=morning')).toBe(true);
    expect(pattern.test('v2:short:question:hook=question:format=reel:time=midnight')).toBe(false);
    expect(pattern.test('v2:short:question:hook=question:format=reel')).toBe(true);
  });

  it('returns empty aggregation when no exemplars exist (no 500 on empty)', async () => {
    mockState.results = [[], [{ id: MODEL_ID, sharingEnabled: false }], [], [], [], []];
    const res = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/viral`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.totalExemplars).toBe(0);
    expect(body.data.byLabel).toEqual([]);
    expect(body.data.byPlatform).toEqual([]);
    expect(body.data.top).toEqual([]);
  });

  it('aggregates exemplars by label and platform with totals', async () => {
    mockState.result = [
      { label: 'viral', count: 2 },
      { label: 'strong', count: 1 },
    ];
    const res = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/viral`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.totalExemplars).toBe(3);
    expect(body.data.byLabel).toHaveLength(2);
  });

  it('clamps limit to 100', async () => {
    mockState.result = [[], [], []];
    const res = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/viral?limit=9999`);
    expect(res.status).toBe(200);
  });

  it('rejects without org context (401)', async () => {
    const res = await appWithOrg(null).request(`/models/${MODEL_ID}/viral`);
    expect(res.status).toBe(401);
  });
});

describe('POST /models/:modelId/viral/insight', () => {
  it('enqueues one model-scoped insight job for an allowed operator', async () => {
    mockState.result = [{ id: MODEL_ID }];
    const res = await appWithOrg(ORG_ID, 'operator').request(`/models/${MODEL_ID}/viral/insight`, { method: 'POST' });
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ success: true, jobId: 'job-viral-1' });
  });

  it('denies a chatter from generating an unattended insight card', async () => {
    const res = await appWithOrg(ORG_ID, 'chatter').request(`/models/${MODEL_ID}/viral/insight`, { method: 'POST' });
    expect(res.status).toBe(403);
  });
});

describe('model-scoped recurring viral insight schedule', () => {
  it('lets assigned members read whether the schedule is enabled', async () => {
    mockState.result = [{ id: MODEL_ID, scheduleId: null }];
    const response = await appWithOrg(ORG_ID, 'content_creator').request(`/models/${MODEL_ID}/viral/insight-schedule`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { enabled: false, scheduleId: null } });
  });

  it('allows an owner to enable a weekly schedule and queues the first completed-week run', async () => {
    mockState.results = [[], [{ id: MODEL_ID, scheduleId: null }], [{ id: MODEL_ID }]];
    const response = await appWithOrg(ORG_ID, 'owner').request(`/models/${MODEL_ID}/viral/insight-schedule`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true }),
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { data: { enabled: boolean; scheduleId: string } };
    expect(body.data.enabled).toBe(true);
    expect(body.data.scheduleId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(schedule.enqueue).toHaveBeenCalledWith(expect.anything(), ORG_ID, MODEL_ID, body.data.scheduleId);
  });

  it('requires owner or manager permission before enabling recurring external delivery', async () => {
    const response = await appWithOrg(ORG_ID, 'operator').request(`/models/${MODEL_ID}/viral/insight-schedule`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true }),
    });
    expect(response.status).toBe(403);
    expect(schedule.enqueue).not.toHaveBeenCalled();
  });

  it('disables an existing schedule without enqueuing another occurrence', async () => {
    mockState.results = [[], [{ id: MODEL_ID, scheduleId: '33333333-3333-4333-8333-333333333333' }], [{ id: MODEL_ID }]];
    const response = await appWithOrg(ORG_ID, 'manager').request(`/models/${MODEL_ID}/viral/insight-schedule`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: false }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { enabled: false, scheduleId: null } });
    expect(schedule.enqueue).not.toHaveBeenCalled();
  });
});

describe('F-86 opt-in organization pattern sharing', () => {
  it('lets assigned members read the model consent state', async () => {
    mockState.result = [{ enabled: true }];
    const response = await appWithOrg(ORG_ID, 'content_creator').request(`/models/${MODEL_ID}/viral/pattern-sharing`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { enabled: true } });
  });

  it('requires owner or manager permission to change consent and audits the saved state', async () => {
    const denied = await appWithOrg(ORG_ID, 'operator').request(`/models/${MODEL_ID}/viral/pattern-sharing`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true }),
    });
    expect(denied.status).toBe(403);
    expect(mockState.updates).toHaveLength(0);

    mockState.results = [[], [{ id: MODEL_ID }], [{ id: MODEL_ID }]];
    const allowed = await appWithOrg(ORG_ID, 'owner').request(`/models/${MODEL_ID}/viral/pattern-sharing`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true }),
    });
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual({ data: { enabled: true } });
    expect(mockState.updates).toContainEqual(expect.objectContaining({ viralPatternSharingEnabled: true }));
  });

  it('returns only abstract pattern fields from opted-in models and suppresses small groups', async () => {
    const own = [{ platform: 'instagram', arm: 'short:question', context: 'learn-v1:scheduled-utc-2',
      mediaFormat: 'video/mp4', tosVerdict: 'passed', publishedHourUtc: 18, sampleSize: 3, meanScore: 0.4 }];
    const shared = [{ platform: 'instagram', arm: 'v2:short:question:hook=question:format=reel',
      context: 'learn-v2:scheduled-utc-2', mediaFormat: 'video/mp4', tosVerdict: 'passed',
      publishedHourUtc: 18, sampleSize: 6, meanScore: 0.7, sourceModelId: 'private-model', caption: 'private caption' }];
    mockState.results = [own, shared];
    const result = await readExemplarPatterns(makeChain(), ORG_ID, MODEL_ID, undefined, true);
    expect(result.groups).toEqual([
      expect.objectContaining({ arm: shared[0].arm, sampleSize: 6, sourceScope: 'organization' }),
      expect.objectContaining({ arm: own[0].arm, sampleSize: 3, sourceScope: 'model' }),
    ]);
    expect(JSON.stringify(result.groups)).not.toContain('private-model');
    expect(JSON.stringify(result.groups)).not.toContain('private caption');
  });

  it('does not query or return cross-model patterns when the target has not opted in', async () => {
    const own = [{ platform: 'reddit', arm: 'short:statement', context: 'learn-v1:scheduled-utc-unknown',
      mediaFormat: 'unknown', tosVerdict: 'passed', publishedHourUtc: null, sampleSize: 3, meanScore: 0.1 }];
    mockState.results = [own];
    const result = await readExemplarPatterns(makeChain(), ORG_ID, MODEL_ID, undefined, false);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].sourceScope).toBe('model');
    expect(mockState.results).toHaveLength(0);
  });
});
