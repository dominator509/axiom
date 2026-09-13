import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db, pool, schema } from '@axiom/db';
import { processJob } from './worker.js';
import type { JobRow } from './types.js';
import { tosScan } from './executors/tos.js';

const url = process.env.TEST_DATABASE_URL;
const orgId = '11111111-1111-4111-8111-111111111111';
const modelId = '9283b927-b95d-461c-90d0-729bc2d13852';
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const scoped = <T>(operation: (tx: Transaction) => Promise<T>) => db.transaction(async tx => {
  await tx.execute(sql`SELECT set_config('app.current_org_id', ${orgId}, true)`);
  return operation(tx);
});

describe.skipIf(!url)('terminal media state in real PostgreSQL', () => {
  beforeAll(async () => {
    // Refuse recovery/production databases even if an operator exported a URL.
    const target = new URL(url!);
    expect(process.env.DATABASE_URL).toBe(url);
    expect(['localhost', '127.0.0.1']).toContain(target.hostname);
    expect(target.username).toBe('axiom_app');
    expect(target.pathname).toMatch(/^\/(?:axiom_test|axiom_workspace_test_[0-9a-f]{16})$/);
    const role = await pool.query('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user');
    expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });
  afterAll(async () => { await pool.end(); });

  it.each([false, true])('commits ToS verdict and review handoff together; lostLease=%s', async lostLease => {
    const bundleId = randomUUID();
    const jobId = randomUUID();
    const revisionId = randomUUID();
    try {
      const item = await scoped(async tx => {
        await tx.insert(schema.contentBundle).values({ id: bundleId, orgId, modelId,
          state: 'generated', captions: { telegram: 'A peaceful landscape at sunrise.' }, hashtags: [],
          tosReport: { verdict: 'pending', revisionId } });
        await tx.insert(schema.job).values({ id: jobId, orgId, queue: 'tos', kind: 'tos.scan',
          payload: { bundleId }, state: 'running', attempts: 1, maxAttempts: 3,
          lockedBy: lostLease ? 'replacement-worker' : 'fixture-worker', lockedAt: new Date() });
        const result = await tx.execute(sql`SELECT * FROM job WHERE id=${jobId}`);
        return result.rows[0] as unknown as JobRow;
      });
      const operation = processJob(item, { 'tos.scan': tosScan }, 'fixture-worker', {});
      if (lostLease) await expect(operation).rejects.toThrow('lease ownership lost before state transition');
      else expect(await operation).toBe('done');
      const records = await scoped(async tx => ({
        bundles: await tx.select().from(schema.contentBundle).where(eq(schema.contentBundle.id, bundleId)),
        jobs: await tx.select().from(schema.job).where(eq(schema.job.id, jobId)),
        cards: await tx.execute(sql`SELECT payload FROM job WHERE org_id=${orgId}
          AND kind='relay.card' AND payload->>'bundleId'=${bundleId}`),
      }));
      expect(records.bundles[0].tosReport?.verdict).toBe(lostLease ? 'pending' : 'pass');
      expect(records.bundles[0].tosReport?.revisionId).toBe(revisionId);
      expect(records.jobs[0].state).toBe(lostLease ? 'running' : 'done');
      expect(records.cards.rows).toHaveLength(lostLease ? 0 : 1);
      if (!lostLease) expect(records.cards.rows[0].payload).toEqual({ bundleId, revisionId });
    } finally {
      await scoped(async tx => {
        await tx.execute(sql`DELETE FROM job WHERE org_id=${orgId} AND kind='relay.card'
          AND payload->>'bundleId'=${bundleId}`);
        await tx.delete(schema.job).where(eq(schema.job.id, jobId));
        await tx.delete(schema.contentBundle).where(eq(schema.contentBundle.id, bundleId));
      });
    }
  });

  it.each([
    { dispatched: false, lostLease: false }, { dispatched: true, lostLease: false },
    { dispatched: false, lostLease: true }, { dispatched: true, lostLease: true },
  ])('commits or rolls back both records: %j', async ({ dispatched, lostLease }) => {
    const bundleId = randomUUID();
    const jobId = randomUUID();
    try {
      const item = await scoped(async tx => {
        await tx.insert(schema.contentBundle).values({ id: bundleId, orgId, modelId,
          state: 'generated', tosReport: { verdict: 'pending' } });
        await tx.insert(schema.job).values({ id: jobId, orgId, queue: 'content', kind: 'media.generate',
          payload: { bundleId }, state: 'running', attempts: 2, maxAttempts: 3,
          lockedBy: lostLease ? 'replacement-worker' : 'fixture-worker', lockedAt: new Date() });
        const result = await tx.execute(sql`SELECT * FROM job WHERE id=${jobId}`);
        return result.rows[0] as unknown as JobRow;
      });
      const operation = processJob(item, { 'media.generate': async ctx => {
        if (dispatched) ctx.markExternalSideEffect?.();
        throw new Error('Injected fixture failure; no provider request');
      } }, 'fixture-worker', {});
      if (lostLease) await expect(operation).rejects.toThrow('lease ownership lost before state transition');
      else expect(await operation).toBe('dead');
      const records = await scoped(async tx => ({
        bundles: await tx.select().from(schema.contentBundle).where(eq(schema.contentBundle.id, bundleId)),
        jobs: await tx.select().from(schema.job).where(eq(schema.job.id, jobId)),
      }));
      expect(records.bundles[0].state).toBe(lostLease ? 'generated' : 'hold');
      expect(records.jobs[0].state).toBe(lostLease ? 'running' : 'dead');
      expect(records.jobs[0].lockedBy).toBe(lostLease ? 'replacement-worker' : null);
      expect(records.jobs[0].lastError?.startsWith('external-side-effect-unknown:') ?? false)
        .toBe(dispatched && !lostLease);
    } finally {
      await scoped(async tx => {
        await tx.delete(schema.job).where(eq(schema.job.id, jobId));
        await tx.delete(schema.contentBundle).where(eq(schema.contentBundle.id, bundleId));
      });
    }
  });
});
