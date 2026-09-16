// Offline smoke of the actual installed CLI, including sealed FD transfer.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { grokSandboxCommand } from '../packages/llm-gateway/dist/providers/grok-sandbox.js';
import { r2ManagedConfig } from '../packages/llm-gateway/dist/grok-r2-storage.js';

const [executable, launcher] = process.argv.slice(2);
assert(executable && launcher, 'Provide installed CLI and launcher paths');
const root = mkdtempSync(join(tmpdir(), 'axiom-installed-smoke-'));
try {
  const credentials = join(root, 'empty-credentials');
  mkdirSync(credentials, { mode: 0o700 });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1kAAAAASUVORK5CYII=', 'base64');
  for (const sealed of [false, true]) {
    const requestRoot = join(root, sealed ? 'sealed' : 'plain');
    mkdirSync(requestRoot, { mode: 0o700 });
    const spec = grokSandboxCommand({ executable, requestRoot, credentialRoot: credentials,
      args: ['--version'], ...(sealed ? { imageLauncher: { executable: launcher, byteLength: png.length } } : {}) });
    const result = spawnSync(spec.command, ['--unshare-net', ...spec.args], {
      cwd: spec.cwd, env: spec.env, input: sealed ? png : undefined,
      timeout: 15_000, maxBuffer: 16_384, encoding: 'utf8',
    });
    assert.equal(result.status, 0, `Offline installed runtime failed: ${result.error?.message ?? result.stderr}`);
    assert.match(result.stdout, /grok 1\.0\.24/);
    console.log(`${sealed ? 'sealed launcher + CLI' : 'CLI'}: offline sandbox version smoke passed`);
  }
  const requestRoot = join(root, 'r2-config');
  mkdirSync(requestRoot, { mode: 0o700 });
  const managedConfigPath = join(requestRoot, 'synthetic.toml');
  const config = r2ManagedConfig({ endpoint: `https://${'1'.repeat(32)}.r2.cloudflarestorage.com`,
    bucket: 'synthetic-fixture', accessKeyId: 'a'.repeat(32), secretAccessKey: 'b'.repeat(64),
  }, { userId: 'fixture', orgId: 'fixture' });
  assert.match(config, /^\[tools\]\ndisable_zdr_incompatible_tools = true\n/);
  writeFileSync(managedConfigPath, config, { mode: 0o600 });
  const spec = grokSandboxCommand({ executable, requestRoot, credentialRoot: credentials,
    managedConfigPath, args: ['inspect', '--json'], imageLauncher: { executable: launcher, byteLength: png.length } });
  const flagIndex = spec.args.indexOf('GROK_DISABLE_ZDR_INCOMPATIBLE_TOOLS');
  assert.deepEqual(spec.args.slice(flagIndex - 1, flagIndex + 2), ['--setenv', 'GROK_DISABLE_ZDR_INCOMPATIBLE_TOOLS', '1']);
  const inspected = spawnSync(spec.command, ['--unshare-net', ...spec.args], {
    cwd: spec.cwd, env: spec.env, input: png, timeout: 20_000, maxBuffer: 1024 * 1024, encoding: 'utf8',
  });
  assert.equal(inspected.status, 0, 'Offline R2 config inspection failed');
  const layers = JSON.parse(inspected.stdout).configSources?.layers;
  assert(layers?.some(layer => layer.path === '/etc/grok/managed_config.toml'));
  console.log('sealed launcher + CLI: R2 config discovered and ZDR upload mode pinned (offline synthetic fixture)');
} finally {
  // This fresh fixture contains only our synthetic image and empty directories.
  rmSync(root, { recursive: true, force: true });
}
