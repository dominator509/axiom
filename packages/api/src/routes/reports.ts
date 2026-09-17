// ─── Monthly reports (F-27/F-57) ───────────────────────────────────────────
// GET /models/:modelId/reports/monthly?month=YYYY-MM

import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import type { AppBindings } from '../index.js';
import { withOrgContext, requireOrg, apiError, statusTitle } from './helpers.js';
import { buildMonthlyReportPdf, type MonthlyReportData } from '../reports/monthly-pdf.js';
import { modelAccessCondition } from '../model-access.js';

const router = new Hono<AppBindings>();
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function rows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object' && 'rows' in result) {
    const value = (result as { rows?: unknown }).rows;
    return Array.isArray(value) ? value as T[] : [];
  }
  return [];
}

function numberValue(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function monthBounds(month: string): { start: Date; end: Date } {
  const start = new Date(`${month}-01T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return { start, end };
}

router.get('/models/:modelId/reports/monthly', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const modelId = c.req.param('modelId');
  if (!UUID_PATTERN.test(modelId)) return apiError(c, 400, statusTitle(400), 'invalid model id');
  const month = c.req.query('month') ?? new Date().toISOString().slice(0, 7);
  if (!MONTH_PATTERN.test(month)) return apiError(c, 400, statusTitle(400), 'month must be YYYY-MM');
  const { start, end } = monthBounds(month);

  const report = await withOrgContext(orgId, async (tx) => {
    const result = await tx.execute(sql`
      SELECT
        mp.display_name AS "displayName",
        COALESCE((SELECT COUNT(*) FROM post_target pt INNER JOIN content_bundle cb ON cb.id = pt.bundle_id
          WHERE cb.org_id = ${orgId} AND cb.model_id = mp.id AND pt.org_id = ${orgId}
            AND pt.scheduled_for >= ${start} AND pt.scheduled_for < ${end}), 0)::int AS "scheduledPosts",
        COALESCE((SELECT COUNT(*) FROM post_target pt INNER JOIN content_bundle cb ON cb.id = pt.bundle_id
          WHERE cb.org_id = ${orgId} AND cb.model_id = mp.id AND pt.org_id = ${orgId}
            AND pt.state = 'published' AND pt.scheduled_for >= ${start} AND pt.scheduled_for < ${end}), 0)::int AS "publishedPosts",
        COALESCE((SELECT SUM(pm.views) FROM post_metric pm INNER JOIN post_target pt ON pt.id = pm.post_target_id
          INNER JOIN content_bundle cb ON cb.id = pt.bundle_id
          WHERE cb.org_id = ${orgId} AND cb.model_id = mp.id AND pt.org_id = ${orgId}
            AND pm.collected_at >= ${start} AND pm.collected_at < ${end}), 0)::bigint AS views,
        COALESCE((SELECT SUM(pm.likes) FROM post_metric pm INNER JOIN post_target pt ON pt.id = pm.post_target_id
          INNER JOIN content_bundle cb ON cb.id = pt.bundle_id
          WHERE cb.org_id = ${orgId} AND cb.model_id = mp.id AND pt.org_id = ${orgId}
            AND pm.collected_at >= ${start} AND pm.collected_at < ${end}), 0)::bigint AS likes,
        COALESCE((SELECT SUM(pm.shares) FROM post_metric pm INNER JOIN post_target pt ON pt.id = pm.post_target_id
          INNER JOIN content_bundle cb ON cb.id = pt.bundle_id
          WHERE cb.org_id = ${orgId} AND cb.model_id = mp.id AND pt.org_id = ${orgId}
            AND pm.collected_at >= ${start} AND pm.collected_at < ${end}), 0)::bigint AS shares,
        COALESCE((SELECT SUM(pm.comments) FROM post_metric pm INNER JOIN post_target pt ON pt.id = pm.post_target_id
          INNER JOIN content_bundle cb ON cb.id = pt.bundle_id
          WHERE cb.org_id = ${orgId} AND cb.model_id = mp.id AND pt.org_id = ${orgId}
            AND pm.collected_at >= ${start} AND pm.collected_at < ${end}), 0)::bigint AS comments,
        COALESCE((SELECT ps.score FROM playbook_score ps
          WHERE ps.org_id = ${orgId} AND ps.model_id = mp.id AND ps.ts < ${end}
          ORDER BY ps.ts DESC LIMIT 1), 0)::int AS "adherenceScore",
        COALESCE((SELECT COUNT(*) FROM viral_exemplar ve
          WHERE ve.org_id = ${orgId} AND ve.model_id = mp.id
            AND ve.created_at >= ${start} AND ve.created_at < ${end}), 0)::int AS "viralExemplars"
      FROM model_profile mp
      WHERE mp.org_id = ${orgId} AND mp.id = ${modelId}
        AND ${modelAccessCondition(c.get('role'), orgId, c.get('userId'), sql`mp.id`) ?? sql`true`}
      LIMIT 1
    `);
    const [row] = rows<Record<string, unknown>>(result);
    if (!row) return null;
    return {
      displayName: typeof row.displayName === 'string' ? row.displayName : 'Talent model',
      period: month,
      scheduledPosts: numberValue(row.scheduledPosts),
      publishedPosts: numberValue(row.publishedPosts),
      views: numberValue(row.views),
      likes: numberValue(row.likes),
      shares: numberValue(row.shares),
      comments: numberValue(row.comments),
      adherenceScore: numberValue(row.adherenceScore),
      viralExemplars: numberValue(row.viralExemplars),
    } satisfies MonthlyReportData;
  });
  if (!report) return apiError(c, 404, statusTitle(404), 'model not found');

  const pdf = buildMonthlyReportPdf(report);
  return new Response(Buffer.from(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="fanthynks-${month}-monthly-report.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
});

export { router as reportsRouter };
