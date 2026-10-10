import * as Sentry from '@sentry/node';
import type { Event, Log } from '@sentry/node';

export interface TelemetryContext {
  service: string;
  correlationId?: string;
  jobId?: string;
}

export interface TelemetrySpanContext {
  name: string;
  op: string;
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
const PRIVATE_LOG_ATTRIBUTES = new Set([
  'clientaddress',
  'clientip',
  'email',
  'ip',
  'ipaddress',
  'phonenumber',
  'remoteaddr',
  'user',
  'userid',
  'useremail',
  'userfullname',
  'usersub',
  'username',
  'userip',
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

function sanitizeLogText(value: string): string {
  return sanitizeText(value).replace(
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    '[REDACTED]',
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPrivateLogAttribute(key: string): boolean {
  const normalized = normalizedKey(key);
  return PRIVATE_LOG_ATTRIBUTES.has(normalized)
    || normalized.endsWith('email')
    || normalized.endsWith('userid')
    || normalized.endsWith('username')
    || normalized.endsWith('phonenumber')
    || normalized.endsWith('clientip')
    || normalized.startsWith('sentryuser');
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

/** Scrub span data while preserving the SDK's typed links array contract. */
export function sanitizeTelemetrySpan<T extends object>(span: T): T {
  const original = span as T & { attributes?: unknown; links?: unknown };
  const safe = sanitizeTelemetryValue(span) as Record<string, unknown>;
  if (isRecord(original.attributes)) {
    safe.attributes = sanitizeLogValue(original.attributes);
  }
  if (Array.isArray(original.links)) {
    safe.links = original.links.map((link) => {
      const safeLink = sanitizeTelemetryValue(link);
      if (isRecord(link) && isRecord(link.attributes) && isRecord(safeLink)) {
        safeLink.attributes = sanitizeLogValue(link.attributes);
      }
      return safeLink;
    });
  } else if (original.links !== undefined) {
    delete safe.links;
  }
  return safe as T;
}

function sanitizeLogValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return sanitizeLogText(value);
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= MAX_DEPTH) return '[TRUNCATED]';
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ITEMS).map((entry) => sanitizeLogValue(entry, depth + 1));
  }
  if (isRecord(value)) {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value).slice(0, MAX_ITEMS)) {
      if (isPrivateLogAttribute(key)) continue;
      output[key] = isSensitiveKey(key)
        ? '[REDACTED]'
        : sanitizeLogValue(child, depth + 1);
    }
    return output;
  }
  return '[REDACTED]';
}

/** Scrub structured SDK log bodies and attributes before they leave the process. */
export function sanitizeTelemetryLog(log: Log): Log {
  const message: unknown = log.message;
  let safeMessage: Log['message'];
  if (typeof message === 'string') {
    safeMessage = sanitizeLogText(message);
  } else if (message instanceof String) {
    const parameterized = message as {
      toString(): string;
      __sentry_template_string__?: string;
      __sentry_template_values__?: unknown[];
    };
    const formatted = new String(sanitizeLogText(parameterized.toString())) as unknown as Log['message'];
    if (typeof parameterized.__sentry_template_string__ === 'string') {
      formatted.__sentry_template_string__ = sanitizeLogText(parameterized.__sentry_template_string__);
    }
    if (Array.isArray(parameterized.__sentry_template_values__)) {
      formatted.__sentry_template_values__ = parameterized.__sentry_template_values__
        .map((value: unknown) => sanitizeLogValue(value));
    }
    safeMessage = formatted;
  } else {
    safeMessage = sanitizeLogText(String(message));
  }

  return {
    ...log,
    message: safeMessage,
    attributes: sanitizeLogValue(log.attributes ?? {}) as Record<string, unknown>,
  };
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
    integrations: [Sentry.consoleLoggingIntegration({ levels: ['error', 'warn'] })],
    beforeSend: (event) => sanitizeTelemetryEvent(event),
    beforeSendLog: (log) => sanitizeTelemetryLog(log),
    beforeSendSpan: (span) => sanitizeTelemetrySpan(span),
    beforeBreadcrumb: (breadcrumb) => sanitizeTelemetryValue(breadcrumb) as typeof breadcrumb,
  });
  Sentry.getGlobalScope().setAttribute('sentry.service', sanitizeText(service));
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

/** Send a bounded, privacy-scrubbed structured error log with safe service context. */
export function captureTelemetryLog(
  message: string,
  context: TelemetryContext,
  attributes: Record<string, unknown> = {},
): void {
  if (!initialized || !Sentry.isInitialized()) return;
  try {
    const safeAttributes = sanitizeLogValue({
      ...attributes,
      'sentry.service': context.service,
      ...(context.correlationId ? { correlation_id: context.correlationId } : {}),
      ...(context.jobId ? { job_id: context.jobId } : {}),
    }) as Record<string, unknown>;
    Sentry.logger.error(sanitizeLogText(message), safeAttributes);
  } catch {
    // Telemetry must never change request, worker, or publishing behavior.
  }
}

/** Run work inside a Sentry span when telemetry is enabled. */
export function withTelemetrySpan<T>(context: TelemetrySpanContext, operation: () => T): T {
  if (!initialized || !Sentry.isInitialized()) return operation();
  return Sentry.startSpan({
    name: sanitizeText(context.name),
    op: sanitizeText(context.op),
  }, operation);
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
