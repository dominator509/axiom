import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { mockDbFactory, mockState } from './routes/test-utils.js';

vi.mock('@axiom/db', () => mockDbFactory({ crashReport: {} }));

import {
  captureUnhandledApiError,
  describeCrash,
  redactCrashValue,
  recordCrashReport,
} from './crash-reporter.js';
import { correlationId, onError } from './contract.js';

const ORG_ID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  mockState.result = [];
  mockState.results = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('crash reporter', () => {
  it('redacts credential-shaped values from automatic reports', () => {
    const details = describeCrash(
      new Error('request failed Authorization: Bearer secret access_token=token-value'),
    );

    expect(details.message).toContain('Authorization: [REDACTED]');
    expect(details.message).toContain('access_token=[REDACTED]');
    expect(details.message).not.toContain('secret');
    expect(details.stacktrace[0]?.text).not.toContain('token-value');
  });

  it('redacts quoted JSON credentials and credential-bearing URLs', () => {
    const details = describeCrash(
      new Error(
        'provider response {"access_token":"json-secret","refresh_token":"refresh-secret"} https://provider.test/callback?access_token=query-secret&ok=true',
      ),
    );

    expect(details.message).not.toContain('json-secret');
    expect(details.message).not.toContain('refresh-secret');
    expect(details.message).not.toContain('query-secret');
    expect(details.message).toContain('"access_token":"[REDACTED]"');
    expect(details.message).toContain('access_token=[REDACTED]');
  });

  it('redacts credentials from client-supplied structured crash details', () => {
    const value = redactCrashValue({
      authorization: 'Bearer client-secret',
      nested: {
        access_token: 'access-secret',
        note: 'request failed token=query-secret',
      },
    }) as Record<string, unknown>;

    expect(value.authorization).toBe('[REDACTED]');
    expect((value.nested as Record<string, unknown>).access_token).toBe('[REDACTED]');
    expect((value.nested as Record<string, unknown>).note).toContain('token=[REDACTED]');
    expect(JSON.stringify(value)).not.toContain('client-secret');
    expect(JSON.stringify(value)).not.toContain('access-secret');
    expect(JSON.stringify(value)).not.toContain('query-secret');
  });

  it('bounds nested crash collections and object depth', () => {
    const value = redactCrashValue({
      frames: Array.from({ length: 60 }, (_, index) => ({ index })),
      deep: { a: { b: { c: { d: { e: { f: { g: { h: 'secret' } } } } } } } },
    }) as Record<string, unknown>;

    expect((value.frames as unknown[]).length).toBe(50);
    expect(JSON.stringify(value)).toContain('[TRUNCATED]');
  });

  it('writes an org-scoped automatic crash report through the existing sink', async () => {
    mockState.results = [[], [{ id: 'crash-1', count: 1 }]];
    const { db } = await import('@axiom/db');

    await captureUnhandledApiError(ORG_ID, new Error('worker request failed'), 'corr-1');

    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it('does not attempt a tenant write when no request organization exists', async () => {
    const { db } = await import('@axiom/db');

    await captureUnhandledApiError(undefined, new Error('unauthenticated failure'), 'corr-2');

    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('captures an authenticated unhandled API error before returning RFC-7807', async () => {
    mockState.results = [[], [{ id: 'crash-1', count: 1 }]];
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = new Hono<{ Variables: { orgId: string; correlationId: string } }>();
    app.use('*', correlationId);
    app.use('*', async (c, next) => {
      c.set('orgId', ORG_ID);
      await next();
    });
    app.onError(onError);
    app.get('/boom', () => {
      throw new Error('boom');
    });

    const response = await app.request('/boom', {
      headers: { 'X-Correlation-ID': 'corr-api' },
    });

    expect(response.status).toBe(500);
    expect(response.headers.get('Content-Type')).toMatch(/^application\/problem\+json/);
    expect(response.headers.get('X-Correlation-ID')).toBe('corr-api');
    expect(consoleError).toHaveBeenCalled();
  });
});

describe('recordCrashReport', () => {
  it('returns the grouped row from the atomic upsert', async () => {
    mockState.results = [[], [{ id: 'crash-1', count: 3 }]];

    const report = await recordCrashReport({
      orgId: ORG_ID,
      eventId: 'evt-1',
      service: 'api',
      message: 'boom',
      stacktrace: [{ text: 'Error: boom' }],
      correlationId: 'corr-3',
    });

    expect(report).toEqual({ id: 'crash-1', count: 3 });
  });
});
