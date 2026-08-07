// ─── Crash sink (F-73, L2.9) — Sentry/GlitchTip-style issue store ───
// POST /api/v1/crash-reports            — capture a crash; grouped by fingerprint
// GET  /api/v1/crash-reports            — issue list (cursor paginated, optional status)
// PATCH /api/v1/crash-reports/:id/resolve — mark an issue resolved

import { Hono } from 'hono';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { sql, eq, and, desc } from 'drizzle-orm';
import { schema } from '@axiom/db';
import type { AppBindings } from '../index.js';
import { withOrgContext, requireOrg, apiError, statusTitle } from './helpers.js';
import { parseCursor, cursorLt, nextCursor } from '../contract.js';

const router = new Hono<AppBindings>();

const reportSchema = z.object({
  eventId: z.string().min(1).max(100),
  service: z.string().min(1).max(100),
  release: z.string().max(100).optional(),
  environment: z.string().max(50).optional(),
  message: z.string().max(2000).default(''),
  stacktrace: z.array(z.record(z.string(), z.unknown())).default([]),
  correlationId: z.string().max(100).optional(),
  severity: z.enum(['sev-1', 'sev-2', 'sev-3', 'sev-4']).default('sev-3'),
  fingerprint: z.string().max(200).optional(),
});

/** Stable grouping key: service + message + first stack frame. */
export function crashFingerprint(service: string, message: string, stacktrace: Array<Record<string, unknown>>): string {
  const firstFrame = stacktrace[0]?.function ?? stacktrace[0]?.filename ?? '';
  return createHash('sha256').update(`${service}|${message}|${firstFrame}`).digest('hex');
}

// POST /api/v1/crash-reports — capture; recurring fingerprint bumps count
router.post('/crash-reports', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const parsed = reportSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return apiError(c, 400, statusTitle(400), 'invalid crash report body');
  const body = parsed.data;
  const fingerprint = body.fingerprint ?? crashFingerprint(body.service, body.message, body.stacktrace);

  const result = await withOrgContext(orgId, async (tx) => {
    // Single ON CONFLICT upsert: recurring fingerprint bumps count + refresh;
    // first sighting inserts. Grouping/dedup is the UNIQUE (org_id, fingerprint).
    const rows = await tx
      .insert(schema.crashReport)
      .values({
        orgId,
        fingerprint,
        eventId: body.eventId,
        service: body.service,
        release: body.release ?? 'unknown',
        environment: body.environment ?? 'production',
        message: body.message,
        stacktrace: body.stacktrace,
        correlationId: body.correlationId ?? null,
        severity: body.severity,
        status: 'open',
        count: 1,
      })
      .onConflictDoUpdate({
        target: [schema.crashReport.orgId, schema.crashReport.fingerprint],
        set: {
          count: sql`${schema.crashReport.count} + 1`,
          lastSeen: new Date(),
          status: 'open',
          eventId: body.eventId,
          message: body.message,
          stacktrace: body.stacktrace,
          correlationId: body.correlationId ?? null,
          severity: body.severity,
        },
      })
      .returning();
    if (rows.length === 0) return { report: null as null, isNew: false };
    return { report: rows[0], isNew: rows[0].count === 1 };
  });

  if (!result.report) return apiError(c, 500, statusTitle(500), 'crash report upsert failed');
  return c.json({ success: true, isNew: result.isNew, data: result.report });
});

// GET /api/v1/crash-reports — grouped issues, newest recurrence first
router.get('/crash-reports', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const { limit, cursor } = parseCursor(c, 20, 100);
  const status = c.req.query('status');

  const rows = await withOrgContext(orgId, (tx) =>
    tx
      .select()
      .from(schema.crashReport)
      .where(
        and(
          eq(schema.crashReport.orgId, orgId),
          ...(status ? [eq(schema.crashReport.status, status as 'open' | 'resolved' | 'ignored')] : []),
          ...cursorLt(schema.crashReport.lastSeen, schema.crashReport.id, cursor),
        ),
      )
      .orderBy(desc(schema.crashReport.lastSeen), desc(schema.crashReport.id))
      .limit(limit),
  );
  const last = rows[rows.length - 1];
  return c.json({
    data: rows,
    meta: { total: rows.length, limit, next_cursor: nextCursor(last?.lastSeen, last?.id, limit, rows.length) },
  });
});

// PATCH /api/v1/crash-reports/:id/resolve
router.patch('/crash-reports/:id/resolve', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const { id } = c.req.param();

  const rows = await withOrgContext(orgId, (tx) =>
    tx
      .update(schema.crashReport)
      .set({ status: 'resolved' })
      .where(and(eq(schema.crashReport.id, id), eq(schema.crashReport.orgId, orgId)))
      .returning(),
  );
  if (rows.length === 0) return apiError(c, 404, statusTitle(404), 'crash report not found');
  return c.json({ success: true, data: rows[0] });
});

export { router as crashReportsRouter };
