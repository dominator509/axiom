import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db, pool, schema } from '@axiom/db';
import { publishedExemplarEvidence, readExemplarPatterns } from './routes/viral.js';

const url = process.env.TEST_DATABASE_URL;
const orgId = '11111111-1111-4111-8111-111111111111', modelId = randomUUID();
describe.skipIf(!url)('published insights evidence in PostgreSQL', () => {
  afterAll(async () => { await pool.end(); });
  it('excludes legacy, manual, mismatched, unpublished and future observations without multiplying polls', async () => {
    const target = new URL(url!);
    expect(process.env.DATABASE_URL).toBe(url);
    expect(['localhost', '127.0.0.1']).toContain(target.hostname);
    expect(target.username).toBe('axiom_app');
    expect(target.pathname).toMatch(/^\/(?:axiom_test|axiom_workspace_test_[0-9a-f]{16})$/);
    const rollback = new Error('fixture rollback');
    await expect(db.transaction(async tx => {
      await tx.execute(sql`SELECT set_config('app.current_org_id', ${orgId}, true)`);
      await tx.insert(schema.modelProfile).values({ id: modelId, orgId, displayName: 'Pattern fixture', handle: modelId });
      const ids: string[] = [];
      const cases = ['valid', 'valid2', 'valid3', 'rare', 'legacy', 'manual', 'remote-mismatch', 'platform-mismatch', 'pending', 'future-metric', 'future-publication'];
      for (const kind of cases) {
        const bundleId = randomUUID(), targetId = randomUUID(), id = randomUUID(); ids.push(id);
        await tx.insert(schema.contentBundle).values({ id: bundleId, orgId, modelId });
        await tx.insert(schema.postTarget).values({ id: targetId, orgId, bundleId, platform: 'instagram', state: kind === 'pending' ? 'pending' : 'published', remoteId: targetId, publishedAt: kind === 'future-publication' ? new Date('2099-01-01') : new Date('2026-01-01'), idemKey: Buffer.from(randomUUID()) });
        await tx.insert(schema.viralExemplar).values({ id, orgId, modelId, bundleId, platform: 'instagram', label: 'viral', perfScore: kind === 'valid2' ? 1 : kind === 'valid3' ? 0 : 2, features: kind === 'legacy' ? {} : { evidence_source: 'published-provider-snapshot-v2', learning_arm: kind === 'rare' ? 'long:statement' : 'short:question', learning_context: 'learn-v1:scheduled-utc-3' }, embedding: Array(768).fill(0) });
        await tx.insert(schema.postMetric).values({ postTargetId: targetId, platform: kind === 'platform-mismatch' ? 'x' : 'instagram', source: kind === 'manual' ? 'manual' : 'provider', remoteId: kind === 'remote-mismatch' ? 'other' : targetId, views: 100, collectedAt: kind === 'future-metric' ? new Date('2099-01-01') : new Date('2026-02-01') });
        if (kind === 'valid') await tx.insert(schema.postMetric).values({ postTargetId: targetId, platform: 'instagram', source: 'provider', remoteId: targetId, views: 101, collectedAt: new Date('2026-02-02') });
      }
      const rows = await tx.select({ id: schema.viralExemplar.id }).from(schema.viralExemplar)
        .where(and(eq(schema.viralExemplar.orgId, orgId), eq(schema.viralExemplar.modelId, modelId), publishedExemplarEvidence()));
      expect(new Set(rows.filter(row => ids.includes(row.id)).map(row => row.id))).toEqual(new Set(ids.slice(0, 4)));
      const patterns = await readExemplarPatterns(tx, orgId, modelId);
      expect(patterns).toEqual({ groups: [{ platform: 'instagram', arm: 'short:question', context: 'learn-v1:scheduled-utc-3', mediaFormat: 'unknown', tosVerdict: 'unavailable', publishedHourUtc: null, sampleSize: 3, meanScore: 1, sourceScope: 'model' }], truncated: false, minimumSample: 3 });
      expect((await readExemplarPatterns(tx, orgId, modelId, sql`false`)).groups).toEqual([]);
      expect((await readExemplarPatterns(tx, randomUUID(), modelId)).groups).toEqual([]);
      expect((await readExemplarPatterns(tx, orgId, randomUUID())).groups).toEqual([]);
      throw rollback;
    })).rejects.toBe(rollback);
  });
});
