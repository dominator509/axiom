import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED_CHECKS = 15;
const RUN_ID = randomUUID();
const MARKER = `AXIOM_OBSERVABILITY_${RUN_ID}`;
const FIXTURE_TOKEN = `fixture-sensitive-${RUN_ID}`;
const FIXTURE_EMAIL = `canary-${RUN_ID}@example.test`;
const CHECKOUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RECEIPT_DIRECTORY = path.join(CHECKOUT, 'var', 'observability-rehearsal', RUN_ID);
const BASE_URL = new URL(process.env.GLITCHTIP_URL ?? 'http://127.0.0.1:8000');
const TESTED_SHA = process.env.TESTED_SHA ?? '';
const checks = [];
let failure;
let cleanupVerified = false;
let organizationWasCreated = false;
let organizationSlug;
let projectSlug;
let organizationName;
let cookies = new Map();
let runUrl;
let ingestedLogSha256;
let fixtureDsn;

function check(name, condition) {
  const passed = Boolean(condition);
  checks.push({ name, passed });
  if (!passed) throw new Error(`Observability acceptance check failed: ${name}`);
}

function safeDiagnostic(message) {
  return [FIXTURE_TOKEN, FIXTURE_EMAIL, fixtureDsn]
    .filter((value) => typeof value === 'string' && value.length > 0)
    .reduce((safe, value) => safe.replaceAll(value, '[REDACTED]'), message);
}

function requireIsolatedInvocation() {
  if (!process.argv.includes('--isolated-fixture')) {
    throw new Error('Refusing observability rehearsal without --isolated-fixture');
  }
  if (process.env.SENTRY_DSN) {
    throw new Error('Refusing ambient SENTRY_DSN; the rehearsal must create its own fixture DSN');
  }
  if (process.env.DATABASE_URL) {
    throw new Error('Refusing ambient DATABASE_URL; the rehearsal uses the isolated GlitchTip service');
  }
  if (!/^[a-f0-9]{40,64}$/i.test(TESTED_SHA)) {
    throw new Error('TESTED_SHA must identify the exact commit under test');
  }
  if (BASE_URL.protocol !== 'http:'
      || !['127.0.0.1', 'localhost', '::1'].includes(BASE_URL.hostname)
      || BASE_URL.username || BASE_URL.password) {
    throw new Error('GLITCHTIP_URL must be an unauthenticated loopback HTTP origin');
  }
  runUrl = process.env.GITHUB_RUN_ID && process.env.GITHUB_REPOSITORY
    ? `${process.env.GITHUB_SERVER_URL ?? 'https://github.com'}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : null;
}

function absorbCookies(response) {
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(';', 1)[0] ?? '';
    const separator = pair.indexOf('=');
    if (separator > 0) cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
}

async function apiRequest(route, { method = 'GET', body } = {}) {
  const headers = new Headers({ accept: 'application/json' });
  if (body !== undefined) headers.set('content-type', 'application/json');
  if (cookies.size > 0) {
    headers.set('cookie', [...cookies].map(([name, value]) => `${name}=${value}`).join('; '));
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const csrf = cookies.get('csrftoken');
    if (csrf) headers.set('x-csrftoken', csrf);
    headers.set('referer', BASE_URL.origin);
  }

  const response = await fetch(new URL(route, BASE_URL), {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: 'manual',
  });
  absorbCookies(response);
  const responseText = await response.text();
  let data = null;
  if (responseText) {
    try {
      data = JSON.parse(responseText);
    } catch {
      data = responseText;
    }
  }
  if (!response.ok) {
    throw new Error(`Isolated GlitchTip API request returned HTTP ${response.status}: ${method} ${route}`);
  }
  return data;
}

async function waitForGlitchTip() {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(new URL('/_health/', BASE_URL));
      if (response.status === 200) return;
    } catch {
      // The isolated service may still be applying its initial database migrations.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error('Isolated GlitchTip health endpoint did not become ready within 180 seconds');
}

async function createProject() {
  const email = `axiom-observability-${RUN_ID}@example.test`;
  const password = `fixture-only-${RUN_ID}`;
  await apiRequest('/_allauth/browser/v1/config');
  await apiRequest('/_allauth/browser/v1/auth/signup', {
    method: 'POST',
    body: { email, password },
  });
  const accessibleOrganizations = await apiRequest('/api/0/organizations/');
  check('isolated GlitchTip account authenticated', Array.isArray(accessibleOrganizations));

  organizationName = `axiom-observability-${RUN_ID}`;
  const organization = await apiRequest('/api/0/organizations/', {
    method: 'POST',
    body: { name: organizationName },
  });
  organizationWasCreated = true;
  organizationSlug = organization?.slug;
  check('isolated organization created', typeof organizationSlug === 'string' && organizationSlug.length > 0);

  const teamName = `observability-${RUN_ID}`;
  const team = await apiRequest(`/api/0/organizations/${encodeURIComponent(organizationSlug)}/teams/`, {
    method: 'POST',
    body: { slug: teamName },
  });
  const teamSlug = team?.slug;
  check('isolated project team created', teamSlug === teamName);

  const project = await apiRequest(
    `/api/0/teams/${encodeURIComponent(organizationSlug)}/${encodeURIComponent(teamSlug)}/projects/`,
    { method: 'POST', body: { name: `observability-${RUN_ID}` } },
  );
  projectSlug = project?.slug;
  check('isolated GlitchTip project created', typeof projectSlug === 'string' && projectSlug.length > 0);

  const keys = await apiRequest(
    `/api/0/projects/${encodeURIComponent(organizationSlug)}/${encodeURIComponent(projectSlug)}/keys/`,
  );
  const publicDsn = keys?.[0]?.dsn?.public;
  if (typeof publicDsn !== 'string') throw new Error('Isolated GlitchTip project did not return an ingestion DSN');
  const dsn = new URL(publicDsn);
  dsn.protocol = BASE_URL.protocol;
  dsn.hostname = BASE_URL.hostname;
  dsn.port = BASE_URL.port;
  dsn.username = decodeURIComponent(dsn.username);
  dsn.password = '';
  return { dsn: dsn.toString(), projectId: project.id };
}

async function waitForIssue() {
  const deadline = Date.now() + 60_000;
  const route = `/api/0/projects/${encodeURIComponent(organizationSlug)}/${encodeURIComponent(projectSlug)}/issues/`;
  while (Date.now() < deadline) {
    const issues = await apiRequest(route);
    if (Array.isArray(issues) && issues.some((issue) => String(issue?.title ?? '').includes(MARKER))) return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error('Injected exception was not readable in the isolated GlitchTip project');
}

async function waitForLog() {
  const query = new URLSearchParams({ query: MARKER, limit: '20' });
  const route = `/api/0/organizations/${encodeURIComponent(organizationSlug)}/logs/?${query}`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const logs = await apiRequest(route);
    if (Array.isArray(logs)) {
      const matches = logs.filter((log) => String(log?.body ?? '').includes(MARKER));
      if (matches.some((log) => String(log?.body ?? '').includes(`${MARKER}_console`))
          && matches.some((log) => String(log?.body ?? '').includes(`${MARKER}_structured`))) return matches;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error('Injected structured log was not readable in the isolated GlitchTip project');
}

async function sendFault(dsn) {
  fixtureDsn = dsn;
  const telemetry = await import('../packages/observability/dist/index.js');
  process.env.SENTRY_DSN = dsn;
  const initialized = telemetry.initializeTelemetry('observability-rehearsal', {
    ...process.env,
    SENTRY_DSN: dsn,
    SENTRY_TRACES_SAMPLE_RATE: '1',
    AXIOM_ENVIRONMENT: 'isolated-observability-rehearsal',
    AXIOM_RELEASE: TESTED_SHA,
  });
  check('server telemetry initialized from generated fixture DSN', initialized);

  await telemetry.withTelemetrySpan({ name: `${MARKER} span`, op: 'rehearsal' }, async () => {
    telemetry.captureTelemetryException(new Error(MARKER), {
      service: 'observability-rehearsal',
      correlationId: MARKER,
      jobId: MARKER,
    });
    console.error(`${MARKER}_console`, {
      service: 'observability-rehearsal',
      correlation_id: MARKER,
    });
    telemetry.captureTelemetryLog(`${MARKER}_structured`, {
      service: 'observability-rehearsal',
      correlationId: MARKER,
      jobId: MARKER,
    }, {
      access_token: FIXTURE_TOKEN,
      user: { email: FIXTURE_EMAIL },
    });
  });
  const flushed = await telemetry.flushTelemetry(8_000);
  check('SDK flushed exception, log, and trace envelopes', flushed);
}

async function cleanupFixture() {
  if (!organizationSlug) return false;
  try {
    await apiRequest(`/api/0/organizations/${encodeURIComponent(organizationSlug)}/`, { method: 'DELETE' });
    const organizations = await apiRequest('/api/0/organizations/');
    return Array.isArray(organizations)
      && !organizations.some((organization) => organization?.slug === organizationSlug);
  } catch {
    return false;
  }
}

async function writeReceipt() {
  const passed = checks.filter((item) => item.passed).length;
  const failedChecks = checks.filter((item) => !item.passed).length;
  const failed = failedChecks + (failure && failedChecks === 0 ? 1 : 0);
  const skipped = Math.max(0, EXPECTED_CHECKS - passed - failed);
  const receipt = {
    criterion: 'A4',
    testedSha: TESTED_SHA,
    environment: 'GitHub Actions disposable PostgreSQL and GlitchTip services; Node 22.23.3; generated fixture account/project/DSN; no external service or provider credentials.',
    scope: 'Injected server exception, console error, and structured SDK error log are read back from GlitchTip; the structured log has service/correlation context and active trace/parent-span IDs; synthetic token/email markers are absent; the unique organization is deleted.',
    limitations: 'This proves SDK-to-GlitchTip capture in an isolated fixture. It does not prove production GlitchTip deployment, host fault injection, global suspension timing, or owner observability dashboards.',
    runUrl,
    images: [process.env.GLITCHTIP_IMAGE, process.env.POSTGRES_IMAGE].filter(Boolean),
    readBackLogSha256: ingestedLogSha256,
    counts: { passed, failed, skipped, total: EXPECTED_CHECKS, unit: 'acceptance checks' },
    checks,
    cleanupVerified,
    productionAcceptance: false,
    failure: failure ? safeDiagnostic(failure) : null,
  };
  await mkdir(RECEIPT_DIRECTORY, { recursive: true });
  await writeFile(path.join(RECEIPT_DIRECTORY, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(receipt, null, 2));
  if (failed > 0 || skipped > 0 || !cleanupVerified) process.exitCode = 1;
}

async function main() {
  requireIsolatedInvocation();
  await waitForGlitchTip();
  check('isolated GlitchTip health endpoint ready', true);
  const { dsn, projectId } = await createProject();
  check('project DSN is scoped to created project', Boolean(projectId) && new URL(dsn).pathname.endsWith(`/${projectId}`));
  await sendFault(dsn);
  await waitForIssue();
  check('injected exception visible in GlitchTip issue list', true);
  const logs = await waitForLog();
  const consoleLog = logs.find((log) => String(log?.body ?? '').includes(`${MARKER}_console`));
  const structuredLog = logs.find((log) => String(log?.body ?? '').includes(`${MARKER}_structured`));
  check('console error visible through GlitchTip logs API', Boolean(consoleLog));
  check('structured logger record visible through GlitchTip logs API', Boolean(structuredLog));
  // GlitchTip exposes the trace as traceID and flattens Sentry's log attributes into data.
  const traceId = structuredLog?.traceID;
  const parentSpanId = structuredLog?.data?.['sentry.trace.parent_span_id'];
  check(
    'structured log carries an active trace and parent span',
    typeof traceId === 'string'
      && traceId.length >= 16
      && typeof parentSpanId === 'string'
      && /^[a-f0-9]{16}$/i.test(parentSpanId),
  );
  check('structured log exposes service and correlation identifiers', structuredLog?.service === 'observability-rehearsal' && JSON.stringify(structuredLog).includes(MARKER));
  const serialized = JSON.stringify(structuredLog);
  check('structured log excludes synthetic token and identity', !serialized.includes(FIXTURE_TOKEN) && !serialized.includes(FIXTURE_EMAIL));
  ingestedLogSha256 = createHash('sha256').update(serialized).digest('hex');
}

try {
  await main();
} catch (error) {
  failure = error instanceof Error ? error.message : 'Unknown observability rehearsal failure';
} finally {
  cleanupVerified = organizationWasCreated ? await cleanupFixture() : true;
  checks.push({ name: 'unique test organization removed and verified', passed: cleanupVerified });
  await writeReceipt();
}
