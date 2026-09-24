import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';
import { mockDbFactory, mockState } from './test-utils.js';

vi.mock('@axiom/db', () => mockDbFactory());

import { reportsRouter } from './reports.js';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const MODEL_ID = '22222222-2222-4222-8222-222222222222';

function appWithOrg(orgId: string | null, userId?: string) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    if (orgId) {
      c.set('orgId', orgId);
      if (userId) c.set('userId', userId);
    }
    await next();
  });
  app.route('/', reportsRouter);
  return app;
}

beforeEach(() => { mockState.result = []; mockState.results = []; });
afterEach(() => { vi.restoreAllMocks(); });

describe('GET /models/:modelId/reports/monthly', () => {
  it('requires an authenticated organization and validates the model id', async () => {
    expect((await appWithOrg(null).request(`/models/${MODEL_ID}/reports/monthly`)).status).toBe(401);
    expect((await appWithOrg(ORG_ID).request('/models/not-a-uuid/reports/monthly')) .status).toBe(400);
  });

  it('returns a private PDF built from the selected month analytics', async () => {
    mockState.results = [[], [], [{
      displayName: 'Luna', scheduledPosts: 4, publishedPosts: 3,
      views: '1200', likes: '100', shares: '20', comments: '30',
      adherenceScore: 84, viralExemplars: 2,
    }]];
    const response = await appWithOrg(ORG_ID, 'user-1').request(`/models/${MODEL_ID}/reports/monthly?month=2026-09`, {
      headers: { 'accept-language': 'de' },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/pdf');
    expect(response.headers.get('content-disposition')).toContain('fanthynks-2026-09-monthly-report.pdf');
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 8))).toBe('%PDF-1.4');
    expect(new TextDecoder().decode(bytes)).toContain('FanThynks');
    expect(new TextDecoder().decode(bytes)).toContain('FEFF004700650070006C0061006E0074006500200042006500690074');
  });

  it('prefers the persisted user locale over the browser hint', async () => {
    mockState.results = [[], [{ scope: 'user', locale: 'es', userId: 'user-1' }], [{
      displayName: 'Luna', scheduledPosts: 1, publishedPosts: 1,
      views: 1, likes: 2, shares: 3, comments: 4,
      adherenceScore: 80, viralExemplars: 0,
    }]];
    const response = await appWithOrg(ORG_ID, 'user-1').request(`/models/${MODEL_ID}/reports/monthly?month=2026-09`, {
      headers: { 'accept-language': 'de' },
    });
    expect(response.status).toBe(200);
    const pdf = new TextDecoder().decode(await response.arrayBuffer());
    expect(pdf).toContain('(FanThynks - Informe mensual de rendimiento)');
    expect(pdf).not.toContain('Monatlicher Leistungsbericht');
  });

  it('rejects malformed months before querying the database', async () => {
    const response = await appWithOrg(ORG_ID).request(`/models/${MODEL_ID}/reports/monthly?month=2026-13`);
    expect(response.status).toBe(400);
    expect(mockState.results).toEqual([]);
  });
});
