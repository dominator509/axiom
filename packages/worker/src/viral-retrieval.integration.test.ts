import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db, pool, schema } from '@axiom/db';
import { retrieveTopExemplars } from './viral-retrieval.js';
import { embedExemplarIntent } from './embedding.js';

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
            ...(verified ? { evidence_source: 'published-provider-v1' } : {}),
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
});
