import { sql } from 'drizzle-orm';

/** One snapshot; never expose queue payloads, raw errors or credential material. */
export async function readDigestScheduleStatus(tx: any, orgId: string) {
  const result = await tx.execute(sql`
    SELECT s.weekly_digest_schedule_id IS NOT NULL AS enabled,
           s.publishing_enabled AS workspace_permitted,
           j.state, j.run_after, j.attempts
    FROM org_settings s
    LEFT JOIN LATERAL (
      SELECT state, run_after, attempts FROM job
      WHERE org_id = ${orgId} AND kind = 'digest.weekly' AND queue = 'digest'
        AND payload->>'automaticScheduleId' = s.weekly_digest_schedule_id::text
      ORDER BY run_after DESC, created_at DESC, id DESC LIMIT 1
    ) j ON true
    WHERE s.org_id = ${orgId}
  `);
  const row = (Array.isArray(result) ? result : result.rows)[0];
  if (!row) return null;
  return {
    enabled: row.enabled === true,
    workspacePermitted: row.workspace_permitted === true,
    latest: row.state ? { state: row.state as string, runAfter: row.run_after, attempts: Number(row.attempts) } : null,
  };
}
