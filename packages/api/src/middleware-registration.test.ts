import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

// Use the real application's declared paths and Hono matching semantics:
// wildcard middleware also matches its base path.
const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
const paths = [...source.matchAll(/app\.use\('([^']+)', idempotency\(\)\);/g)].map((match) => match[1]);

describe('application idempotency registration', () => {
  it.each([
    '/api/v1/models',
    '/api/v1/models/model',
    '/api/v1/models/model/generate',
    '/api/v1/models/model/generate/child',
    '/api/v1/models/model/network',
    '/api/v1/bundles/bundle/approve',
    '/api/v1/bundles/bundle/revise',
    '/api/v1/bundles/bundle/reject',
  ])('runs exactly one idempotency layer for %s', async (path) => {
    expect(paths.length).toBeGreaterThan(0);
    const app = new Hono();
    let matched = 0;
    for (const pattern of paths) app.use(pattern, async (_c, next) => {
      matched++;
      await next();
    });
    app.post('*', (c) => c.json({ ok: true }));
    expect((await app.request(path, { method: 'POST' })).status).toBe(200);
    expect(matched).toBe(1);
  });
});
