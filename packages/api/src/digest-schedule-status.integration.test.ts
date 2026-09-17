import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db, pool, schema } from '@axiom/db';
import { readDigestScheduleStatus } from './digest-schedule-status.js';
import { recoverDigestSchedule } from './routes/org-settings.js';

const url = process.env.TEST_DATABASE_URL;
const orgId = '11111111-1111-4111-8111-111111111111';
describe.skipIf(!url)('digest schedule status in PostgreSQL', () => {
  afterAll(async () => { await pool.end(); });
  it('selects the active schedule only, scopes tenants, and reports terminal/missing/disabled states', async () => {
    const target = new URL(url!);
    expect(process.env.DATABASE_URL).toBe(url);
    expect(['localhost', '127.0.0.1']).toContain(target.hostname);
    expect(target.username).toBe('axiom_app');
    expect(target.pathname).toMatch(/^\/(?:axiom_test|axiom_workspace_test_[0-9a-f]{16})$/);
    const rollback = new Error('fixture rollback');
    await expect(db.transaction(async tx => {
      await tx.execute(sql`SELECT set_config('app.current_org_id', ${orgId}, true)`);
      const scheduleId = randomUUID();
      await tx.insert(schema.orgSettings).values({ orgId, publishingEnabled: false, weeklyDigestScheduleId: scheduleId })
        .onConflictDoUpdate({ target: schema.orgSettings.orgId, set: { publishingEnabled: false, weeklyDigestScheduleId: scheduleId } });
      expect(await readDigestScheduleStatus(tx, orgId)).toEqual({ enabled: true, workspacePermitted: false, latest: null });
      const [job] = await tx.insert(schema.job).values({ orgId, kind: 'digest.weekly', queue: 'digest', state: 'dead', attempts: 3, runAfter: new Date('2026-09-21T00:00:00Z'), payload: { automaticScheduleId: scheduleId }, lastError: 'PRIVATE ERROR' }).returning();
      await tx.insert(schema.job).values([
        { orgId, kind: 'digest.weekly', queue: 'digest', state: 'ready', runAfter: new Date('2099-01-01'), payload: { automaticScheduleId: randomUUID() } },
        { orgId, kind: 'digest.weekly', queue: 'digest', state: 'ready', runAfter: new Date('2099-01-01'), payload: {} },
        { orgId, kind: 'publish', queue: 'publish', state: 'ready', runAfter: new Date('2099-01-01'), payload: { automaticScheduleId: scheduleId } },
      ]);
      const status = await readDigestScheduleStatus(tx, orgId);
      expect(status).toMatchObject({ enabled: true, latest: { state: 'dead', attempts: 3 } });
      expect(JSON.stringify(status)).not.toMatch(/PRIVATE ERROR|automaticScheduleId/);
      expect(await readDigestScheduleStatus(tx, randomUUID())).toBeNull();
      await tx.update(schema.job).set({ state: 'running' }).where(eq(schema.job.id, job.id));
      expect(await readDigestScheduleStatus(tx, orgId)).toMatchObject({ latest: { state: 'running' } });
      const recovery = { expectedScheduleId: scheduleId, replacementScheduleId: randomUUID() };
      const recovered = await recoverDigestSchedule(tx, orgId, 'test-operator', recovery);
      expect(recovered?.[0]).toMatchObject({ weeklyDigestScheduleId: recovery.replacementScheduleId, publishingEnabled: false });
      expect(await readDigestScheduleStatus(tx, orgId)).toMatchObject({ latest: { state: 'ready', attempts: 0 } });
      const countJobs = async () => (await tx.execute(sql`SELECT count(*)::int AS n FROM job WHERE org_id=${orgId} AND payload->>'automaticScheduleId'=${recovery.replacementScheduleId}`)).rows[0].n;
      expect(await countJobs()).toBe(1);
      await recoverDigestSchedule(tx, orgId, 'test-operator', recovery);
      expect(await countJobs()).toBe(1);
      expect(await recoverDigestSchedule(tx, orgId, 'test-operator', { ...recovery, replacementScheduleId: randomUUID() })).toBeNull();
      await tx.update(schema.orgSettings).set({ weeklyDigestScheduleId: null }).where(eq(schema.orgSettings.orgId, orgId));
      expect(await readDigestScheduleStatus(tx, orgId)).toEqual({ enabled: false, workspacePermitted: false, latest: null });
      throw rollback;
    })).rejects.toBe(rollback);
  });
});
