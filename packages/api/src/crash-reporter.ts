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
      /((?:authorization|access[_-]?token|refresh[_-]?token|api[_-]?key|secret|password)\s*[:=]\s*)[^\s,;]+/gi,
      '$1[REDACTED]',
    );
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
  const fingerprint =
    input.fingerprint ?? crashFingerprint(input.service, input.message, input.stacktrace);

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
        message: input.message,
        stacktrace: input.stacktrace,
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
          message: input.message,
          stacktrace: input.stacktrace,
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
