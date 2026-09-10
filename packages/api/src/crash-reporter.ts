// ─── Internal crash reporter (F-73, L2.9) ───────────────────────────────────
// The API error boundary and the authenticated crash-report endpoint share
// this writer so unhandled request failures cannot disappear into stderr only.

import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db, schema } from '@axiom/db';

export type CrashSeverity = 'sev-1' | 'sev-2' | 'sev-3' | 'sev-4';

export interface CrashReportInput {
  orgId: string;
  eventId: string;
  service: string;
  release?: string;
  environment?: string;
  message: string;
  stacktrace: Array<Record<string, unknown>>;
  correlationId?: string;
  severity?: CrashSeverity;
  fingerprint?: string;
}

export interface StoredCrashReport {
  count?: number;
  [key: string]: unknown;
}

const MAX_CRASH_STACK_FRAMES = 50;
const MAX_CRASH_OBJECT_DEPTH = 8;

/** Normalize common credential field spellings before comparing them. */
function normalizedCrashKey(key: string): string {
  return key.replace(/[-_]/g, '').toLowerCase();
}

/** Return true for fields whose values must never enter the crash sink. */
function isSensitiveCrashKey(key: string): boolean {
  const normalized = normalizedCrashKey(key);
  return (
    normalized === 'authorization' ||
    normalized === 'cookie' ||
    normalized === 'password' ||
    normalized === 'secret' ||
    normalized === 'token' ||
    normalized === 'accesstoken' ||
    normalized === 'refreshtoken' ||
    normalized === 'clientsecret' ||
    normalized === 'apikey' ||
    normalized === 'privatekey' ||
    normalized.endsWith('token') ||
    normalized.endsWith('secret')
  );
}

/** Stable grouping key: service + message + first stack frame. */
export function crashFingerprint(
  service: string,
  message: string,
  stacktrace: Array<Record<string, unknown>>,
): string {
  const firstFrame = stacktrace[0]?.function ?? stacktrace[0]?.filename ?? '';
  return createHash('sha256').update(`${service}|${message}|${firstFrame}`).digest('hex');
}

/** Keep credentials out of the durable crash sink and process logs. */
export function redactCrashText(value: string): string {
  return value
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(
      /((?:["']?(?:authorization|access[_-]?token|refresh[_-]?token|api[_-]?key|secret|password|token)["']?)\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&}]+)/gi,
      (_match, prefix: string, credential: string) => {
        const quote = credential[0] === '"' || credential[0] === "'" ? credential[0] : '';
        return `${prefix}${quote}[REDACTED]${quote}`;
      },
    )
    .replace(
      /([?&](?:authorization|access[_-]?token|refresh[_-]?token|api[_-]?key|secret|password|token)=)[^&#\s]*/gi,
      '$1[REDACTED]',
    );
}

/**
 * Redact credentials from client-supplied structured crash details.
 *
 * Internal failures already pass through describeCrash(), but the authenticated
 * crash-report endpoint also accepts client-generated stack frames. Treat that
 * input as untrusted: redact sensitive keys and string values recursively before
 * it reaches PostgreSQL or the dashboard, while bounding depth and collection
 * sizes so a malformed report cannot create an unbounded JSON document.
 */
export function redactCrashValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return redactCrashText(value).slice(0, 2000);
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= MAX_CRASH_OBJECT_DEPTH) return '[TRUNCATED]';

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_CRASH_STACK_FRAMES)
      .map((entry) => redactCrashValue(entry, depth + 1));
  }

  if (typeof value === 'object') {
    const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      output[key] = isSensitiveCrashKey(key)
        ? '[REDACTED]'
        : redactCrashValue(child, depth + 1);
    }
    return output;
  }

  return '[REDACTED]';
}

function redactCrashStacktrace(
  stacktrace: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return redactCrashValue(stacktrace.slice(0, MAX_CRASH_STACK_FRAMES)) as Array<
    Record<string, unknown>
  >;
}

/** Convert an unknown thrown value into a bounded, secret-scrubbed report. */
export function describeCrash(error: unknown): {
  message: string;
  stacktrace: Array<Record<string, unknown>>;
} {
  const source = error instanceof Error ? error : new Error(String(error));
  const message = redactCrashText(`${source.name}: ${source.message}`).slice(0, 2000);
  const stack = redactCrashText(source.stack ?? message)
    .split('\n')
    .slice(0, 50);
  return {
    message,
    stacktrace: stack.map((line, index) => ({ frame: index, text: line.slice(0, 2000) })),
  };
}

/**
 * Upsert one org-scoped crash issue. The transaction sets the RLS context and
 * performs the grouping write atomically, matching the public crash-report
 * endpoint's semantics.
 */
export async function recordCrashReport(
  input: CrashReportInput,
): Promise<StoredCrashReport | null> {
  const message = redactCrashText(input.message).slice(0, 2000);
  const stacktrace = redactCrashStacktrace(input.stacktrace);
  const fingerprint =
    input.fingerprint ?? crashFingerprint(input.service, message, stacktrace);

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_org_id', ${input.orgId}, true)`);
    const rows = await tx
      .insert(schema.crashReport)
      .values({
        orgId: input.orgId,
        fingerprint,
        eventId: input.eventId,
        service: input.service,
        release: input.release ?? 'unknown',
        environment: input.environment ?? 'production',
        message,
        stacktrace,
        correlationId: input.correlationId ?? null,
        severity: input.severity ?? 'sev-3',
        status: 'open',
        count: 1,
      })
      .onConflictDoUpdate({
        target: [schema.crashReport.orgId, schema.crashReport.fingerprint],
        set: {
          count: sql`${schema.crashReport.count} + 1`,
          lastSeen: new Date(),
          status: 'open',
          eventId: input.eventId,
          message,
          stacktrace,
          correlationId: input.correlationId ?? null,
          severity: input.severity ?? 'sev-3',
        },
      })
      .returning();
    return (rows[0] as StoredCrashReport | undefined) ?? null;
  });
}

/** Capture an unhandled authenticated API request failure without masking it. */
export async function captureUnhandledApiError(
  orgId: string | undefined,
  error: unknown,
  correlationId: string,
): Promise<void> {
  if (!orgId) return;
  const details = describeCrash(error);
  try {
    await recordCrashReport({
      orgId,
      eventId: randomUUID(),
      service: process.env.AXIOM_SERVICE_NAME ?? 'api',
      release: process.env.AXIOM_RELEASE ?? 'unknown',
      environment: process.env.NODE_ENV ?? 'production',
      message: details.message,
      stacktrace: details.stacktrace,
      correlationId,
      severity: 'sev-2',
    });
  } catch (captureError) {
    const failure = describeCrash(captureError);
    console.error('Failed to persist API crash report', {
      correlationId,
      error: failure.message,
    });
  }
}
