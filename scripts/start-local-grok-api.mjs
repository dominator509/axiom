// Scoped local API launcher: consumes existing DB/auth configuration, but never
// starts unrelated configured social adapters or a publishing worker.
import { loadEnvFile } from 'node:process';
import { accessSync, constants, readFileSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { localGrokOrigin } from './local-grok-origin.mjs';
if (process.platform !== 'linux' || Number(process.versions.node.split('.')[0]) < 22)
  throw new Error('Use the installed Linux Node >=22 runtime');
// Optional exact HTTPS origin for the explicitly authorized private phone tunnel.
// Never accept a wildcard or rewrite arbitrary caller Origin headers as trusted.
const publicOrigin = localGrokOrigin(process.argv.slice(2));
loadEnvFile(new URL('../.env', import.meta.url));
const runtime = parseEnv(readFileSync(new URL('../var/grok-runtime.env', import.meta.url), 'utf8'));
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
// This key also decrypts saved per-operator R2 credentials. A generated fallback
// would invalidate both sessions and storage on the next process restart.
const authSecret = process.env.BETTER_AUTH_SECRET;
if (!authSecret || authSecret.trim().length < 32)
  throw new Error('BETTER_AUTH_SECRET must be a persistent configured secret of at least 32 characters after trimming; no API started. Preserve the existing key to retain sessions and saved storage.');
for (const key of ['AXIOM_GROK_CLI', 'AXIOM_GROK_VIDEO_CLI', 'AXIOM_GROK_IMAGE_LAUNCHER']) {
  try {
    if (!runtime[key] || !isAbsolute(runtime[key]) || !statSync(runtime[key]).isFile()) throw new Error();
    accessSync(runtime[key], constants.R_OK | constants.X_OK);
  } catch {
    // Only the key name is diagnostic; do not print private paths or raw I/O.
    throw new Error(`${key} must name an executable regular file at an absolute Linux path; no API started.`);
  }
}
// Reuse the read-only recovery-schema check before opening an API listener.
// A timeout, missing dependency, or incompatible schema must never launch a
// process that appears healthy but fails when a model profile is requested.
// Keep child diagnostics private; the checker never performs a migration.
const schemaCheck = spawnSync(process.execPath, [
  fileURLToPath(new URL('./check-local-grok-schema.mjs', import.meta.url)), '--read-only',
], {
  env: { DATABASE_URL: process.env.DATABASE_URL },
  stdio: 'ignore', timeout: 20_000, killSignal: 'SIGKILL', windowsHide: true,
});
if (schemaCheck.error || schemaCheck.signal || schemaCheck.status !== 0)
  throw new Error('Local API not started: required schema could not be verified. Run the read-only schema check; backup and migration require operator approval.');
const child = spawn(process.execPath, [fileURLToPath(new URL('../packages/api/dist/server.js', import.meta.url))], {
  cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: 'inherit',
  env: {
    PATH: '/usr/local/bin:/usr/bin:/bin', HOME: process.env.HOME,
    NODE_ENV: 'development', AXIOM_ENV: 'development',
    API_HOST: '127.0.0.1', API_PORT: '3001',
    BETTER_AUTH_URL: publicOrigin,
    BETTER_AUTH_SECRET: authSecret,
    DATABASE_URL: process.env.DATABASE_URL,
    AXIOM_SUBSCRIPTION_HOME: '/home/doministic/.local/share/axiom-subscriptions',
    AXIOM_GROK_CLI: runtime.AXIOM_GROK_CLI,
    AXIOM_GROK_VIDEO_CLI: runtime.AXIOM_GROK_VIDEO_CLI,
    AXIOM_GROK_IMAGE_LAUNCHER: runtime.AXIOM_GROK_IMAGE_LAUNCHER,
    AXIOM_LLM_TRANSPORT_TIMEOUT_MS: '300000',
  },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', () => { console.error('Local API process failed to start'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
