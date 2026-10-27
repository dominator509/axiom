import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { availableParallelism, cpus, totalmem } from 'node:os';
import { performance } from 'node:perf_hooks';
import { eq, sql } from 'drizzle-orm';
import pg from 'pg';
import { db, pool, schema } from '@axiom/db';
import { buildS2 } from '@axiom/llm-gateway';
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
const coldPerformance = process.env.AXIOM_RETRIEVAL_COLD_PERFORMANCE === 'enabled';
const adminUrl = process.env.AXIOM_RETRIEVAL_ADMIN_DATABASE_URL;
const adminPool = coldPerformance && adminUrl ? new pg.Pool({
  connectionString: adminUrl,
  max: 1,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 120_000,
  application_name: 'axiom-cold-retrieval-observer',
}) : undefined;
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
function readOptionalLimit(path: string): string | null {
  try { return readFileSync(path, 'utf8').trim() || null; }
  catch { return null; }
}
function nearestRank(values: number[], percentile: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(percentile * sorted.length) - 1)];
}
function postgresBytes(value: string): number {
  if (/^\d+$/.test(value.trim())) return Number(value);
  const match = /^(\d+)\s*(bytes|kB|MB|GB)$/i.exec(value.trim());
  if (!match) throw new Error(`Unsupported PostgreSQL size setting: ${value}`);
  const unit = match[2].toLowerCase();
  const multiplier = unit === 'bytes' ? 1 : unit === 'kb' ? 1024 : unit === 'mb' ? 1024 ** 2 : 1024 ** 3;
  return Number(match[1]) * multiplier;
}
async function measureRetrievalPerformance(tx: Transaction) {
  const scaleLevels = [1, 5, 10, 20];
  const exemplarsPerModel = 50;
  const samplesPerScale = 50;
  const modelIds: string[] = [];
  const embedding = embedExemplarIntent('blue vase');
  const measurements: Array<Record<string, number | boolean>> = [];

  for (const modelCount of scaleLevels) {
    const addedModelIds = Array.from({ length: modelCount - modelIds.length }, () => randomUUID());
    await tx.insert(schema.modelProfile).values(addedModelIds.map(id => ({
      id, orgId, handle: `retrieval-perf-${id}`, displayName: 'Synthetic retrieval performance fixture',
    })));
    modelIds.push(...addedModelIds);
    const rows = addedModelIds.flatMap((modelId, modelIndex) => Array.from({ length: exemplarsPerModel }, (_, exemplarIndex) => ({
      orgId, modelId, platform: 'instagram', label: 'viral', perfScore: 2, embedding,
      features: {
        caption: `Synthetic retrieval model ${modelIds.length - addedModelIds.length + modelIndex + 1} sample ${exemplarIndex}`,
        evidence_source: 'published-provider-snapshot-v2', embedding_version: 'lexical-v1',
      },
    })));
    await tx.insert(schema.viralExemplar).values(rows);

    const latenciesMs: number[] = [];
    const targetModelId = modelIds[modelCount - 1];
    const queryStartedAt = performance.now();
    for (let sample = 0; sample < samplesPerScale; sample++) {
      const sampleStartedAt = performance.now();
      const result = await retrieveCaptionGuidance(tx, orgId, targetModelId, 'instagram', 10, 'blue vase');
      latenciesMs.push(performance.now() - sampleStartedAt);
      if (result.exemplars.length === 0) throw new Error(`Synthetic retrieval returned no rows at ${modelCount} models`);
    }
    const p95Ms = nearestRank(latenciesMs, 0.95);
    measurements.push({
      modelCount,
      datasetRows: modelCount * exemplarsPerModel,
      sampleCount: latenciesMs.length,
      firstSampleMs: Number(latenciesMs[0].toFixed(2)),
      p50Ms: Number(nearestRank(latenciesMs, 0.50).toFixed(2)),
      p95Ms: Number(p95Ms.toFixed(2)),
      maxMs: Number(Math.max(...latenciesMs).toFixed(2)),
      queryPhaseDurationMs: Number((performance.now() - queryStartedAt).toFixed(2)),
      within30MsTarget: p95Ms < 30,
    });
  }

  const databaseServerVersion = (await pool.query('SHOW server_version')).rows[0]?.server_version ?? null;
  const receipt = {
    kind: 'axiom-retrieval-performance-diagnostic',
    version: 1,
    testedSha: process.env.TESTED_SHA ?? null,
    scope: 'synthetic workload in disposable PostgreSQL; diagnostic only',
    measuredPath: 'retrieveCaptionGuidance end-to-end application path',
    targetP95Ms: 30,
    dataset: {
      models: scaleLevels,
      exemplarsPerModel,
      totalSyntheticExemplars: Math.max(...scaleLevels) * exemplarsPerModel,
      rollbackControlExemplars: 6,
    },
    workload: { samplesPerScale, concurrency: 1, intent: 'blue vase', externalProviderCalls: 0 },
    percentileMethod: 'nearest-rank',
    cacheState: 'uncontrolled; first sample is reported separately and is not a cold-query measurement',
    runner: {
      platform: process.platform,
      architecture: process.arch,
      nodeVersion: process.version,
      availableParallelism: availableParallelism(),
      logicalCpuCount: cpus().length,
      hostMemoryBytes: totalmem(),
      cgroupCpuMax: readOptionalLimit('/sys/fs/cgroup/cpu.max'),
      cgroupMemoryMaxBytes: readOptionalLimit('/sys/fs/cgroup/memory.max'),
    },
    databaseServerVersion,
    cleanup: 'all fixture rows are in the enclosing rollback-only transaction',
    measurements,
  };
  console.log(`AXIOM_RETRIEVAL_PERFORMANCE_RECEIPT ${JSON.stringify(receipt)}`);
}

async function measureColdRetrievalPerformance() {
  if (!adminPool) throw new Error('Cold retrieval requires the run-owned PostgreSQL administrator connection');
  const scaleLevels = [1, 5, 10, 20];
  const exemplarsPerModel = 50;
  const samplesPerScale = 50;
  const modelIds: string[] = [];
  const embedding = embedExemplarIntent('blue vase');
  const measurements: Array<Record<string, number | boolean>> = [];
  const evictionSetupMs: number[] = [];
  const fixtureCheckpointMs: number[] = [];
  const cacheBusterName = `m38_cache_buster_${randomUUID().replaceAll('-', '')}`;
  const cacheBusterRelation = `public.${cacheBusterName}`;
  const sharedBuffersSetting = String((await adminPool.query('SHOW shared_buffers')).rows[0]?.shared_buffers ?? '');
  const blockSizeSetting = String((await adminPool.query('SHOW block_size')).rows[0]?.block_size ?? '');
  const sharedBuffersBytes = postgresBytes(sharedBuffersSetting);
  const blockSizeBytes = postgresBytes(blockSizeSetting);
  const cacheBusterTargetBytes = Math.max(sharedBuffersBytes * 2, 32 * 1024 * 1024);
  const cacheBusterRows = Math.ceil(cacheBusterTargetBytes / 1024);
  let cacheBusterBytes = 0;
  let cacheBusterBlocksLoaded = 0;
  let cacheBusterTotalBlocks = 0;
  let cacheBusterWindowBlocks = 0;

  await adminPool.query(`CREATE UNLOGGED TABLE ${cacheBusterRelation} (payload text NOT NULL)`);
  try {
    await adminPool.query(
      `INSERT INTO ${cacheBusterRelation} (payload) SELECT repeat('x', 1024) FROM generate_series(1, $1::int)`,
      [cacheBusterRows],
    );
    cacheBusterBytes = Number((await adminPool.query('SELECT pg_relation_size($1::regclass) AS bytes', [cacheBusterRelation])).rows[0]?.bytes ?? 0);
    if (cacheBusterBytes <= sharedBuffersBytes * 2) {
      throw new Error(`Cache-buster relation (${cacheBusterBytes} bytes) is not larger than 2x shared_buffers (${sharedBuffersBytes} bytes)`);
    }
    cacheBusterTotalBlocks = Math.floor(cacheBusterBytes / blockSizeBytes);
    cacheBusterWindowBlocks = Math.min(cacheBusterTotalBlocks, Math.max(1, Math.ceil(Math.max(32 * 1024 * 1024, sharedBuffersBytes / 2) / blockSizeBytes)));
    const windowsPerPass = Math.ceil(cacheBusterTotalBlocks / cacheBusterWindowBlocks);
    const maxEvictionAttempts = windowsPerPass * 2;

    await db.transaction(async tx => {
      await tx.execute(sql`SELECT set_config('app.current_org_id', ${orgId}, true)`);
      await tx.insert(schema.orgSettings).values({ orgId, viralSharing: false }).onConflictDoUpdate({
        target: schema.orgSettings.orgId,
        set: { viralSharing: false },
      });
    });

    for (const modelCount of scaleLevels) {
      console.log(`AXIOM_RETRIEVAL_COLD_SCALE_START ${JSON.stringify({ modelCount, datasetRows: modelCount * exemplarsPerModel, samplesPerScale })}`);
      const modelOffset = modelIds.length;
      const addedModelIds = Array.from({ length: modelCount - modelOffset }, () => randomUUID());
      const rows = addedModelIds.flatMap((modelId, modelIndex) => Array.from({ length: exemplarsPerModel }, (_, exemplarIndex) => ({
        orgId, modelId, platform: 'instagram', label: 'viral', perfScore: 2, embedding,
        features: {
          caption: `Synthetic cold retrieval model ${modelOffset + modelIndex + 1} sample ${exemplarIndex}`,
          evidence_source: 'published-provider-snapshot-v2', embedding_version: 'lexical-v1',
        },
      })));
      await db.transaction(async tx => {
        await tx.execute(sql`SELECT set_config('app.current_org_id', ${orgId}, true)`);
        await tx.insert(schema.modelProfile).values(addedModelIds.map(id => ({
          id, orgId, handle: `cold-retrieval-${id}`, displayName: 'Synthetic cold retrieval fixture',
        })));
        await tx.insert(schema.viralExemplar).values(rows);
      });
      modelIds.push(...addedModelIds);

      // Fixture rows live only in the run-owned database. Commit and flush this scale
      // before measuring so dirty fixture pages do not defeat buffer eviction.
      const checkpointStartedAt = performance.now();
      await adminPool.query('CHECKPOINT');
      const checkpointMs = performance.now() - checkpointStartedAt;
      fixtureCheckpointMs.push(checkpointMs);
      console.log(`AXIOM_RETRIEVAL_COLD_FIXTURE_CHECKPOINT ${JSON.stringify({ modelCount, checkpointMs: Number(checkpointMs.toFixed(2)) })}`);

      const latenciesMs: number[] = [];
      const targetModelId = modelIds[modelCount - 1];
      await db.transaction(async tx => {
        await tx.execute(sql`SELECT set_config('app.current_org_id', ${orgId}, true)`);
        for (let sample = 0; sample < samplesPerScale; sample++) {
          const evictionStartedAt = performance.now();
          let residentApplicationPages = Number.POSITIVE_INFINITY;
          let evictionAttempts = 0;
          const residentPagesByAttempt: number[] = [];
          const cacheBusterBlocksLoadedByAttempt: number[] = [];
          const cacheBusterResidentPagesByAttempt: number[] = [];
          const warmedBlockRanges: Array<{ firstBlock: number; lastBlock: number }> = [];
          const warmedWindowStarts: number[] = [];
          while (residentApplicationPages !== 0 && evictionAttempts < maxEvictionAttempts) {
            if (warmedWindowStarts.length === windowsPerPass) warmedWindowStarts.length = 0;
            const candidateWindow = await adminPool.query(`
              WITH candidate_windows AS (
                SELECT first_block,
                  LEAST($2::bigint - 1, first_block + $3::bigint - 1) AS last_block
                FROM generate_series(0::bigint, $2::bigint - 1, $3::bigint) AS starts(first_block)
              ), cache_buster_buffers AS MATERIALIZED (
                SELECT b.relblocknumber AS blocknum
                FROM pg_buffercache b
                WHERE b.reldatabase = (SELECT oid FROM pg_database WHERE datname = current_database())
                  AND b.relfilenode IS NOT NULL
                  AND b.relforknumber = 0
                  AND pg_filenode_relation(b.reltablespace, b.relfilenode) = $1::regclass
              )
              SELECT w.first_block, w.last_block
              FROM candidate_windows w
              LEFT JOIN cache_buster_buffers b ON b.blocknum BETWEEN w.first_block AND w.last_block
              WHERE w.first_block <> ALL($4::bigint[])
              GROUP BY w.first_block, w.last_block
              ORDER BY (w.last_block - w.first_block + 1) - count(b.blocknum) DESC, w.first_block
              LIMIT 1
            `, [cacheBusterRelation, cacheBusterTotalBlocks, cacheBusterWindowBlocks, warmedWindowStarts]);
            const firstBlock = Number(candidateWindow.rows[0]?.first_block ?? -1);
            const lastBlock = Number(candidateWindow.rows[0]?.last_block ?? -1);
            if (!Number.isSafeInteger(firstBlock) || !Number.isSafeInteger(lastBlock) || firstBlock < 0 || lastBlock < firstBlock) {
              throw new Error('Could not choose a valid cache-buster window from the run-owned relation');
            }
            warmedBlockRanges.push({ firstBlock, lastBlock });
            warmedWindowStarts.push(firstBlock);
            const warmed = await adminPool.query(
              'SELECT pg_prewarm($1::regclass, $2::text, $3::text, $4::bigint, $5::bigint) AS blocks_loaded',
              [cacheBusterRelation, 'buffer', 'main', firstBlock, lastBlock],
            );
            cacheBusterBlocksLoaded = Number(warmed.rows[0]?.blocks_loaded ?? 0);
            cacheBusterBlocksLoadedByAttempt.push(cacheBusterBlocksLoaded);
            if (cacheBusterBlocksLoaded <= 0) throw new Error('PostgreSQL did not load the run-owned cache-buster relation into shared buffers');
            const resident = await adminPool.query(`
              WITH application_relations AS (
                SELECT c.oid
                FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND c.relname <> $1
                UNION
                SELECT c.reltoastrelid
                FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND c.relname <> $1 AND c.reltoastrelid <> 0
                UNION
                SELECT i.indexrelid
                FROM pg_index i
                JOIN pg_class c ON c.oid = i.indrelid
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND c.relname <> $1
                UNION
                SELECT i.indexrelid
                FROM pg_class parent
                JOIN pg_namespace n ON n.oid = parent.relnamespace
                JOIN pg_index i ON i.indrelid = parent.reltoastrelid
                WHERE n.nspname = 'public' AND parent.relname <> $1 AND parent.reltoastrelid <> 0
              ), buffer_relations AS MATERIALIZED (
                SELECT pg_filenode_relation(b.reltablespace, b.relfilenode) AS relation_oid
                FROM pg_buffercache b
                WHERE b.reldatabase = (SELECT oid FROM pg_database WHERE datname = current_database())
                  AND b.relfilenode IS NOT NULL
              )
              SELECT count(*) FILTER (WHERE relation_oid IN (SELECT oid FROM application_relations))::int AS resident,
                count(*) FILTER (WHERE relation_oid = $2::regclass)::int AS cache_buster_resident
              FROM buffer_relations
            `, [cacheBusterName, cacheBusterRelation]);
            residentApplicationPages = Number(resident.rows[0]?.resident ?? -1);
            residentPagesByAttempt.push(residentApplicationPages);
            cacheBusterResidentPagesByAttempt.push(Number(resident.rows[0]?.cache_buster_resident ?? -1));
            evictionAttempts++;
          }
          evictionSetupMs.push(performance.now() - evictionStartedAt);
          if (residentApplicationPages !== 0) {
            const remainingPages = await adminPool.query(`
              WITH application_relations AS (
                SELECT c.oid
                FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND c.relname <> $1
                UNION
                SELECT c.reltoastrelid
                FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND c.relname <> $1 AND c.reltoastrelid <> 0
                UNION
                SELECT i.indexrelid
                FROM pg_index i
                JOIN pg_class c ON c.oid = i.indrelid
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND c.relname <> $1
                UNION
                SELECT i.indexrelid
                FROM pg_class parent
                JOIN pg_namespace n ON n.oid = parent.relnamespace
                JOIN pg_index i ON i.indrelid = parent.reltoastrelid
                WHERE n.nspname = 'public' AND parent.relname <> $1 AND parent.reltoastrelid <> 0
              ), remaining_application_buffers AS (
                SELECT c.relname, b.relforknumber, b.usagecount, b.pinning_backends, b.isdirty
                FROM pg_buffercache b
                JOIN pg_class c ON c.oid = pg_filenode_relation(b.reltablespace, b.relfilenode)
                JOIN application_relations a ON a.oid = c.oid
                WHERE b.reldatabase = (SELECT oid FROM pg_database WHERE datname = current_database())
              )
              SELECT relname, relforknumber, count(*)::int AS resident,
                count(*) FILTER (WHERE pinning_backends > 0)::int AS pinned,
                count(*) FILTER (WHERE isdirty)::int AS dirty,
                max(pinning_backends)::int AS max_pinning_backends,
                array_agg(DISTINCT usagecount ORDER BY usagecount) AS usage_counts
              FROM remaining_application_buffers
              GROUP BY relname, relforknumber
              ORDER BY count(*) DESC, relname, relforknumber
              LIMIT 20
            `, [cacheBusterName]);
            const evictionDiagnostic = {
              sample: sample + 1,
              modelCount,
              sharedBuffers: sharedBuffersSetting,
              cacheBusterBytes,
              cacheBusterWindowBytes: cacheBusterWindowBlocks * blockSizeBytes,
              evictionAttempts,
              warmedBlockRanges,
              cacheBusterBlocksLoadedByAttempt,
              cacheBusterResidentPagesByAttempt,
              residentPagesByAttempt,
              residentApplicationPages,
              remainingRelations: remainingPages.rows,
            };
            console.log(`AXIOM_RETRIEVAL_COLD_EVICTION_DIAGNOSTIC ${JSON.stringify(evictionDiagnostic)}`);
            throw new Error(`Could not establish cold PostgreSQL shared buffers before sample ${sample + 1} at ${modelCount} models; ${residentApplicationPages} application pages remain`);
          }

          const sampleStartedAt = performance.now();
          const result = await retrieveCaptionGuidance(tx, orgId, targetModelId, 'instagram', 10, 'blue vase');
          latenciesMs.push(performance.now() - sampleStartedAt);
          if (result.exemplars.length === 0) throw new Error(`Cold synthetic retrieval returned no rows at ${modelCount} models`);
          if ((sample + 1) % 10 === 0) {
            console.log(`AXIOM_RETRIEVAL_COLD_PROGRESS ${JSON.stringify({ modelCount, completedSamples: sample + 1, samplesPerScale })}`);
          }
        }
      });

      const p95Ms = nearestRank(latenciesMs, 0.95);
      const measurement = {
        modelCount,
        datasetRows: modelCount * exemplarsPerModel,
        sampleCount: latenciesMs.length,
        p50Ms: Number(nearestRank(latenciesMs, 0.50).toFixed(2)),
        p95Ms: Number(p95Ms.toFixed(2)),
        maxMs: Number(Math.max(...latenciesMs).toFixed(2)),
        within20MsTarget: p95Ms < 20,
      };
      measurements.push(measurement);
      console.log(`AXIOM_RETRIEVAL_COLD_SCALE_RECEIPT ${JSON.stringify(measurement)}`);
    }

    const databaseServerVersion = (await adminPool.query('SHOW server_version')).rows[0]?.server_version ?? null;
    const receipt = {
      kind: 'axiom-retrieval-cold-performance-diagnostic',
      version: 1,
      criterion: 'MATRIX-NFR-1',
      command: 'node scripts/test-isolated-workspace.mjs --isolated-fixture --viral-retrieval-cold',
      baselineSha: process.env.BASELINE_SHA ?? null,
      testedSha: process.env.TESTED_SHA ?? null,
      targetP95Ms: 20,
      scope: 'synthetic workload in a run-owned disposable PostgreSQL 16 container; item-6 submetric only',
      measuredPath: 'retrieveCaptionGuidance end-to-end application path',
      dataset: {
        models: scaleLevels,
        exemplarsPerModel,
        totalSyntheticExemplars: Math.max(...scaleLevels) * exemplarsPerModel,
        cacheBusterRows,
        cacheBusterBytes,
        cacheBusterWindowBytes: cacheBusterWindowBlocks * blockSizeBytes,
        cacheBusterBlocksLoadedPerAttempt: cacheBusterBlocksLoaded,
      },
      workload: { samplesPerScale, concurrency: 1, intent: 'blue vase', externalProviderCalls: 0 },
      percentileMethod: 'nearest-rank',
      cacheState: {
        postgresqlSharedBuffers: 'all public application table, index and toast pages verified absent before each sample using pg_buffercache; pg_prewarm rotated a bounded window through the larger run-owned cache-buster relation',
        operatingSystemPageCache: 'not cleared; this receipt proves shared-buffer cold only',
      },
      evictionSetup: {
        sharedBuffers: sharedBuffersSetting,
        sharedBuffersBytes,
        blockSizeBytes,
        attemptsPerSampleMaximum: maxEvictionAttempts,
        distinctWindowsPerPass: windowsPerPass,
        fixtureCheckpointCount: fixtureCheckpointMs.length,
        fixtureCheckpointTotalMs: Number(fixtureCheckpointMs.reduce((total, value) => total + value, 0).toFixed(2)),
        fixtureCheckpointMaxMs: Number(Math.max(...fixtureCheckpointMs).toFixed(2)),
        p95Ms: Number(nearestRank(evictionSetupMs, 0.95).toFixed(2)),
      },
      runner: {
        platform: process.platform,
        architecture: process.arch,
        nodeVersion: process.version,
        availableParallelism: availableParallelism(),
        logicalCpuCount: cpus().length,
        hostMemoryBytes: totalmem(),
        cgroupCpuMax: readOptionalLimit('/sys/fs/cgroup/cpu.max'),
        cgroupMemoryMaxBytes: readOptionalLimit('/sys/fs/cgroup/memory.max'),
        containerImage: process.env.AXIOM_RETRIEVAL_CONTAINER_IMAGE ?? null,
      },
      databaseServerVersion,
      cleanup: 'synthetic fixture rows were committed only in the run-owned database and discarded with its container; cache-buster table dropped; parent harness verifies removal of the run-owned container and internal network',
      measurements,
    };
    console.log(`AXIOM_RETRIEVAL_COLD_PERFORMANCE_RECEIPT ${JSON.stringify(receipt)}`);
    expect(measurements.every(measurement => measurement.within20MsTarget)).toBe(true);
  } finally {
    await adminPool.query(`DROP TABLE IF EXISTS ${cacheBusterRelation}`);
  }
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
    if (coldPerformance) {
      expect(adminUrl).toBeTruthy();
      const adminTarget = new URL(adminUrl!);
      expect(['localhost', '127.0.0.1']).toContain(adminTarget.hostname);
      expect(adminTarget.username).toBe('axiom');
      expect(adminTarget.pathname).toBe(target.pathname);
      expect(adminTarget.port).toBe(target.port);
      const adminRole = await adminPool!.query('SELECT rolsuper FROM pg_roles WHERE rolname=current_user');
      expect(adminRole.rows[0]?.rolsuper).toBe(true);
      await adminPool!.query('CREATE EXTENSION IF NOT EXISTS pg_buffercache');
      await adminPool!.query('CREATE EXTENSION IF NOT EXISTS pg_prewarm');
    }
  });
  afterAll(async () => {
    try { if (adminPool) await adminPool.end(); }
    finally { await pool.end(); }
  });
  if (coldPerformance) {
    it('measures controlled shared-buffer-cold retrieval across the 1-20-model envelope', async () => {
      await measureColdRetrievalPerformance();
    }, 10 * 60_000);
  }
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
      if (process.env.AXIOM_RETRIEVAL_PERFORMANCE === 'enabled') await measureRetrievalPerformance(tx);
    });
  }, process.env.AXIOM_RETRIEVAL_PERFORMANCE === 'enabled' ? 30_000 : undefined);
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
  it('moves worker-written exemplars and learned guidance when provider performance changes', async () => {
    await fixture(async (tx, modelId) => {
      const records = [
        { caption: 'A steady creator update.' },
        { caption: 'A second steady update.' },
        { caption: 'A third steady update.' },
        { caption: 'Could this help your next post?' },
        { caption: 'Would you try this approach?' },
      ].map(row => ({ ...row, bundleId: randomUUID(), targetId: randomUUID() }));

      await tx.insert(schema.contentBundle).values(records.map(row => ({
        id: row.bundleId, orgId, modelId, captions: { threads: row.caption },
      })));
      await tx.insert(schema.postTarget).values(records.map(row => ({
        id: row.targetId, orgId, bundleId: row.bundleId, platform: 'threads', state: 'published',
        remoteId: row.targetId, idemKey: Buffer.from(row.targetId), publishedAt: sql`now()`,
        publicationSnapshot: { caption: row.caption, hashtags: [], modelId, assetId: null, scheduledFor: null },
      })));

      let latestMetricAt = 0;
      const evaluateProviderSnapshot = async (highPerformer: number) => {
        const firstSampleAt = Math.max(Date.now() - 5_000, latestMetricAt + 1_000);
        latestMetricAt = firstSampleAt + records.length;
        await tx.insert(schema.postMetric).values(records.map((row, index) => ({
          postTargetId: row.targetId, platform: 'threads' as const, remoteId: row.targetId,
          source: 'provider' as const, views: 1_000, likes: 100, shares: 10, comments: 5,
          engagementRate: index === highPerformer ? 0.6 : 0.1,
          collectedAt: new Date(firstSampleAt + index),
        })));
        for (const row of records) {
          const job: JobRow = {
            id: randomUUID(), org_id: orgId, queue: 'viral', kind: 'viral.label', payload: { targetId: row.targetId },
            state: 'running', attempts: 1, max_attempts: 3, last_error: null, run_after: new Date(),
            locked_by: 'retrieval-test', locked_at: new Date(), dedupe_key: null, scheduled_for: null,
            started_at: new Date(), completed_at: null, created_at: new Date(),
          };
          await viralLabel({ tx, job, workerId: 'retrieval-test', killSwitchEnabled: false });
        }
      };
      const posterior = async () => new Map((await tx.select({
        arm: schema.banditState.arm, alpha: schema.banditState.alpha, beta: schema.banditState.beta,
      }).from(schema.banditState).where(eq(schema.banditState.modelId, modelId))).map(row => [row.arm, row]));

      await evaluateProviderSnapshot(0);
      const statementWinner = await retrieveCaptionGuidance(tx, orgId, modelId, 'threads', 10, 'creator update');
      expect(statementWinner.exemplars).toHaveLength(1);
      expect(statementWinner.exemplars[0].caption).toBe(records[0].caption);
      const firstS2 = buildS2(statementWinner.exemplars);
      expect(firstS2).toContain(`Caption: ${records[0].caption}`);
      expect(firstS2).not.toContain(records[3].caption);
      expect(statementWinner.selectedArm).toBe('short:statement');
      const firstPosterior = await posterior();
      const firstStatement = firstPosterior.get('short:statement');
      const firstQuestion = firstPosterior.get('short:question');
      expect(firstStatement).toBeDefined();
      expect(firstQuestion).toBeDefined();
      expect(firstStatement!.alpha / (firstStatement!.alpha + firstStatement!.beta))
        .toBeGreaterThan(firstQuestion!.alpha / (firstQuestion!.alpha + firstQuestion!.beta));

      await evaluateProviderSnapshot(3);
      const questionWinner = await retrieveCaptionGuidance(tx, orgId, modelId, 'threads', 10, 'creator update');
      expect(questionWinner.exemplars).toHaveLength(1);
      expect(questionWinner.exemplars[0].caption).toBe(records[3].caption);
      const laterS2 = buildS2(questionWinner.exemplars);
      expect(laterS2).toContain(`Caption: ${records[3].caption}`);
      expect(laterS2).not.toContain(records[0].caption);
      expect(questionWinner.selectedArm).toBe('short:question');
      const secondPosterior = await posterior();
      const secondStatement = secondPosterior.get('short:statement');
      const secondQuestion = secondPosterior.get('short:question');
      expect(secondStatement).toBeDefined();
      expect(secondQuestion).toBeDefined();
      expect(secondQuestion!.alpha / (secondQuestion!.alpha + secondQuestion!.beta))
        .toBeGreaterThan(secondStatement!.alpha / (secondStatement!.alpha + secondStatement!.beta));
    });
  });
  it('rewards the contextual learner from post-link clicks and net attributed conversions', async () => {
    await fixture(async (tx, modelId) => {
      const bundleId = randomUUID(), targetId = randomUUID(), providerId = randomUUID(), shortLinkId = randomUUID();
      await tx.insert(schema.contentBundle).values({ id: bundleId, orgId, modelId });
      await tx.insert(schema.postTarget).values({ id: targetId, orgId, bundleId, platform: 'instagram', state: 'published',
        remoteId: targetId, publishedAt: sql`now()`, idemKey: Buffer.from(targetId) });
      await tx.insert(schema.postMetric).values({ postTargetId: targetId, platform: 'instagram', remoteId: targetId,
        source: 'provider', views: 100, likes: 5, engagementRate: .05, collectedAt: sql`now()` });
      await tx.insert(schema.linkbioProvider).values({ id: providerId, orgId, modelId, kind: 'native', isPrimary: true });
      await tx.insert(schema.shortLink).values({ id: shortLinkId, orgId, modelId, slug: targetId.replaceAll('-', ''),
        targetUrl: 'https://fanvue.com/model', utm: { utm_medium: 'post', utm_content: targetId } });
      await tx.insert(schema.linkbioClick).values(Array.from({ length: 20 }, () => ({ orgId, providerId, shortLinkId,
        target: 'https://fanvue.com/model', source: 'instagram' })));
      await tx.insert(schema.linkbioAttributionEvent).values([
        { orgId, modelId, shortLinkId, eventKey: randomUUID(), kind: 'subscription', amountCents: 300, currency: 'USD', occurredAt: sql`now()` },
        { orgId, modelId, shortLinkId, eventKey: randomUUID(), kind: 'ppv_purchase', amountCents: 500, currency: 'USD', occurredAt: sql`now()` },
        { orgId, modelId, shortLinkId, eventKey: randomUUID(), kind: 'subscription_refund', amountCents: 300, currency: 'USD', occurredAt: sql`now()` },
      ]);
      await tx.insert(schema.viralRecipe).values({ orgId, modelId, platform: 'instagram', sourceTargetId: targetId,
        perfScore: .95, recipe: { evidence_source: 'published-provider-snapshot-v2',
          learning_context: 'learn-v1:scheduled-utc-unknown', learning_arm: 'short:question' } });

      await refreshLearningState(tx, orgId, modelId, 'instagram');
      const [state] = await tx.select().from(schema.banditState).where(eq(schema.banditState.modelId, modelId));
      const clock = await tx.execute(sql`SELECT POWER(0.5, EXTRACT(EPOCH FROM (now()-published_at))/2592000.0) AS weight
        FROM post_target WHERE id=${targetId}`);
      const weight = Number(clock.rows[0].weight);
      const expectedReward = .0575 * weight; // (20 clicks × 0.25 + (2 conversions − 1 refund) × 0.75) / 100 views.
      expect(state).toMatchObject({ plays: 1, arm: 'short:question' });
      expect(state.reward).toBeCloseTo(expectedReward, 8);
      expect(state.alpha).toBeCloseTo(1 + expectedReward, 8);
      expect(state.beta).toBeCloseTo(1 + (1 - .0575) * weight, 8);
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
