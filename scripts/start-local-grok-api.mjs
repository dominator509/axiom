// Scoped local API launcher: consumes existing DB/auth configuration, but never
// starts unrelated configured social adapters or a publishing worker.
import { loadEnvFile } from 'node:process';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
if (process.platform !== 'linux' || Number(process.versions.node.split('.')[0]) < 22)
  throw new Error('Use the installed Linux Node >=22 runtime');
loadEnvFile(new URL('../.env', import.meta.url));
const runtime = parseEnv(readFileSync(new URL('../var/grok-runtime.env', import.meta.url), 'utf8'));
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
for (const key of ['AXIOM_GROK_CLI', 'AXIOM_GROK_VIDEO_CLI', 'AXIOM_GROK_IMAGE_LAUNCHER']) {
  if (!runtime[key]?.startsWith('/')) throw new Error(`${key} must be configured for Linux`);
}
const child = spawn(process.execPath, [fileURLToPath(new URL('../packages/api/dist/server.js', import.meta.url))], {
  cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: 'inherit',
  env: {
    PATH: '/usr/local/bin:/usr/bin:/bin', HOME: process.env.HOME,
    NODE_ENV: 'development', AXIOM_ENV: 'development',
    API_HOST: '127.0.0.1', API_PORT: '3001',
    BETTER_AUTH_URL: 'http://127.0.0.1:3002',
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET || randomBytes(32).toString('hex'),
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
