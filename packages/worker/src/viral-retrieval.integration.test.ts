import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db, pool, schema } from '@axiom/db';
import { retrieveTopExemplars } from './viral-retrieval.js';
import { embedExemplarIntent } from './embedding.js';
import { viralLabel } from './executors/viral.js';
import type { JobRow } from './types.js';

const url = process.env.TEST_DATABASE_URL;
const orgId = '11111111-1111-4111-8111-111111111111';
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function fixture(check: (tx: Transaction, modelId: string, otherModel: string) => Promise<void>) {
  const rollback = new Error('fixture rollback');
  try {
    await db.transaction(async tx => {
      await tx.execute(sql`SELECT set_config('app.current_org_id', ${orgId}, true)`);
      const modelId = randomUUID(), otherModel = randomUUID();
      await tx.insert(schema.modelProfile).values([modelId, otherModel].map(id => ({ id, orgId, handle: id, displayName: 'Retrieval fixture' })));
      await tx.insert(schema.orgSettings).values({ orgId, viralSharing: false }).onConflictDoUpdate({ target: schema.orgSettings.orgId, set: { viralSharing: false } });
      for (const [index, label, verified, version, platform] of [
        [0, 'strong', true, true, 'instagram'], [1, 'weak', true, true, 'instagram'],
        [2, 'viral', false, true, 'instagram'], [3, 'viral', true, false, 'instagram'],
        [4, 'viral', true, true, 'x'], [5, 'strong', true, true, 'instagram'],
      ] as const) {
        await tx.insert(schema.viralExemplar).values({
          orgId, modelId: index === 5 ? otherModel : modelId, platform, label, perfScore: 2,
          embedding: embedExemplarIntent('blue ceramic vase'),
          features: { caption: `Private caption ${index}`, hashtags: ['private-tag'],
            ...(verified ? { evidence_source: 'published-provider-snapshot-v2' } : {}),
            ...(version ? { embedding_version: 'lexical-v1' } : {}) },
        });
      }
      await check(tx, modelId, otherModel);
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
}

describe.skipIf(!url)('exemplar retrieval in real PostgreSQL', () => {
  beforeAll(async () => {
    const target = new URL(url!);
    expect(process.env.DATABASE_URL).toBe(url);
    expect(['localhost', '127.0.0.1']).toContain(target.hostname);
    expect(target.username).toBe('axiom_app');
    expect(target.pathname).toMatch(/^\/(?:axiom_test|axiom_workspace_test_[0-9a-f]{16})$/);
    const role = await pool.query('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user');
    expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });
  afterAll(async () => { await pool.end(); });
  it('executes cosine retrieval and excludes other models, platforms, weak and legacy evidence', async () => {
    await fixture(async (tx, modelId) => {
      const rows = await retrieveTopExemplars(tx, orgId, modelId, 'instagram', 10, 'blue vase');
      expect(rows).toHaveLength(1);
      expect(rows[0].caption).toBe('Private caption 0');
    });
  });
  it('shares only abstract structure when explicitly enabled', async () => {
    await fixture(async (tx, modelId) => {
      await tx.execute(sql`UPDATE org_settings SET viral_sharing=true WHERE org_id=${orgId}`);
      const rows = await retrieveTopExemplars(tx, orgId, modelId, 'instagram', 10, 'vase');
      expect(rows).toHaveLength(2);
      const shared = rows.find(row => row.title === 'Shared structural guidance');
      expect(shared).toMatchObject({ caption: '', hashtags: [] });
      expect(JSON.stringify(shared)).not.toContain('Private');
    });
  });
  it('enforces tenant RLS even when the query supplies the original org', async () => {
    await fixture(async (tx, modelId) => {
      await tx.execute(sql`SELECT set_config('app.current_org_id', ${randomUUID()}, true)`);
      expect(await retrieveTopExemplars(tx, orgId, modelId, 'instagram', 10, 'vase')).toEqual([]);
    });
  });
  it('handles punctuation-only intent without a zero query vector', async () => {
    await fixture(async (tx, modelId) => {
      expect(await retrieveTopExemplars(tx, orgId, modelId, 'instagram', 1, '?!')).toHaveLength(1);
    });
  });
  it('refreshes one stable recipe and embedding rather than accumulating repeated polls', async () => {
    await fixture(async (tx, modelId) => {
      const bundleId = randomUUID(), targetId = randomUUID();
      await tx.insert(schema.contentBundle).values({ id: bundleId, orgId, modelId, captions: { instagram: 'Blue ceramic vase' } });
      await tx.insert(schema.postTarget).values({ id: targetId, orgId, bundleId, platform: 'instagram', state: 'published', remoteId: targetId, idemKey: Buffer.from(randomUUID()),
        publicationSnapshot: { caption: 'Blue ceramic vase', hashtags: [], modelId, assetId: null, scheduledFor: null } });
      await tx.insert(schema.postMetric).values({ postTargetId: targetId, platform: 'instagram', remoteId: targetId, source: 'provider', views: 10, likes: 1, engagementRate: .1, collectedAt: new Date(Date.now() - 1000) });
      const job: JobRow = {
        id: randomUUID(), org_id: orgId, queue: 'viral', kind: 'viral.label', payload: { targetId },
        state: 'running', attempts: 1, max_attempts: 3, last_error: null,
        run_after: new Date(), locked_by: 'retrieval-test', locked_at: new Date(),
        dedupe_key: null, scheduled_for: null, started_at: new Date(), completed_at: null, created_at: new Date(),
      };
      const context = { tx, job, workerId: 'retrieval-test', killSwitchEnabled: false };
      await viralLabel(context);
      const [first] = await tx.select().from(schema.viralRecipe).where(eq(schema.viralRecipe.sourceTargetId, targetId));
      expect(first.realizedMetrics.views).toBe(10);
      await tx.update(schema.contentBundle).set({ captions: { instagram: 'A changed question?' } }).where(eq(schema.contentBundle.id, bundleId));
      await tx.insert(schema.postMetric).values({ postTargetId: targetId, platform: 'instagram', remoteId: targetId, source: 'provider', views: 20, likes: 3, engagementRate: .15 });
      await viralLabel(context);
      await viralLabel(context);
      const recipes = await tx.select().from(schema.viralRecipe).where(eq(schema.viralRecipe.sourceTargetId, targetId));
      expect(recipes).toHaveLength(1);
      expect(recipes[0].id).toBe(first.id);
      expect(recipes[0].realizedMetrics.views).toBe(20);
      expect(recipes[0].recipe.caption).toBe('Blue ceramic vase');
      const embeddings = await tx.select().from(schema.viralEmbedding).where(eq(schema.viralEmbedding.recipeId, first.id));
      expect(embeddings).toHaveLength(1);
      expect(embeddings[0].id).toBe(first.id);
      const states = await tx.select().from(schema.banditState).where(eq(schema.banditState.modelId, modelId));
      expect(states).toHaveLength(1);
      expect(states[0]).toMatchObject({ plays: 1, alpha: 1, beta: 2, reward: 0, arm: 'short:statement' });
    });
  });
});
