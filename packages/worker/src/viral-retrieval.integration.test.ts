import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db, pool, schema } from '@axiom/db';
import { retrieveTopExemplars, retrieveCaptionGuidance } from './viral-retrieval.js';
import { captionGuidanceReceipt } from './caption-guidance.js';
import { embedExemplarIntent } from './embedding.js';
import { viralLabel } from './executors/viral.js';
import type { JobRow } from './types.js';
import { evaluateAutomaticVariants, evaluationDigest } from './variant-auto-evaluation.js';
import { refreshLearningState, selectLearnedGuidance } from './learning-state.js';
import { modelPlaybookContext } from './playbook-context.js';
import { digestWeekly } from './executors/digest.js';
import { enqueueWeeklyDigest, nextDigestAt } from './digest-schedule.js';

const url = process.env.TEST_DATABASE_URL;
const orgId = '11111111-1111-4111-8111-111111111111';
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
function digestJob(orgId: string, payload: Record<string, unknown> = {}): JobRow {
  return { id: randomUUID(), org_id: orgId, queue: 'digest', kind: 'digest.weekly', payload,
    state: 'running', attempts: 1, max_attempts: 3, last_error: null, run_after: new Date(),
    locked_by: 'digest-fixture', locked_at: new Date(), dedupe_key: null, scheduled_for: null,
    started_at: new Date(), completed_at: null, created_at: new Date() };
}
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
  it('builds digest cards only from matching published provider snapshots, with truthful units', async () => {
    await fixture(async tx => {
      const tenant = randomUUID(), modelId = randomUUID(), bundleId = randomUUID();
      await tx.execute(sql`SELECT set_config('app.current_org_id', ${tenant}, true)`);
      await tx.insert(schema.org).values({ id: tenant, name: 'Digest fixture', slug: tenant });
      await tx.insert(schema.modelProfile).values({ id: modelId, orgId: tenant, handle: modelId, displayName: 'Digest fixture' });
      await tx.insert(schema.contentBundle).values({ id: bundleId, orgId: tenant, modelId });
      const targetId = randomUUID(), pendingId = randomUUID();
      await tx.insert(schema.postTarget).values([
        { id: targetId, orgId: tenant, bundleId, platform: 'instagram', state: 'published', remoteId: targetId, idemKey: Buffer.from(targetId) },
        { id: pendingId, orgId: tenant, bundleId, platform: 'instagram', state: 'pending', remoteId: pendingId, idemKey: Buffer.from(pendingId) },
      ]);
      const collectedAt = new Date(Date.now() - 10_000);
      const ids = [randomUUID(), randomUUID()].sort();
      const metric = { postTargetId: targetId, platform: 'instagram', remoteId: targetId, source: 'provider' as const,
        views: 100, engagementRate: .052, collectedAt };
      await tx.insert(schema.postMetric).values([
        { ...metric, id: ids[0], views: 50 }, { ...metric, id: ids[1] },
        { ...metric, source: 'manual', views: 9000, collectedAt: new Date(collectedAt.getTime()+1000) },
        { ...metric, remoteId: 'wrong', views: 9000, collectedAt: new Date(collectedAt.getTime()+2000) },
        { ...metric, platform: 'x', views: 9000 },
        { ...metric, postTargetId: pendingId, remoteId: pendingId, views: 9000 },
        { ...metric, views: 9000, collectedAt: new Date(Date.now()+86400_000) },
      ]);
      await tx.insert(schema.viralExemplar).values([
        { orgId: tenant, modelId, platform: 'instagram', label: 'viral', embedding: embedExemplarIntent('digest'), features: { evidence_source: 'published-provider-snapshot-v2' } },
        { orgId: tenant, modelId, platform: 'x', label: 'viral', embedding: embedExemplarIntent('digest'), features: {} },
      ]);
      await digestWeekly({ tx, job: digestJob(tenant), workerId: 'digest-fixture', killSwitchEnabled: false });
      const cards = await tx.select().from(schema.relayCard).where(eq(schema.relayCard.orgId, tenant));
      expect(cards).toHaveLength(1);
      expect(cards[0].config?.digest).toMatchObject({ posts: 1, views: 100, avgEngagement: .052, topPlatform: 'instagram', viralPosts: 1 });
      expect(cards[0].description).toContain('5.20% average per-post engagement');
      expect(cards[0].description).toContain('not views gained during the week');
      const scheduleId = randomUUID();
      await tx.insert(schema.orgSettings).values({ orgId: tenant, weeklyDigestScheduleId: scheduleId });
      await enqueueWeeklyDigest(tx, tenant, scheduleId);
      await enqueueWeeklyDigest(tx, tenant, scheduleId);
      const queued = await tx.select().from(schema.job).where(eq(schema.job.orgId, tenant));
      expect(queued).toHaveLength(1);
      expect(queued[0].runAfter.toISOString()).toBe(nextDigestAt(new Date()).toISOString());
      expect(queued[0].payload).toMatchObject({ automaticScheduleId: scheduleId });
      await tx.update(schema.orgSettings).set({ weeklyDigestScheduleId: null }).where(eq(schema.orgSettings.orgId, tenant));
      const runAutomatic = (id: string) => digestWeekly({ tx, job: digestJob(tenant, { automaticScheduleId: id }), workerId: 'digest-fixture', killSwitchEnabled: false });
      await runAutomatic(scheduleId);
      expect(await tx.select().from(schema.relayCard).where(eq(schema.relayCard.orgId, tenant))).toHaveLength(1);
      const replacement = randomUUID();
      await tx.update(schema.orgSettings).set({ weeklyDigestScheduleId: replacement }).where(eq(schema.orgSettings.orgId, tenant));
      await runAutomatic(scheduleId);
      expect(await tx.select().from(schema.relayCard).where(eq(schema.relayCard.orgId, tenant))).toHaveLength(1);
      await runAutomatic(replacement);
      expect(await tx.select().from(schema.relayCard).where(eq(schema.relayCard.orgId, tenant))).toHaveLength(2);
      const nextJobs = await tx.select().from(schema.job).where(eq(schema.job.orgId, tenant));
      expect(nextJobs).toHaveLength(2);
      expect(nextJobs.some(row => row.payload?.automaticScheduleId === replacement)).toBe(true);
    });
  });
  it('reads only the current model/platform playbook and enforces tenant RLS', async () => {
    await fixture(async (tx, modelId, otherModel) => {
      await tx.insert(schema.playbookGuideline).values([
        { orgId, modelId, platform: 'instagram', optimalTimes: ['18:00'], cadencePerWeek: 4, upsellStrategy: 'OWN INSTAGRAM', revision: 3 },
        { orgId, modelId: otherModel, platform: 'instagram', optimalTimes: [], cadencePerWeek: 1, upsellStrategy: 'OTHER MODEL' },
        { orgId, modelId, platform: 'x', optimalTimes: [], cadencePerWeek: 2, upsellStrategy: 'OTHER PLATFORM' },
      ]);
      const context = await modelPlaybookContext(tx, orgId, modelId, 'instagram');
      expect(context).toContain('OWN INSTAGRAM');
      expect(context).toContain('Guideline revision: 3');
      expect(context).not.toContain('OTHER');
      expect(await modelPlaybookContext(tx, orgId, modelId, 'threads')).toBe('');
      await tx.execute(sql`SELECT set_config('app.current_org_id', ${randomUUID()}, true)`);
      expect(await modelPlaybookContext(tx, orgId, modelId, 'instagram')).toBe('');
    });
  });
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
      const selected = await retrieveCaptionGuidance(tx, orgId, modelId, 'instagram', 3, 'blue vase');
      const guidance = captionGuidanceReceipt('Blue ceramic vase', selected);
      await tx.insert(schema.contentBundle).values({ id: bundleId, orgId, modelId, captions: { instagram: 'Blue ceramic vase' },
        captionGuidance: { instagram: guidance } });
      const [savedBundle] = await tx.select().from(schema.contentBundle).where(eq(schema.contentBundle.id, bundleId));
      expect(savedBundle.captionGuidance.instagram).toEqual(guidance);
      await tx.insert(schema.postTarget).values({ id: targetId, orgId, bundleId, platform: 'instagram', state: 'published', remoteId: targetId, publishedAt: sql`now()`, idemKey: Buffer.from(randomUUID()),
        publicationSnapshot: { caption: 'Blue ceramic vase', hashtags: [], modelId, assetId: null, scheduledFor: null, captionGuidance: guidance } });
      // Both observations use the database transaction clock. Mixing JS wall
      // time with default now() can reverse them when fixture setup exceeds 1s.
      await tx.insert(schema.postMetric).values({ postTargetId: targetId, platform: 'instagram', remoteId: targetId, source: 'provider', views: 10, likes: 1, engagementRate: .1, collectedAt: sql`now() - interval '1 second'` });
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
      expect(recipes[0].recipe.generation_guidance).toEqual(guidance);
      const embeddings = await tx.select().from(schema.viralEmbedding).where(eq(schema.viralEmbedding.recipeId, first.id));
      expect(embeddings).toHaveLength(1);
      expect(embeddings[0].id).toBe(first.id);
      const states = await tx.select().from(schema.banditState).where(eq(schema.banditState.modelId, modelId));
      expect(states).toHaveLength(1);
      expect(states[0]).toMatchObject({ plays: 1, alpha: 1, beta: 2, reward: 0, arm: 'short:statement' });
      await expect(tx.transaction(async nested => {
        await nested.update(schema.postTarget).set({ publicationSnapshot: null }).where(eq(schema.postTarget.id, targetId));
      })).rejects.toThrow();
      await expect(tx.transaction(async nested => {
        await nested.update(schema.postTarget).set({ publicationSnapshot: { caption: 'Overwrite', hashtags: [], modelId, assetId: null, scheduledFor: null } }).where(eq(schema.postTarget.id, targetId));
      })).rejects.toThrow();
      const [preserved] = await tx.select().from(schema.postTarget).where(eq(schema.postTarget.id, targetId));
      expect(preserved.publicationSnapshot?.caption).toBe('Blue ceramic vase');
      await tx.update(schema.postTarget).set({ error: 'Status metadata may still change' }).where(eq(schema.postTarget.id, targetId));
    });
  });
  it('freezes an automatic winner from mature fixed evidence and ignores later metric changes', async () => {
    await fixture(async (tx, modelId) => {
      const assetId = randomUUID(), experimentId = randomUUID(), variants = [randomUUID(), randomUUID()];
      await tx.insert(schema.asset).values({ id: assetId, orgId, modelId, kind: 'image', mimeType: 'image/jpeg', fileName: 'fixture.jpg', fileSize: 1, storageKey: 'fixture.jpg', sha256: Buffer.alloc(32) });
      await tx.insert(schema.assetVariant).values(variants.map(id => ({ id, orgId, assetId, outputAssetId: assetId, storageKey: 'fixture.jpg' })));
      await tx.insert(schema.variantExperiment).values({ id: experimentId, orgId, modelId, name: experimentId, platform: 'instagram', variantIds: variants, status: 'running', evaluationPolicy: 'fixed-post-engagement-v1' });
      const records = Array.from({ length: 40 }, (_, i) => ({ bundleId: randomUUID(), targetId: randomUUID(), variantId: variants[i < 20 ? 0 : 1], rate: i < 20 ? 1 : 0 }));
      await tx.insert(schema.contentBundle).values(records.map(row => ({ id: row.bundleId, orgId, modelId, assetId, sourceVariantId: row.variantId, captions: { instagram: 'Fixture' } })));
      await tx.insert(schema.variantExperimentAssignment).values(records.map(row => ({ orgId, experimentId, variantId: row.variantId, assignmentKey: row.targetId, reviewBundleId: row.bundleId })));
      await tx.insert(schema.postTarget).values(records.map(row => ({ id: row.targetId, orgId, bundleId: row.bundleId, platform: 'instagram', state: 'published', remoteId: row.targetId, idemKey: Buffer.from(row.targetId), publishedAt: new Date('2026-09-01'), publicationSnapshot: { caption: 'Fixture', hashtags: [], modelId, assetId, scheduledFor: null } })));
      // Immature observations must not complete the experiment.
      await tx.insert(schema.postMetric).values(records.map(row => ({ postTargetId: row.targetId, platform: 'instagram', source: 'provider' as const, remoteId: row.targetId, views: 100, engagementRate: row.rate, collectedAt: new Date('2026-09-02') })));
      await evaluateAutomaticVariants(tx, orgId, modelId, 'instagram');
      let [saved] = await tx.select().from(schema.variantExperiment).where(eq(schema.variantExperiment.id, experimentId));
      expect(saved.status).toBe('running');
      await tx.insert(schema.postMetric).values(records.map(row => ({ postTargetId: row.targetId, platform: 'instagram', source: 'provider' as const, remoteId: row.targetId, views: 100, engagementRate: row.rate, collectedAt: new Date('2026-09-05') })));
      await evaluateAutomaticVariants(tx, orgId, modelId, 'instagram');
      [saved] = await tx.select().from(schema.variantExperiment).where(eq(schema.variantExperiment.id, experimentId));
      expect(saved).toMatchObject({ status: 'completed', winnerVariantId: variants[0] });
      const frozen = saved.evaluation;
      const decisions = await tx.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'variant.experiment.auto-evaluate'));
      expect(decisions.filter(row => row.detail?.experimentId === experimentId)).toHaveLength(1);
      expect(decisions.find(row => row.detail?.experimentId === experimentId)?.target).toBe(`${experimentId}:${evaluationDigest(frozen!)}`);
      await tx.insert(schema.postMetric).values(records.map(row => ({ postTargetId: row.targetId, platform: 'instagram', source: 'provider' as const, remoteId: row.targetId, views: 100, engagementRate: 1 - row.rate, collectedAt: new Date('2026-09-06') })));
      await evaluateAutomaticVariants(tx, orgId, modelId, 'instagram');
      [saved] = await tx.select().from(schema.variantExperiment).where(eq(schema.variantExperiment.id, experimentId));
      expect(saved.evaluation).toEqual(frozen);
      // A winner upgrades its existing target contribution, not its play count.
      await tx.insert(schema.viralRecipe).values({ orgId, modelId, platform: 'instagram', sourceTargetId: records[0].targetId, perfScore: 0,
        recipe: { evidence_source: 'published-provider-snapshot-v2', learning_context: 'learn-v1:scheduled-utc-unknown', learning_arm: 'short:statement' } });
      await refreshLearningState(tx, orgId, modelId, 'instagram');
      await refreshLearningState(tx, orgId, modelId, 'instagram');
      const rewards = await tx.select().from(schema.banditState).where(eq(schema.banditState.modelId, modelId));
      expect(rewards).toHaveLength(1);
      const clock = await tx.execute(sql`SELECT POWER(0.5, EXTRACT(EPOCH FROM (now()-TIMESTAMPTZ '2026-09-01'))/2592000.0) AS weight`);
      const weight = Number(clock.rows[0].weight);
      expect(rewards[0]).toMatchObject({ plays: 1, beta: 1 });
      expect(rewards[0].reward).toBeCloseTo(weight, 8);
      expect(rewards[0].alpha).toBeCloseTo(1 + weight, 8);
      const manualId = randomUUID();
      await tx.insert(schema.variantExperiment).values({ id: manualId, orgId, modelId, name: manualId, platform: 'instagram', variantIds: variants,
        status: 'completed', winnerVariantId: variants[1], evaluationPolicy: 'manual',
        evaluation: { observations: [{ targetId: records[20].targetId, variantId: variants[1] }] } });
      await tx.insert(schema.viralRecipe).values({ orgId, modelId, platform: 'instagram', sourceTargetId: records[20].targetId, perfScore: 0,
        recipe: { evidence_source: 'published-provider-snapshot-v2', learning_context: 'learn-v1:scheduled-utc-unknown', learning_arm: 'short:statement' } });
      await refreshLearningState(tx, orgId, modelId, 'instagram');
      const [manualExcluded] = await tx.select().from(schema.banditState).where(eq(schema.banditState.modelId, modelId));
      expect(manualExcluded.plays).toBe(2);
      expect(manualExcluded.reward).toBeCloseTo(weight, 8);
      expect(manualExcluded.alpha).toBeCloseTo(1 + weight, 8);
      expect(manualExcluded.beta).toBeCloseTo(1 + weight, 8);
      const replayDecisions = await tx.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'variant.experiment.auto-evaluate'));
      expect(replayDecisions.filter(row => row.detail?.experimentId === experimentId)).toHaveLength(1);
      await expect(tx.transaction(nested => nested.update(schema.variantExperiment).set({ evaluation: {} }).where(eq(schema.variantExperiment.id, experimentId)))).rejects.toThrow();
    });
  });
  it('decays published evidence, not poll age, and selects fresh posteriors rather than stale cache', async () => {
    await fixture(async (tx, modelId) => {
      const records = [
        { age: sql`now()`, score: 1 },
        { age: sql`now()-interval '30 days'`, score: 1 },
        { age: sql`now()-interval '60 days'`, score: 0 },
        { age: null, score: 1 },
        { age: sql`now()+interval '1 day'`, score: 1 },
      ].map(row => ({ ...row, bundleId: randomUUID(), targetId: randomUUID() }));
      for (const row of records) {
        await tx.insert(schema.contentBundle).values({ id: row.bundleId, orgId, modelId });
        await tx.insert(schema.postTarget).values({ id: row.targetId, orgId, bundleId: row.bundleId,
          platform: 'instagram', state: 'published', remoteId: row.targetId, publishedAt: row.age,
          idemKey: Buffer.from(row.targetId) });
        await tx.insert(schema.viralRecipe).values({ orgId, modelId, platform: 'instagram', sourceTargetId: row.targetId,
          perfScore: row.score, recipe: { evidence_source: 'published-provider-snapshot-v2',
            learning_context: 'learn-v1:scheduled-utc-unknown', learning_arm: 'short:statement' } });
      }
      await refreshLearningState(tx, orgId, modelId, 'instagram');
      const [state] = await tx.select().from(schema.banditState).where(eq(schema.banditState.modelId, modelId));
      expect(state).toMatchObject({ plays: 3, reward: 1.5, alpha: 2.5, beta: 1.25 });
      await tx.execute(sql`UPDATE viral_recipe SET created_at=now() WHERE model_id=${modelId}`);
      await refreshLearningState(tx, orgId, modelId, 'instagram');
      const [replayed] = await tx.select().from(schema.banditState).where(eq(schema.banditState.modelId, modelId));
      expect(replayed).toMatchObject({ plays: 3, reward: 1.5, alpha: 2.5, beta: 1.25 });
      await tx.execute(sql`UPDATE bandit_state SET alpha=9999,beta=9999 WHERE model_id=${modelId}`);
      let selectedRows: unknown[] = [];
      const reader = { execute: async (query: Parameters<typeof tx.execute>[0]) => {
        const result = await tx.execute(query); selectedRows = result.rows; return result;
      } };
      expect(await selectLearnedGuidance(reader, orgId, modelId, 'instagram', ['short:statement'], null)).toBe('short:statement');
      expect(selectedRows).toHaveLength(1);
      const selected = selectedRows[0] as { arm: string; alpha: unknown; beta: unknown };
      expect(selected.arm).toBe('short:statement');
      expect(Number(selected.alpha)).toBe(2.5);
      expect(Number(selected.beta)).toBe(1.25);
    });
  });
});
