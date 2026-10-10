import * as Sentry from '@sentry/node';
import type { Event } from '@sentry/node';

export interface TelemetryContext {
  service: string;
  correlationId?: string;
  jobId?: string;
}

const MAX_DEPTH = 8;
const MAX_ITEMS = 100;
const MAX_STRING_LENGTH = 4_000;
const SAFE_REQUEST_HEADERS = new Set([
  'content-type',
  'traceparent',
  'user-agent',
  'x-correlation-id',
]);

function normalizedKey(value: string): string {
  return value.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizedKey(key);
  return normalized === 'authorization'
    || normalized === 'cookie'
    || normalized === 'setcookie'
    || normalized === 'password'
    || normalized === 'passwd'
    || normalized === 'secret'
    || normalized.includes('apikey')
    || normalized === 'code'
    || normalized === 'oauthcode'
    || normalized === 'authorizationcode'
    || normalized === 'verificationcode'
    || normalized === 'state'
    || normalized === 'oauthstate'
    || normalized === 'nonce'
    || normalized === 'sessionid'
    || normalized.endsWith('token')
    || normalized.endsWith('secret')
    || normalized.endsWith('privatekey');
}

function sanitizeText(value: string): string {
  return value
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(
      /((?:["']?(?:authorization|cookie|password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|code|state)["']?)\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&}]+)/gi,
      (_match, prefix: string, credential: string) => {
        const quote = credential[0] === '"' || credential[0] === "'" ? credential[0] : '';
        return `${prefix}${quote}[REDACTED]${quote}`;
      },
    )
    .replace(
      /([?&](?:authorization|cookie|password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|code|state|token)=)[^&#\s]*/gi,
      '$1[REDACTED]',
    )
    .slice(0, MAX_STRING_LENGTH);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Bound and scrub arbitrary event data before it leaves a FanThynks process. */
export function sanitizeTelemetryValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return sanitizeText(value);
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= MAX_DEPTH) return '[TRUNCATED]';
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ITEMS).map((entry) => sanitizeTelemetryValue(entry, depth + 1));
  }
  if (isRecord(value)) {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value).slice(0, MAX_ITEMS)) {
      output[key] = isSensitiveKey(key)
        ? '[REDACTED]'
        : sanitizeTelemetryValue(child, depth + 1);
    }
    return output;
  }
  return '[REDACTED]';
}

function safeRequestUrl(value: string): string {
  try {
    const url = new URL(value, 'http://telemetry.invalid');
    const path = `${url.pathname}`;
    return url.origin === 'http://telemetry.invalid'
      ? path
      : `${url.protocol}//${url.host}${path}`;
  } catch {
    return sanitizeText(value).split(/[?#]/, 1)[0] ?? '';
  }
}

/** Remove request material and user identity, while retaining safe route context. */
export function sanitizeTelemetryEvent<T extends Event>(event: T): T {
  const safe = sanitizeTelemetryValue(event) as T;
  safe.user = undefined;

  if (safe.request) {
    const request = safe.request as unknown as Record<string, unknown>;
    if (typeof request.url === 'string') request.url = safeRequestUrl(request.url);
    delete request.data;
    delete request.body;
    delete request.cookies;
    delete request.env;
    delete request.query_string;
    delete request.remote_addr;

    const headers = isRecord(request.headers) ? request.headers : {};
    const safeHeaders: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(headers)) {
      if (SAFE_REQUEST_HEADERS.has(name.toLowerCase())) {
        safeHeaders[name.toLowerCase()] = sanitizeTelemetryValue(value);
      }
    }
    request.headers = safeHeaders;
  }

  return safe;
}

function sampleRate(env: NodeJS.ProcessEnv): number {
  const configured = env.SENTRY_TRACES_SAMPLE_RATE;
  if (configured === undefined || configured.trim() === '') return 0.01;
  const parsed = Number(configured);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error('SENTRY_TRACES_SAMPLE_RATE must be between 0 and 1');
  }
  return parsed;
}

let initialized = false;

/** Initialize the Sentry-compatible SDK when a server-side DSN is configured. */
export function initializeTelemetry(
  service: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (initialized) return true;
  const dsn = env.SENTRY_DSN?.trim();
  if (!dsn) return false;

  let parsedDsn: URL;
  try {
    parsedDsn = new URL(dsn);
  } catch {
    throw new Error('SENTRY_DSN must be a valid HTTP or HTTPS DSN');
  }
  if (parsedDsn.protocol !== 'https:' && parsedDsn.protocol !== 'http:') {
    throw new Error('SENTRY_DSN must be a valid HTTP or HTTPS DSN');
  }

  Sentry.init({
    dsn,
    environment: sanitizeText(env.AXIOM_ENVIRONMENT?.trim() || env.NODE_ENV || 'development'),
    release: sanitizeText(env.AXIOM_RELEASE?.trim() || env.GITHUB_SHA?.trim() || 'unknown'),
    tracesSampleRate: sampleRate(env),
    initialScope: { tags: { service } },
    beforeSend: (event) => sanitizeTelemetryEvent(event),
    beforeSendSpan: (span) => sanitizeTelemetryValue(span) as typeof span,
    beforeBreadcrumb: (breadcrumb) => sanitizeTelemetryValue(breadcrumb) as typeof breadcrumb,
  });
  initialized = true;
  return true;
}

/** Report a handled request or job failure with safe cross-service identifiers. */
export function captureTelemetryException(error: unknown, context: TelemetryContext): void {
  if (!initialized || !Sentry.isInitialized()) return;
  try {
    Sentry.withScope((scope) => {
      scope.setTag('service', sanitizeText(context.service));
      if (context.correlationId) scope.setTag('correlation_id', sanitizeText(context.correlationId));
      if (context.jobId) scope.setTag('job_id', sanitizeText(context.jobId));
      Sentry.captureException(error);
    });
  } catch {
    // Telemetry must never change request, worker, or publishing behavior.
  }
}

/** Flush queued events before a worker exits after a fatal failure. */
export async function flushTelemetry(timeoutMs = 2_000): Promise<boolean> {
  if (!initialized || !Sentry.isInitialized()) return true;
  try {
    return await Sentry.flush(timeoutMs);
  } catch {
    return false;
  }
}