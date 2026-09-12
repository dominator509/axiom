import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { createRouter } from './routes.js';
import type { LLMGateway } from './gateway.js';
import { loadR2Storage, saveR2Storage, removeR2Storage, r2StorageStatus, r2ManagedConfig, r2StorageSchema } from './grok-r2-storage.js';

let root: string;
const scope = { userId: 'test-operator', orgId: 'test-workspace' };
const config = { endpoint: `https://${'1'.repeat(32)}.r2.cloudflarestorage.com`, bucket: 'test-private-media', accessKeyId: 'a'.repeat(32), secretAccessKey: 'b'.repeat(64) };
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'axiom-r2-test-'));
  vi.stubEnv('AXIOM_SUBSCRIPTION_HOME', root);
  vi.stubEnv('BETTER_AUTH_SECRET', 'test-only-session-key-not-a-real-secret');
  vi.stubEnv('BETTER_AUTH_URL', 'https://axiom.example');
});
afterEach(() => { vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); });
it('encrypts at rest, redacts readback, isolates user/workspace and removes only the selected record', () => {
  saveR2Storage(scope, config);
  const directory = join(root, 'r2-storage');
  const disk = readFileSync(join(directory, readdirSync(directory)[0]!));
  expect(disk.includes(config.secretAccessKey)).toBe(false);
  expect(disk.includes(config.accessKeyId)).toBe(false);
  expect(loadR2Storage(scope)).toEqual(config);
  expect(loadR2Storage({ ...scope, orgId: 'other' })).toBeNull();
  expect(loadR2Storage({ ...scope, userId: 'other' })).toBeNull();
  expect(r2StorageStatus(scope)).toEqual({ configured: true, endpoint: config.endpoint, bucket: config.bucket, verified: false });
  saveR2Storage({ ...scope, orgId: 'other' }, config);
  removeR2Storage(scope);
  expect(loadR2Storage(scope)).toBeNull();
  expect(loadR2Storage({ ...scope, orgId: 'other' })).toEqual(config);
});
it('rejects ciphertext tampering and changed encryption keys', () => {
  saveR2Storage(scope, config);
  vi.stubEnv('BETTER_AUTH_SECRET', 'different-test-only-session-secret-key');
  expect(() => loadR2Storage(scope)).toThrow();
  vi.stubEnv('BETTER_AUTH_SECRET', 'test-only-session-key-not-a-real-secret');
  const directory = join(root, 'r2-storage'), path = join(directory, readdirSync(directory)[0]!);
  const bytes = readFileSync(path); bytes[28] = bytes[28]! ^ 1; writeFileSync(path, bytes);
  expect(() => loadR2Storage(scope)).toThrow();
});
it('fails closed without encryption and restricts endpoints and TOML values', () => {
  vi.stubEnv('BETTER_AUTH_SECRET', '');
  expect(() => saveR2Storage(scope, config)).toThrow('encryption');
  for (const endpoint of ['http://localhost', config.endpoint + '/path', config.endpoint + '@evil.example', 'https://example.com'])
    expect(r2StorageSchema.safeParse({ ...config, endpoint }).success).toBe(false);
  expect(r2StorageSchema.safeParse({ ...config, bucket: 'x"\nsecret = 1' }).success).toBe(false);
  const toml = r2ManagedConfig(config, scope);
  expect(toml).toContain('[tools.zdr_video_output_s3.read_write]');
  expect(toml).toContain('region = "auto"');
  expect(toml).not.toContain(scope.userId);
});
function app(auth = true) {
  const instance = new Hono<{ Variables: { userId: string; orgId: string } }>();
  if (auth) instance.use('*', async (c, next) => { c.set('userId', scope.userId); c.set('orgId', scope.orgId); await next(); });
  instance.route('/', createRouter({} as LLMGateway));
  return instance;
}
const route = '/subscriptions/grok/r2-storage';
function put(origin = 'https://axiom.example', body = JSON.stringify(config)) {
  return { method: 'PUT', headers: { Origin: origin, 'Content-Type': 'application/json' }, body };
}
it('requires authentication and exact origin, never returning submitted secrets', async () => {
  const anonymous = await app(false).request(route, put());
  expect(anonymous.status).toBe(401);
  expect(anonymous.headers.get('cache-control')).toBe('no-store');
  expect((await app().request(route, put('https://evil.example'))).status).toBe(403);
  const saved = await app().request(route, put());
  expect(saved.status).toBe(200);
  expect(saved.headers.get('cache-control')).toBe('no-store');
  const text = await saved.text();
  expect(text).not.toContain(config.secretAccessKey); expect(text).not.toContain(config.accessKeyId);
  expect(await (await app().request(route)).json()).toMatchObject({ configured: true });
  expect((await app().request(route, { method: 'DELETE', headers: { Origin: 'https://axiom.example' } })).status).toBe(200);
  expect(await (await app().request(route)).json()).toMatchObject({ configured: false });
});
it('rejects insecure setup, malformed and oversized bodies without echoing credentials', async () => {
  vi.stubEnv('BETTER_AUTH_URL', 'http://public.example');
  expect((await app().request(route, put('http://public.example'))).status).toBe(503);
  vi.stubEnv('BETTER_AUTH_URL', 'https://axiom.example');
  for (const body of ['{', JSON.stringify({ ...config, unexpected: config.secretAccessKey })]) {
    const response = await app().request(route, put(undefined, body));
    expect(response.status).toBe(400); expect(await response.text()).not.toContain(config.secretAccessKey);
  }
  const oversized = await app().request(route, put(undefined, JSON.stringify({ value: 'x'.repeat(262144) })));
  expect(oversized.status).toBe(413); expect(oversized.headers.get('cache-control')).toBe('no-store');
});
