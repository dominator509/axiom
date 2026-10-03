// Exercise GHSA-82fw-gwwq-j7x9 through the installed plugin, using only
// synthetic files and an in-process WebSocket adapter (no listening server).
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(new URL('../package.json', import.meta.url));
const vitestRequire = createRequire(require.resolve('vitest/package.json'));
const { interceptorPlugin } = await import(pathToFileURL(vitestRequire.resolve('@vitest/mocker/node')));
const { resolveConfig } = await import(pathToFileURL(vitestRequire.resolve('vite')));
const scratch = mkdtempSync(join(tmpdir(), 'axiom-mocker-boundary-'));

try {
  const root = join(scratch, 'project');
  mkdirSync(root);
  writeFileSync(join(root, 'allowed.js'), 'export const safe = true;');
  writeFileSync(join(root, 'blocked.txt'), 'synthetic-denied-content');
  writeFileSync(join(scratch, 'outside.txt'), 'synthetic-outside-content');
  const config = await resolveConfig({
    root, configFile: false, envFile: false,
    server: { fs: { strict: true, allow: [root], deny: ['**/blocked.txt'] } },
  }, 'serve');

  async function probe(redirect, options) {
    const handlers = new Map();
    const plugin = interceptorPlugin(options);
    plugin.configureServer({
      config,
      ws: { on: (name, handler) => handlers.set(name, handler), send() {} },
    });
    const register = handlers.get('vitest:interceptor:register');
    if (!register) return { registered: false };
    register({ type: 'redirect', raw: './target', id: '/target', url: '/target', redirect });
    const load = typeof plugin.load === 'function' ? plugin.load : plugin.load.handler;
    return { registered: true, source: await load('/target') };
  }

  await test('allowed redirect remains readable', async () => {
    assert.equal((await probe('file:///allowed.js')).source, 'export const safe = true;');
  });
  await test('denied in-root file is not served', async () => {
    assert.equal((await probe('file:///blocked.txt')).source, undefined);
  });
  await test('opaque-scheme traversal outside allowlist is not served', async () => {
    assert.equal((await probe('mock:../outside.txt')).source, undefined);
  });
  await test('disabled raw WebSocket registration remains absent', async () => {
    assert.equal((await probe('file:///allowed.js', { registerWebSocketEvents: false })).registered, false);
  });
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
