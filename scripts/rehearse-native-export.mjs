import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
assert.equal(args[0], '--isolated-fixture');
assert.ok(args.length === 1 || (args.length === 3 && args[1] === '--output-root' && isAbsolute(args[2])),
  'Usage: node scripts/rehearse-native-export.mjs --isolated-fixture [--output-root <absolute-directory>]');
const git = (...gitArgs) => {
  const result = spawnSync('git', gitArgs, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
const sourceSha = git('rev-parse', 'HEAD');
assert.equal(git('status', '--porcelain'), '', 'Commit the candidate before native validation');
assert.equal(process.versions.node, readFileSync(join(root, '.nvmrc'), 'utf8').trim().replace(/^v/, ''));
const outputRoot = args[2] ?? join(root, 'var', 'native-export');
mkdirSync(outputRoot, { recursive: true });
const runDir = mkdtempSync(join(outputRoot, 'run-'));
const tempDir = join(runDir, 'temp');
mkdirSync(tempDir);
const outputDir = join(runDir, 'export');
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');
// Do not inherit database, provider, public Expo variables or process credentials.
const env = {};
for (const key of ['PATH', 'Path', 'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT',
  'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'HOME']) {
  if (process.env[key]) env[key] = process.env[key];
}
Object.assign(env, { CI: '1', EXPO_OFFLINE: '1', EXPO_NO_TELEMETRY: '1', EXPO_NO_DOTENV: '1',
  EXPO_PUBLIC_API_URL: 'http://127.0.0.1:3001', TEMP: tempDir, TMP: tempDir, TMPDIR: tempDir });
const mobileDir = join(root, 'packages', 'mobile');
const cli = join(mobileDir, 'node_modules', 'expo', 'bin', 'cli');
const receipt = { sourceSha, node: process.version, startedAt: new Date().toISOString(),
  command: 'node scripts/rehearse-native-export.mjs --isolated-fixture',
  environment: { platform: process.platform, offline: true, dotenv: false, telemetry: false,
    providerCredentialsPassed: false, maxWorkers: 2 },
  packageSha256: digest(join(mobileDir, 'package.json')), lockSha256: digest(join(root, 'pnpm-lock.yaml')),
  checks: [], logs: [], bundles: [], status: 'running', cleanupVerified: false,
  limitations: 'Installed SDK manifest compatibility and Android/iOS Hermes compilation only. Offline compatibility is not a fresh registry lookup. No native binary, device/emulator, session, provider or production acceptance.' };
const receiptPath = join(runDir, 'receipt.json');
const save = () => writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
const execute = (name, commandArgs) => {
  const result = spawnSync(process.execPath, [cli, ...commandArgs], {
    cwd: mobileDir, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  const logPath = join(runDir, `${name}.log`);
  writeFileSync(logPath, (result.stdout ?? '') + '\n' + (result.stderr ?? ''));
  receipt.logs.push({ name, command: ['node', 'expo/bin/cli', ...commandArgs],
    sha256: digest(logPath), exitCode: result.status, signal: result.signal, errorCode: result.error?.code ?? null });
  assert.equal(result.status, 0, `${name} failed; inspect ${logPath}`);
  return result.stdout;
};
const check = (name, operation) => {
  try { operation(); receipt.checks.push({ name, passed: true }); }
  catch (error) { receipt.checks.push({ name, passed: false }); throw error; }
};
save();
console.log(`Native export receipt: ${receiptPath}`);
try {
  check('installed SDK dependency compatibility', () => {
    const result = JSON.parse(execute('sdk-check', ['install', '--check', '--json']));
    assert.equal(result.upToDate, true);
    assert.deepEqual(result.dependencies, []);
    receipt.sdkCheck = result;
  });
  check('Android and iOS Hermes compilation', () => {
    execute('export', ['export', '--platform', 'android', '--platform', 'ios', '--max-workers', '2', '--output-dir', outputDir]);
  });
  check('both native bundle artifacts exist', () => {
    const metadata = JSON.parse(readFileSync(join(outputDir, 'metadata.json'), 'utf8'));
    assert.deepEqual(Object.keys(metadata.fileMetadata).sort(), ['android', 'ios']);
    for (const [platform, value] of Object.entries(metadata.fileMetadata)) {
      const path = resolve(outputDir, value.bundle);
      assert.ok(path.startsWith(resolve(outputDir) + sep), 'Bundle must remain in owned export directory');
      assert.ok(path.endsWith('.hbc'), 'Hermes bytecode is required; no JS-only fallback');
      const bytes = readFileSync(path).length;
      assert.ok(bytes > 0);
      receipt.bundles.push({ platform, path: value.bundle, bytes, sha256: digest(path) });
    }
  });
  receipt.status = 'passed';
} catch (error) {
  receipt.status = 'failed';
  receipt.failure = error.message;
} finally {
  for (const [name, operation] of [
    ['owned temporary cache cleanup', () => {
      assert.ok(resolve(tempDir).startsWith(resolve(runDir) + sep), 'Cleanup must remain in owned run directory');
      rmSync(tempDir, { recursive: true, force: true });
      receipt.cleanupVerified = !existsSync(tempDir);
      assert.equal(receipt.cleanupVerified, true);
    }],
    ['tracked source unchanged', () => {
      receipt.trackedSourceUnchanged = git('status', '--porcelain') === '';
      assert.equal(receipt.trackedSourceUnchanged, true);
    }],
  ]) {
    try { check(name, operation); }
    catch (error) { receipt.status = 'failed'; receipt.failure = [receipt.failure, error.message].filter(Boolean).join('; '); }
  }
  receipt.counts = { passed: receipt.checks.filter(c => c.passed).length,
    failed: receipt.checks.filter(c => !c.passed).length, skipped: 5 - receipt.checks.length, total: 5 };
  receipt.endedAt = new Date().toISOString();
  save();
  console.log(JSON.stringify(receipt, null, 2));
}
process.exitCode = receipt.status === 'passed' ? 0 : 1;
