import { Hono } from 'hono';
import { z } from 'zod';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { boundedJsonValidator } from './bounded-json-validator.js';
import { validationDiagnostics } from './validation-diagnostics.js';

afterEach(() => vi.restoreAllMocks());
const schema = z.object({ style: z.string().min(1).default('studio'),
  media: z.object({ token: z.string().min(100) }).optional() });
function app(diagnostics: boolean) {
  const server = new Hono();
  server.post('/', boundedJsonValidator('json', schema,
    diagnostics ? validationDiagnostics('generate', Object.keys(schema.shape)) : undefined),
  c => c.json(c.req.valid('json')));
  return server;
}
function request(body: unknown) {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
describe('validation diagnostics', () => {
  it('preserves the exact validation response and logs only allowed labels', async () => {
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const body = { style: '', media: { token: 'synthetic-sensitive-token' }, password: 'private' };
    const baseline = await app(false).request('/', request(body));
    const diagnosed = await app(true).request('/', request(body));
    expect(diagnosed.status).toBe(400);
    expect(diagnosed.headers.get('Content-Type')).toBe(baseline.headers.get('Content-Type'));
    expect(await diagnosed.text()).toBe(await baseline.text());
    expect(log).toHaveBeenCalledOnce();
    expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({ event: 'validation_failed',
      issues: [{ field: 'style', code: 'too_small' }, { field: 'media', code: 'too_small' }] });
    expect(log.mock.calls[0][0]).not.toMatch(/sensitive|token|password|private/);
  });
  it('does not log valid requests and retains schema defaults', async () => {
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const response = await app(true).request('/', request({}));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ style: 'studio' });
    expect(log).not.toHaveBeenCalled();
  });
  it('does not log arbitrary path segments, messages or received values; caps issue output', async () => {
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const server = new Hono();
    server.post('/', boundedJsonValidator('json', z.record(z.literal('expected')),
      validationDiagnostics('generate', ['style'])), c => c.json({ ok: true }));
    await server.request('/', request(Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [`secret-path-${i}`, 'secret-value']))));
    const output = log.mock.calls[0][0];
    expect(output).not.toMatch(/secret|expected/);
    expect(JSON.parse(output)).toMatchObject({ issueCount: 30, truncated: true });
    expect(JSON.parse(output).issues).toHaveLength(20);
  });
  it('does not turn a logging failure into a server error', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => { throw new Error('logger unavailable'); });
    expect((await app(true).request('/', request({ style: '' }))).status).toBe(400);
  });
});
