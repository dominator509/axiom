import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const required = (name) => {
  const value = process.env[name];
  if (typeof value !== 'string' || value.length === 0) throw new Error('Missing isolated fault input: ' + name);
  return value;
};

if (!process.argv.includes('--isolated-fixture')) throw new Error('Refusing non-fixture observability child execution');
if (process.env.DATABASE_URL) throw new Error('Refusing ambient database configuration');
const testedSha = required('TESTED_SHA');
if (!/^[a-f0-9]{40,64}$/i.test(testedSha)) throw new Error('TESTED_SHA must identify the exact commit under test');
const dsn = new URL(required('SENTRY_DSN'));
if (dsn.protocol !== 'http:' || !['127.0.0.1', 'localhost', '::1'].includes(dsn.hostname) || !dsn.username || dsn.password) {
  throw new Error('Refusing a non-loopback or credential-bearing DSN');
}
const marker = required('AXIOM_OBSERVABILITY_MARKER');
const fixtureToken = required('AXIOM_OBSERVABILITY_FIXTURE_TOKEN');
const fixtureEmail = required('AXIOM_OBSERVABILITY_FIXTURE_EMAIL');
const correlationId = required('AXIOM_OBSERVABILITY_CORRELATION_ID');

const telemetry = await import('../packages/observability/dist/index.js');
await import('../packages/api/dist/telemetry-bootstrap.js');
const initialized = telemetry.initializeTelemetry('api', process.env);
const apiRequire = createRequire(path.join(checkout, 'packages', 'api', 'package.json'));
const { Hono } = await import(pathToFileURL(apiRequire.resolve('hono')).href);
const { correlationId: correlationIdMiddleware, onError, telemetrySpan } = await import('../packages/api/dist/contract.js');
const app = new Hono();
app.use('*', correlationIdMiddleware);
app.use('*', telemetrySpan);
app.onError(onError);
app.get('/_rehearsal/fault', () => {
  throw new Error(`${marker} access_token=${fixtureToken} email=${fixtureEmail}`);
});

const response = await app.request('http://127.0.0.1/_rehearsal/fault', {
  headers: { 'X-Correlation-ID': correlationId },
});
const body = await response.json();
const bodyJson = JSON.stringify(body);
const safeResponse = response.status === 500
  && response.headers.get('X-Correlation-ID') === correlationId
  && body?.correlation_id === correlationId
  && !bodyJson.includes(marker)
  && !bodyJson.includes(fixtureToken)
  && !bodyJson.includes(fixtureEmail);
const flushed = await telemetry.flushTelemetry(8_000);
process.stdout.write(JSON.stringify({ initialized, safeResponse, flushed }) + '\n');
if (!initialized || !safeResponse || !flushed) process.exitCode = 1;
