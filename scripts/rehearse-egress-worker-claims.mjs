// Disposable PostgreSQL acceptance for the model-scoped egress claim boundary.
// It never reads .env, provider credentials, or tenant rows outside the
// synthetic fixture it creates, and it removes that fixture in finally.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

assert.equal(process.argv[2], '--isolated-fixture', 'Pass --isolated-fixture explicitly');
const container = 'axiom-ci-local-6cefdc1';
const database = `axiom_egress_claim_${randomBytes(8).toString('hex')}`;

function docker(args, input) {
  const result = spawnSync('docker', args, {
    input, encoding: 'utf8', windowsHide: true, timeout: 60_000, maxBuffer: 1024 * 1024,
  });
  assert.equal(result.status, 0, 'Isolated egress-claim fixture command failed; diagnostics suppressed');
  return result.stdout.trim();
}

const metadata = JSON.parse(docker(['inspect', '--format',
  '{"running":{{json .State.Running}},"labels":{{json .Config.Labels}},"ports":{{json .NetworkSettings.Ports}}}', container]));
assert.equal(metadata.running, true);
assert.equal(metadata.labels['axiom.purpose'], 'isolated-ci-validation');
assert.deepEqual(metadata.ports['5432/tcp'], [{ HostIp: '127.0.0.1', HostPort: '55432' }]);

let created = false;
try {
  docker(['exec', container, 'createdb', '-U', 'axiom', database]);
  created = true;
  const migrations = readdirSync(new URL('../packages/db/migrations/', import.meta.url))
    .filter(name => /^\d{4}_.+\.sql$/.test(name)).sort();
  const sql = input => docker(['exec', '-i', container, 'psql', '-X', '-w', '-q', '-t', '-A', '-1',
    '-U', 'axiom', '-d', database, '-v', 'ON_ERROR_STOP=1'], input);
  for (const file of migrations) {
    const source = readFileSync(new URL(`../packages/db/migrations/${file}`, import.meta.url), 'utf8')
      .replace(/\r\n/g, '\n').replace(/^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;\s*$/gm, '')
      .replace(/TO axiom;/g, 'TO axiom_app;').replace(/TO axiom'/g, "TO axiom_app'");
    sql(source);
  }
  sql(`
    ALTER ROLE axiom_app WITH LOGIN PASSWORD 'axiom_app';
    INSERT INTO org (id, name, slug) VALUES
      ('10000000-0000-4000-8000-000000000001', 'Egress Fixture A', 'egress-fixture-a'),
      ('20000000-0000-4000-8000-000000000002', 'Egress Fixture B', 'egress-fixture-b');
    INSERT INTO model_profile (id, org_id, display_name, handle) VALUES
      ('11000000-0000-4000-8000-000000000011', '10000000-0000-4000-8000-000000000001', 'Model A', 'model-a'),
      ('22000000-0000-4000-8000-000000000022', '20000000-0000-4000-8000-000000000002', 'Model B', 'model-b');
    INSERT INTO content_bundle (id, org_id, model_id) VALUES
      ('11100000-0000-4000-8000-000000000011', '10000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000011'),
      ('22200000-0000-4000-8000-000000000022', '20000000-0000-4000-8000-000000000002', '22000000-0000-4000-8000-000000000022');
    INSERT INTO post_target (id, org_id, bundle_id, platform, idem_key) VALUES
      ('11110000-0000-4000-8000-000000000011', '10000000-0000-4000-8000-000000000001', '11100000-0000-4000-8000-000000000011', 'x', decode(repeat('11', 32), 'hex')),
      ('22220000-0000-4000-8000-000000000022', '20000000-0000-4000-8000-000000000002', '22200000-0000-4000-8000-000000000022', 'x', decode(repeat('22', 32), 'hex'));
    INSERT INTO scrape_run (id, org_id, model_id, kind, request) VALUES
      ('11130000-0000-4000-8000-000000000011', '10000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000011', 'social', '{}'::jsonb);
    INSERT INTO job (id, org_id, queue, kind, payload) VALUES
      ('11140000-0000-4000-8000-000000000011', '10000000-0000-4000-8000-000000000001', 'publish', 'publish.target', '{"targetId":"11110000-0000-4000-8000-000000000011"}'::jsonb),
      ('11150000-0000-4000-8000-000000000011', '10000000-0000-4000-8000-000000000001', 'metrics', 'metrics.poll', '{"targetId":"11110000-0000-4000-8000-000000000011"}'::jsonb),
      ('11160000-0000-4000-8000-000000000011', '10000000-0000-4000-8000-000000000001', 'scrape', 'scrape.run', '{"runId":"11130000-0000-4000-8000-000000000011"}'::jsonb),
      ('11170000-0000-4000-8000-000000000011', '10000000-0000-4000-8000-000000000001', 'metrics', 'fanvue.analytics.sync', '{"modelId":"11000000-0000-4000-8000-000000000011"}'::jsonb),
      ('11180000-0000-4000-8000-000000000011', '10000000-0000-4000-8000-000000000001', 'publish', 'publish.target', '{"targetId":"22020000-0000-4000-8000-000000000022"}'::jsonb),
      ('22240000-0000-4000-8000-000000000022', '20000000-0000-4000-8000-000000000002', 'publish', 'publish.target', '{"targetId":"22220000-0000-4000-8000-000000000022"}'::jsonb),
      ('11190000-0000-4000-8000-000000000011', '10000000-0000-4000-8000-000000000001', 'internal', 'content.generate', '{}'::jsonb);
  `);
  const app = input => sql(`SET ROLE axiom_app; ${input}`);
  for (const expected of ['publish.target', 'metrics.poll', 'scrape.run', 'fanvue.analytics.sync']) {
    assert.equal(app("SELECT kind FROM claim_model_egress_job('runner-a', '11000000-0000-4000-8000-000000000011')"), expected);
  }
  assert.equal(app("SELECT count(*) FROM claim_model_egress_job('runner-a', '11000000-0000-4000-8000-000000000011')"), '0');
  assert.equal(app("SELECT kind FROM claim_model_egress_job('runner-b', '22000000-0000-4000-8000-000000000022')"), 'publish.target');
  assert.equal(app("SELECT kind FROM claim_non_egress_job('global')"), 'content.generate');
  assert.equal(sql("SELECT count(*) FROM job WHERE id='11180000-0000-4000-8000-000000000011' AND state='ready'"), '1');
  console.log(JSON.stringify({ status: 'ok', migrations: migrations.length, twoTenantScopedClaims: true,
    malformedPayloadFailClosed: true, globalWorkerExcludedEgress: true, providerCalls: 0 }));
} finally {
  if (created) docker(['exec', container, 'dropdb', '-U', 'axiom', '--if-exists', database]);
  console.log(JSON.stringify({ removed_disposable_fixture: created, recovered_database_untouched: true }));
}
