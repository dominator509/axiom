import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED_CHECKS = 15;
const RUN_ID = randomUUID();
const MARKER = `AXIOM_OBSERVABILITY_${RUN_ID}`;
const FIXTURE_TOKEN = `fixture-sensitive-${RUN_ID}`;
const FIXTURE_EMAIL = `canary-${RUN_ID}@example.test`;
const API_CORRELATION_IDS = [1, 2].map((index) => `API-${RUN_ID}-${index}`);
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
    const matchingIssues = Array.isArray(issues)
      ? issues.filter((issue) => String(issue?.title ?? '').includes(MARKER))
      : [];
    const occurrenceCount = matchingIssues.reduce((total, issue) => total + Number(issue?.count ?? 0), 0);
    if (occurrenceCount >= API_CORRELATION_IDS.length) return matchingIssues;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error('Both injected exceptions were not readable in the isolated GlitchTip project');
}

async function waitForLog() {
  const query = new URLSearchParams({ query: MARKER, limit: '20' });
  const route = `/api/0/organizations/${encodeURIComponent(organizationSlug)}/logs/?${query}`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const logs = await apiRequest(route);
    if (Array.isArray(logs)) {
      const matches = logs.filter((log) => JSON.stringify(log).includes(MARKER));
      const correlationsFound = API_CORRELATION_IDS.every((correlationId) =>
        matches.some((log) => JSON.stringify(log).includes(correlationId)),
      );
      if (correlationsFound) return matches;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error('Both injected structured logs were not readable in the isolated GlitchTip project');
}

async function sendFault(dsn) {
  fixtureDsn = dsn;
  const childScript = path.join(CHECKOUT, 'scripts', 'rehearse-glitchtip-fault-child.mjs');
  const results = API_CORRELATION_IDS.map((correlationId) => {
    const child = spawnSync(process.execPath, [childScript, '--isolated-fixture'], {
      encoding: 'utf8',
      timeout: 20_000,
      env: {
        PATH: process.env.PATH,
        GLITCHTIP_URL: BASE_URL.origin,
        TESTED_SHA,
        SENTRY_DSN: dsn,
        SENTRY_TRACES_SAMPLE_RATE: '1',
        AXIOM_ENVIRONMENT: 'isolated-observability-rehearsal',
        AXIOM_RELEASE: TESTED_SHA,
        AXIOM_SERVICE_NAME: 'api',
        AXIOM_OBSERVABILITY_MARKER: MARKER,
        AXIOM_OBSERVABILITY_FIXTURE_TOKEN: FIXTURE_TOKEN,
        AXIOM_OBSERVABILITY_FIXTURE_EMAIL: FIXTURE_EMAIL,
        AXIOM_OBSERVABILITY_CORRELATION_ID: correlationId,
      },
    });
    if (child.error || child.status !== 0) return null;
    try {
      const lines = child.stdout.trim().split(/\r?\n/);
      return JSON.parse(lines.at(-1));
    } catch {
      return null;
    }
  });
  check(
    'API telemetry bootstrap initialized for both isolated fixture clients',
    results.length === API_CORRELATION_IDS.length && results.every((result) => result?.initialized === true),
  );
  check(
    'production API error handler returns safe correlated RFC-7807 responses for both requests',
    results.length === API_CORRELATION_IDS.length && results.every((result) => result?.safeResponse === true),
  );
  check(
    'both isolated API clients flushed exception, structured log, and trace envelopes',
    results.length === API_CORRELATION_IDS.length && results.every((result) => result?.flushed === true),
  );
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
    environment: 'GitHub Actions disposable PostgreSQL and GlitchTip services; Node 22.23.3; built API and workspace dependencies; generated fixture account/project/DSN; no external service or provider credentials.',
    scope: 'Two isolated API clients each send the same controlled request failure with a distinct request ID through the production API correlation, telemetry-span, and error-handler code. One event per client avoids client-side duplicate suppression so GlitchTip issue-list readback can verify server grouping into one incident with two occurrences; both structured logs retain service, correlation, and active trace/parent-span context; synthetic token/email markers are absent; the unique organization is deleted.',
    limitations: 'This proves isolated GlitchTip incident grouping, issue-list API visibility, and structured log/trace readback. It does not prove frontend dashboard rendering, production GlitchTip deployment, target-host tunnel/DNS/route/proxy faults, or global suspension timing.',
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
  const matchingIssues = await waitForIssue();
  check(
    'two identical injected exceptions are deduplicated to one GlitchTip issue-list entry with two occurrences',
    matchingIssues.length === 1 && Number(matchingIssues[0]?.count) === API_CORRELATION_IDS.length,
  );
  const logs = await waitForLog();
  const structuredLog = logs.find((log) => JSON.stringify(log).includes(MARKER));
  check('production API structured error logs visible through GlitchTip logs API', Boolean(structuredLog));
  // GlitchTip exposes the trace as traceID and flattens Sentry's log attributes into data.
  const correlatedLogs = API_CORRELATION_IDS.map((correlationId) =>
    logs.find((log) => JSON.stringify(log).includes(correlationId)),
  );
  check(
    'each structured log carries an active trace and parent span',
    correlatedLogs.length === API_CORRELATION_IDS.length
      && correlatedLogs.every((log) => {
        const traceId = log?.traceID;
        const parentSpanId = log?.data?.['sentry.trace.parent_span_id'];
        return typeof traceId === 'string'
          && traceId.length >= 16
          && typeof parentSpanId === 'string'
          && /^[a-f0-9]{16}$/i.test(parentSpanId);
      }),
  );
  check(
    'structured logs expose API service and both request correlation identifiers',
    correlatedLogs.length === API_CORRELATION_IDS.length
      && correlatedLogs.every((log, index) =>
        log?.service === 'api' && JSON.stringify(log).includes(API_CORRELATION_IDS[index]),
      ),
  );
  const serialized = JSON.stringify(logs);
  check(
    'structured logs exclude synthetic tokens and identities from both requests',
    !serialized.includes(FIXTURE_TOKEN) && !serialized.includes(FIXTURE_EMAIL),
  );
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
