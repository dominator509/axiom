// Operator-only maintenance command. No env-file loading, queue loop, automatic
// retry, connector registration, or publication. Use only explicitly authorized IDs.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const [mode, orgId, modelId, bundleId, jobId, ...extra] = process.argv.slice(2);
assert.ok(['--inspect', '--execute-approved'].includes(mode), 'Explicit inspect or approved execution mode required');
assert.equal(extra.length, 0, 'Exactly four scope IDs required');
for (const id of [orgId, modelId, bundleId, jobId]) {
  assert.match(id ?? '', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
}
assert.ok(process.env.DATABASE_URL, 'Explicit database environment required');
if (mode === '--execute-approved') assert.equal(process.platform, 'linux', 'Media execution requires the installed Linux runtime');

const { db, pool } = await import('../packages/db/dist/index.js');
const { sql } = await import('drizzle-orm');
try {
  if (mode === '--inspect') {
    const state = await db.transaction(async tx => {
      await tx.execute(sql`SET TRANSACTION READ ONLY`);
      await tx.execute(sql`SELECT set_config('app.current_org_id', ${orgId}, true)`);
      const result = await tx.execute(sql`SELECT j.kind, j.state, j.attempts,
        (j.run_after <= now()) AS due, (j.locked_by IS NULL AND j.locked_at IS NULL) AS unlocked
        FROM job j JOIN content_bundle b ON b.id::text=j.payload->>'bundleId' AND b.org_id=j.org_id
        WHERE j.id=${jobId}::uuid AND j.org_id=${orgId}::uuid
          AND b.id=${bundleId}::uuid AND b.model_id=${modelId}::uuid
          AND j.kind IN ('media.generate', 'tos.scan') AND b.state IN ('generated', 'hold')`);
      return result.rows[0] ?? null;
    });
    console.log(JSON.stringify({ mode: 'inspect', matched: state !== null, state, databaseWrites: 0, providerRequests: 0 }));
    if (!state) process.exitCode = 2;
  } else {
    const { requireProductionDatabaseUrl, requireProductionMediaPlaneConfig } = await import('../packages/core/dist/index.js');
    requireProductionDatabaseUrl(process.env);
    requireProductionMediaPlaneConfig(process.env);
    const { claimExactMediaJob } = await import('../packages/worker/dist/claim.js');
    const { processJob } = await import('../packages/worker/dist/worker.js');
    const { mediaGenerate } = await import('../packages/worker/dist/executors/media_generate.js');
    const { tosScan } = await import('../packages/worker/dist/executors/tos.js');
    const workerId = `bounded-media-${randomUUID()}`;
    const { job } = await db.transaction(tx => claimExactMediaJob(tx, workerId, { orgId, modelId, bundleId, jobId }));
    if (!job) {
      console.log(JSON.stringify({ claimed: false, providerRequests: 0 }));
      process.exitCode = 2;
    } else {
      const outcome = await processJob(job, { 'media.generate': mediaGenerate, 'tos.scan': tosScan }, workerId, {});
      console.log(JSON.stringify({ claimed: true, outcome, queueLoop: false, publishingExecutor: false }));
      if (outcome !== 'done') process.exitCode = 1;
    }
  }
} catch {
  // Provider errors can contain private paths or credential-bearing endpoints.
  console.error('Exact media operation failed; inspect scoped job state before any further action. No automatic retry.');
  process.exitCode = 1;
} finally {
  await pool.end();
}
