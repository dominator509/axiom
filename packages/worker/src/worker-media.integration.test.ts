import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db, pool, schema } from '@axiom/db';
import { processJob, workerTick } from './worker.js';
import type { JobRow } from './types.js';
import { tosScan } from './executors/tos.js';
import { claimExactMediaJob, claimNextModelMediaJob } from './claim.js';

const url = process.env.TEST_DATABASE_URL;
const orgId = '11111111-1111-4111-8111-111111111111';
const modelId = '9283b927-b95d-461c-90d0-729bc2d13852';
const videoHash = process.env.AXIOM_VIDEO_REHEARSAL_HASH;
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

  it('scoped loop claims only eligible local transforms with owned source media', async () => {
    const assetId = randomUUID(), operationId = randomUUID(), completedId = randomUUID();
    const ids = Array.from({ length: 5 }, () => randomUUID());
    try {
      await scoped(async tx => {
        await tx.insert(schema.asset).values({ id: assetId, orgId, modelId, kind: 'image', fileName: 'fixture.jpg',
          mimeType: 'image/jpeg', fileSize: 20, storageKey: 'fixture.jpg', sha256: Buffer.from(randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', ''), 'hex') });
        await tx.insert(schema.mediaOperation).values([
          { id: operationId, orgId, modelId, sourceAssetId: assetId, type: 'image_resize', state: 'queued' },
          { id: completedId, orgId, modelId, sourceAssetId: assetId, type: 'image_resize', state: 'completed' },
        ]);
        await tx.insert(schema.job).values(ids.map((id, index) => ({ id, orgId, queue: 'media',
          kind: index === 0 ? 'publish.target' : 'media.transform', state: 'ready', attempts: index === 1 ? 1 : 0,
          runAfter: index === 2 ? new Date(Date.now() + 3600000) : new Date(0),
          payload: { operationId: index === 3 ? completedId : operationId },
        })));
      });
      for (const scope of [{ orgId: randomUUID(), modelId }, { orgId, modelId: randomUUID() }]) {
        expect(await db.transaction(tx => claimNextModelMediaJob(tx, 'transform-only', scope))).toEqual({ job: null, empty: true });
      }
      const claim = await db.transaction(tx => claimNextModelMediaJob(tx, 'transform-only', { orgId, modelId }));
      expect(claim.job).toMatchObject({ id: ids[4], kind: 'media.transform', state: 'running' });
      expect(await db.transaction(tx => claimNextModelMediaJob(tx, 'another', { orgId, modelId }))).toEqual({ job: null, empty: true });
      for (const id of ids.slice(0, 4)) {
        const [job] = await scoped(tx => tx.select().from(schema.job).where(eq(schema.job.id, id)));
        expect(job.state).toBe('ready'); expect(job.lockedBy).toBeNull();
      }
    } finally {
      await scoped(async tx => {
        for (const id of ids) await tx.delete(schema.job).where(eq(schema.job.id, id));
        for (const id of [operationId, completedId]) await tx.delete(schema.mediaOperation).where(eq(schema.mediaOperation.id, id));
        await tx.delete(schema.asset).where(eq(schema.asset.id, assetId));
      });
    }
  });

  it('scoped first-attempt failures do not leave an unclaimable queued retry', async () => {
    const bundleId = randomUUID(), jobId = randomUUID();
    try {
      await scoped(async tx => {
        await tx.insert(schema.contentBundle).values({ id: bundleId, orgId, modelId, state: 'generated' });
        await tx.insert(schema.job).values({ id: jobId, orgId, queue: 'content', kind: 'media.generate',
          state: 'ready', attempts: 0, maxAttempts: 3, payload: { bundleId } });
      });
      const result = await workerTick({ workerId: 'scoped-failure', mediaScope: { orgId, modelId },
        executors: { 'media.generate': async () => { throw new Error('Fixture missing runtime config; no provider call'); } },
      });
      expect(result.dead).toBe(1); expect(result.failed).toBe(0);
      const [job] = await scoped(tx => tx.select().from(schema.job).where(eq(schema.job.id, jobId)));
      const [bundle] = await scoped(tx => tx.select().from(schema.contentBundle).where(eq(schema.contentBundle.id, bundleId)));
      expect(job.state).toBe('dead'); expect(job.lockedBy).toBeNull(); expect(bundle.state).toBe('hold');
    } finally {
      await scoped(async tx => {
        await tx.delete(schema.job).where(eq(schema.job.id, jobId));
        await tx.delete(schema.contentBundle).where(eq(schema.contentBundle.id, bundleId));
      });
    }
  });

  it.each(['media.generate', 'tos.scan'])('model media loop claims only unstarted %s jobs', async kind => {
    const bundleId = randomUUID();
    const ids = Array.from({ length: 5 }, () => randomUUID());
    try {
      await scoped(async tx => {
        await tx.insert(schema.contentBundle).values({ id: bundleId, orgId, modelId, state: 'generated' });
        await tx.insert(schema.job).values(ids.map((id, index) => ({ id, orgId, queue: 'fixture',
          kind: index === 0 ? 'publish.target' : kind, state: 'ready', attempts: index === 1 ? 1 : 0,
          runAfter: index === 3 ? new Date(Date.now() + 3600000) : new Date(0), payload: { bundleId },
        })));
        await tx.insert(schema.mediaGenerationAttempt).values({ jobId: ids[2], orgId, modelId, bundleId, userId: 'fixture', kind: 'image' });
      });
      for (const scope of [{ orgId: randomUUID(), modelId }, { orgId, modelId: randomUUID() }]) {
        expect(await db.transaction(tx => claimNextModelMediaJob(tx, 'media-only', scope))).toEqual({ job: null, empty: true });
      }
      const result = await db.transaction(tx => claimNextModelMediaJob(tx, 'media-only', { orgId, modelId }));
      expect(result.job).toMatchObject({ id: ids[4], kind, org_id: orgId, state: 'running' });
      expect(await db.transaction(tx => claimNextModelMediaJob(tx, 'second-worker', { orgId, modelId })))
        .toEqual({ job: null, empty: true });
      for (const id of ids.slice(0, 4)) {
        const [untouched] = await scoped(tx => tx.select().from(schema.job).where(eq(schema.job.id, id)));
        expect(untouched.state).toBe('ready'); expect(untouched.lockedBy).toBeNull();
      }
    } finally {
      await scoped(async tx => {
        // Dispatch markers are intentionally non-deletable by the runtime role.
        // The isolated runner drops this entire disposable database afterward.
        for (const id of ids) await tx.delete(schema.job).where(eq(schema.job.id, id));
        await tx.delete(schema.contentBundle).where(eq(schema.contentBundle.id, bundleId));
      });
    }
  });

  it.each(['media.generate', 'tos.scan', 'publish.target'])('exact media claim bounds %s without sweeping the queue', async kind => {
    const bundleId = randomUUID();
    const jobId = randomUUID();
    const unrelatedId = randomUUID();
    const target = { orgId, modelId, bundleId, jobId };
    try {
      await scoped(async tx => {
        await tx.insert(schema.contentBundle).values({ id: bundleId, orgId, modelId, state: 'generated' });
        await tx.insert(schema.job).values([
          { id: jobId, orgId, queue: 'fixture', kind, state: 'ready', payload: { bundleId } },
          { id: unrelatedId, orgId, queue: 'fixture', kind: 'publish.target', state: 'ready', payload: { bundleId } },
        ]);
      });
      for (const field of ['orgId', 'modelId', 'bundleId', 'jobId'] as const) {
        const result = await db.transaction(tx => claimExactMediaJob(tx, 'bounded-fixture', { ...target, [field]: randomUUID() }));
        expect(result).toEqual({ job: null, empty: true });
      }
      const result = await db.transaction(tx => claimExactMediaJob(tx, 'bounded-fixture', target));
      expect(result.empty).toBe(kind === 'publish.target');
      if (kind !== 'publish.target') {
        expect(result.job).toMatchObject({ id: jobId, org_id: orgId, state: 'running', locked_by: 'bounded-fixture' });
        expect(await db.transaction(tx => claimExactMediaJob(tx, 'another-worker', target))).toEqual({ job: null, empty: true });
      }
      const [unrelated] = await scoped(tx => tx.select().from(schema.job).where(eq(schema.job.id, unrelatedId)));
      expect(unrelated.state).toBe('ready');
      expect(unrelated.lockedBy).toBeNull();
    } finally {
      await scoped(async tx => {
        await tx.delete(schema.job).where(eq(schema.job.id, jobId));
        await tx.delete(schema.job).where(eq(schema.job.id, unrelatedId));
        await tx.delete(schema.contentBundle).where(eq(schema.contentBundle.id, bundleId));
      });
    }
  });

  it.each([
    { lostLease: false, video: false }, { lostLease: true, video: false },
    ...(videoHash ? [{ lostLease: false, video: true }, { lostLease: true, video: true }] : []),
  ])('commits ToS verdict and review handoff together: %j', async ({ lostLease, video }) => {
    const bundleId = randomUUID();
    const jobId = randomUUID();
    const revisionId = randomUUID();
    const assetId = video ? randomUUID() : undefined;
    if (video) {
      expect(videoHash).toMatch(/^[0-9a-f]{64}$/);
      expect(Number(process.env.AXIOM_VIDEO_REHEARSAL_SIZE)).toBeGreaterThan(12);
      for (const key of ['MEDIA_PLANE_URL', 'VISION_ENGINE_URL']) {
        const endpoint = new URL(process.env[key]!);
        expect(endpoint.hostname).toBe('127.0.0.1');
        expect(endpoint.protocol).toBe('http:');
      }
    }
    try {
      const item = await scoped(async tx => {
        if (video) await tx.insert(schema.asset).values({ id: assetId, orgId, modelId,
          kind: 'video', fileName: 'source.mp4', mimeType: 'video/mp4',
          fileSize: Number(process.env.AXIOM_VIDEO_REHEARSAL_SIZE), storageKey: 'source.mp4',
          sha256: Buffer.from(videoHash!, 'hex') });
        await tx.insert(schema.contentBundle).values({ id: bundleId, orgId, modelId,
          ...(assetId ? { assetId } : {}),
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
      expect(records.bundles[0].tosReport?.verdict).toBe(lostLease ? 'pending' : video ? 'review' : 'pass');
      expect(records.bundles[0].tosReport?.revisionId).toBe(revisionId);
      expect(records.jobs[0].state).toBe(lostLease ? 'running' : 'done');
      expect(records.cards.rows).toHaveLength(lostLease ? 0 : 1);
      if (!lostLease) expect(records.cards.rows[0].payload).toEqual({ bundleId, revisionId });
      if (video && !lostLease) expect(records.bundles[0].tosReport?.videoScan).toEqual(expect.objectContaining({
        assetSha256: videoHash, policy: 'sampled-2fps-v1', frameCount: expect.any(Number),
        scanId: expect.stringMatching(/^[0-9a-f-]{36}$/), contentDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
        automatedScores: [expect.objectContaining({ platform: 'telegram', verdict: 'pass' })],
      }));
      if (lostLease) expect(records.bundles[0].tosReport?.videoScan).toBeUndefined();
    } finally {
      await scoped(async tx => {
        await tx.execute(sql`DELETE FROM job WHERE org_id=${orgId} AND kind='relay.card'
          AND payload->>'bundleId'=${bundleId}`);
        await tx.delete(schema.job).where(eq(schema.job.id, jobId));
        await tx.delete(schema.contentBundle).where(eq(schema.contentBundle.id, bundleId));
        if (assetId) await tx.delete(schema.asset).where(eq(schema.asset.id, assetId));
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
