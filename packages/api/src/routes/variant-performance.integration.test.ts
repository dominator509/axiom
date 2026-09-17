import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { eq, inArray, sql } from 'drizzle-orm';
import { db, pool, schema } from '@axiom/db';
import type { AppBindings } from '../index.js';
import { variantExperimentsRouter } from './variant-experiments.js';

const url = process.env.TEST_DATABASE_URL;
const orgId = '11111111-1111-4111-8111-111111111111', modelId = '9283b927-b95d-461c-90d0-729bc2d13852';
const assetId = randomUUID(), variantId = randomUUID(), otherVariant = randomUUID(), experimentId = randomUUID();
const bundles = Array.from({ length: 5 }, () => randomUUID()), targets = Array.from({ length: 5 }, () => randomUUID());
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const scoped = <T>(operation: (tx: Transaction) => Promise<T>) => db.transaction(async tx => {
  await tx.execute(sql`SELECT set_config('app.current_org_id', ${orgId}, true)`);
  return operation(tx);
});
function request(org = orgId, model = modelId) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => { c.set('orgId', org); await next(); });
  app.route('/', variantExperimentsRouter);
  return app.request(`/models/${model}/variant-experiments/${experimentId}/performance`);
}
function promote(variant: string) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => { c.set('orgId', orgId); await next(); });
  app.route('/', variantExperimentsRouter);
  return app.request(`/models/${modelId}/variant-experiments/${experimentId}/promote`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ variantId: variant }),
  });
}
describe.skipIf(!url)('published variant performance in PostgreSQL', () => {
  beforeAll(async () => {
    const target = new URL(url!);
    expect(process.env.DATABASE_URL).toBe(url);
    expect(['localhost', '127.0.0.1']).toContain(target.hostname);
    expect(target.username).toBe('axiom_app');
    expect(target.pathname).toMatch(/^\/(?:axiom_test|axiom_workspace_test_[0-9a-f]{16})$/);
    const role = await pool.query('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user');
    expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    await scoped(async tx => {
      await tx.insert(schema.asset).values({ id: assetId, orgId, modelId, kind: 'image', mimeType: 'image/jpeg', fileName: 'fixture.jpg', fileSize: 1, storageKey: 'fixture.jpg', sha256: Buffer.from(randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', ''), 'hex') });
      await tx.insert(schema.assetVariant).values([variantId, otherVariant].map(id => ({ id, orgId, assetId, storageKey: 'fixture.jpg' })));
      await tx.insert(schema.variantExperiment).values({ id: experimentId, orgId, modelId, platform: 'instagram', name: experimentId, variantIds: [variantId, otherVariant] });
      for (let i = 0; i < 5; i++) {
        await tx.insert(schema.contentBundle).values({ id: bundles[i], orgId, modelId, assetId, sourceVariantId: variantId, captions: { instagram: 'Fixture' } });
        if (i < 4) await tx.insert(schema.variantExperimentAssignment).values({ orgId, experimentId, variantId, assignmentKey: randomUUID(), reviewBundleId: bundles[i] });
        await tx.insert(schema.postTarget).values({ id: targets[i], orgId, bundleId: bundles[i], platform: i === 3 ? 'x' : 'instagram', state: i === 1 ? 'pending' : 'published', remoteId: `remote-${i}`, idemKey: Buffer.from(randomUUID()) });
        await tx.insert(schema.postMetric).values({ postTargetId: targets[i], source: 'provider', platform: i === 3 ? 'x' : 'instagram', remoteId: i === 2 ? 'wrong-remote' : `remote-${i}`, views: 10, collectedAt: new Date('2026-09-01T00:00:00Z') });
      }
      await tx.insert(schema.postMetric).values({ postTargetId: targets[0], source: 'provider', platform: 'instagram', remoteId: 'remote-0', views: 25, collectedAt: new Date('2026-09-02T00:00:00Z') });
      for (const source of ['manual', 'legacy'] as const) await tx.insert(schema.postMetric).values({ postTargetId: targets[0], source, platform: 'instagram', remoteId: 'remote-0', views: 999999, collectedAt: new Date('2026-09-03T00:00:00Z') });
    });
  });
  afterAll(async () => {
    await scoped(async tx => {
      await tx.delete(schema.postMetric).where(inArray(schema.postMetric.postTargetId, targets));
      await tx.delete(schema.postTarget).where(inArray(schema.postTarget.id, targets));
      await tx.delete(schema.variantExperimentAssignment).where(eq(schema.variantExperimentAssignment.experimentId, experimentId));
      await tx.delete(schema.contentBundle).where(inArray(schema.contentBundle.id, bundles));
      await tx.delete(schema.variantExperiment).where(eq(schema.variantExperiment.id, experimentId));
      await tx.delete(schema.assetVariant).where(inArray(schema.assetVariant.id, [variantId, otherVariant]));
      await tx.delete(schema.asset).where(eq(schema.asset.id, assetId));
    });
    await pool.end();
  });
  it('selects only the latest matching published snapshot, not duplicates or unrelated metrics', async () => {
    const response = await request();
    expect(response.status).toBe(200);
    const result = await response.json() as { data: unknown[]; meta: unknown };
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({ targetId: targets[0], variantId, views: 25 });
    expect(result.meta).toEqual({ truncated: false, source: 'published-target-metrics' });
  });
  it('rejects a different tenant', async () => { expect((await request(randomUUID())).status).toBe(404); });
  it('rejects a different model in the same tenant', async () => { expect((await request(orgId, randomUUID())).status).toBe(404); });
  it('serializes competing winner decisions and preserves identical replay', async () => {
    await scoped(async tx => {
      await tx.update(schema.variantExperiment).set({ status: 'running' }).where(eq(schema.variantExperiment.id, experimentId));
      await tx.insert(schema.variantExperimentAssignment).values([variantId, otherVariant].map(id => ({ orgId, experimentId, variantId: id, assignmentKey: randomUUID(), converted: true, outcomeAt: new Date() })));
    });
    const responses = await Promise.all([promote(variantId), promote(otherVariant)]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    const [saved] = await scoped(tx => tx.select().from(schema.variantExperiment).where(eq(schema.variantExperiment.id, experimentId)));
    expect(saved.status).toBe('completed');
    expect((await promote(saved.winnerVariantId!)).status).toBe(200);
    const [replayed] = await scoped(tx => tx.select().from(schema.variantExperiment).where(eq(schema.variantExperiment.id, experimentId)));
    expect(replayed.updatedAt).toEqual(saved.updatedAt);
  });
  it('stops attributing provider history after the underlying caption changes', async () => {
    await scoped(tx => tx.update(schema.contentBundle).set({ captions: { instagram: 'Edited fixture' } }).where(eq(schema.contentBundle.id, bundles[0])));
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: [] });
  });
});
