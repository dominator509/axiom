import { Hono } from 'hono';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { API_JSON_MAX_BODY_BYTES, boundedJsonValidator } from './bounded-json-validator.js';
import { readBoundedBytes } from './webhook-body.js';

function createApp(cached = false) {
  const app = new Hono();
  if (cached) app.use('*', async (c, next) => {
    const bytes = await readBoundedBytes(c.req.raw, API_JSON_MAX_BODY_BYTES + 100);
    c.req.bodyCache.arrayBuffer = Promise.resolve(bytes.slice().buffer) as unknown as ArrayBuffer;
    await next();
  });
  app.post('/', boundedJsonValidator('json', z.object({ value: z.string().min(1) })), (c) =>
    c.json({ data: c.req.valid('json') }),
  );
  return app;
}

describe('bounded JSON validator', () => {
  it('validates bytes already consumed and cached by idempotency middleware', async () => {
    const response = await createApp(true).request('/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'cached payload' }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { value: 'cached payload' } });
  });

  it('still bounds a previously cached body', async () => {
    const response = await createApp(true).request('/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'x'.repeat(API_JSON_MAX_BODY_BYTES) }),
    });
    expect(response.status).toBe(413);
  });
  it('preserves validated JSON route behavior', async () => {
    const response = await createApp().request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'ok' }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { value: 'ok' } });
  });

  it('rejects a declared oversized body before schema parsing', async () => {
    const response = await createApp().request('/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(API_JSON_MAX_BODY_BYTES + 1),
      },
      body: JSON.stringify({ value: 'ok' }),
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ error: 'payload too large' });
  });

  it('rejects a chunked oversized body before schema parsing', async () => {
    const response = await createApp().request(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: 'x'.repeat(API_JSON_MAX_BODY_BYTES + 1) }),
      }),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ error: 'payload too large' });
  });
});
