// Real migrated PostgreSQL; no existing URL, environment file, host mount or port.
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

assert.deepEqual(process.argv.slice(2), ['--isolated-fixture']);
const root = new URL('../', import.meta.url);
assert.equal(process.versions.node, readFileSync(new URL('.nvmrc', root), 'utf8').trim(), 'Use pinned Node');
const id = randomUUID();
const name = `axiom-rls-${id}`;
const label = 'axiom.rls-rehearsal';
const image = 'timescale/timescaledb:2.29.2-pg16@sha256:289d55704b1b3ee8263cd3805c6930f9cd54506835a8f19f9b85dad17d5c5a8a';
const output = new URL(`var/rls-rehearsal/${id}/`, root);
mkdirSync(output, { recursive: true });
const receipt = { sourceSha: '', command: 'node scripts/rehearse-rls-catalog.mjs --isolated-fixture',
  node: process.versions.node, image, environment: 'owned network-disabled disposable PostgreSQL',
  assertions: [], passed: 0, failed: 0, skipped: 0, cleanup: false };
let created = false;
let operation = 0;
function run(command, args, { input, env = {}, timeout = 120000 } = {}) {
  const result = spawnSync(command, args, { cwd: root, input, timeout, maxBuffer: 32*1024*1024,
    windowsHide: true, env: { ...process.env, ...env } });
  // Only owned synthetic database data and migration output enter these logs.
  const log = Buffer.concat([result.stdout ?? Buffer.alloc(0), result.stderr ?? Buffer.alloc(0)]);
  writeFileSync(new URL(`${++operation}.log`, output), log);
  if (result.status !== 0) throw new Error(`${command} operation ${operation} failed; inspect private rehearsal logs`);
  return (result.stdout ?? Buffer.alloc(0)).toString().trim();
}
const docker = (args, options) => run('docker', args, options);
const sql = (statement, role = 'axiom') => docker(['exec', '-i', name, 'psql', '-X', '-qAt',
  '-U', role, '-d', 'axiom_test', '-v', 'ON_ERROR_STOP=1'], { input: statement });
function check(name, action) {
  try { action(); receipt.assertions.push({ name, passed: true }); receipt.passed++; }
  catch { receipt.assertions.push({ name, passed: false }); receipt.failed++; }
}
try {
  receipt.sourceSha = run('git', ['rev-parse', 'HEAD']);
  assert.match(receipt.sourceSha, /^[a-f0-9]{40}$/);
  assert.equal(run('git', ['status', '--porcelain']), '', 'Commit the tested source first');
  const endpoint = process.env.DOCKER_HOST || JSON.parse(docker(['context', 'inspect']))[0].Endpoints.docker.Host;
  assert.ok(endpoint.startsWith('npipe://') || endpoint.startsWith('unix://'), 'Only local Docker is permitted');
  // Rebuild the exact committed schema before deriving the inventory.
  // The global Windows pnpm.cmd may hard-code a different adjacent node.exe.
  // Launch Corepack through this pinned Node binary instead of that shim.
  if (process.platform === 'win32') run(process.execPath, [join(dirname(process.execPath), 'node_modules/corepack/dist/pnpm.js'), '--filter', '@axiom/db...', 'build']);
  else run('pnpm', ['--filter', '@axiom/db...', 'build']);
  const { tenantTableNames, nonTenantTables, rlsCatalogSql, assertRlsCatalog } =
    await import('../packages/db/dist/rls-catalog.js');
  assert.equal(nonTenantTables.size, 14, 'Review changes to the documented exceptions');
  assert.ok(tenantTableNames.length > 0 && tenantTableNames.every(t => /^[a-z_][a-z0-9_]*$/.test(t)));
  receipt.tenantTables = tenantTableNames;
  const query = rlsCatalogSql.replace('$1', `'${JSON.stringify(tenantTableNames)}'`);
  const rows = (setup = '', role = 'axiom_app') => JSON.parse(sql(
    `BEGIN; ${setup}\n${setup ? 'SET LOCAL ROLE axiom_app;' : ''}\nSELECT coalesce(json_agg(r), '[]'::json) FROM (${query}) r;\nROLLBACK;`, role));
  const password = randomBytes(32).toString('hex');
  docker(['create', '--name', name, '--network', 'none', '--label', `${label}=${id}`,
    '--env', 'POSTGRES_USER=axiom', '--env', 'POSTGRES_DB=axiom_test', '--env', 'POSTGRES_PASSWORD', image],
  { env: { POSTGRES_PASSWORD: password } });
  created = true;
  const inspect = JSON.parse(docker(['inspect', name]))[0];
  assert.equal(inspect.HostConfig.Privileged, false);
  assert.equal(inspect.HostConfig.NetworkMode, 'none');
  assert.equal(Object.keys(inspect.HostConfig.PortBindings ?? {}).length, 0);
  assert.equal(inspect.Mounts.some(m => m.Type === 'bind'), false);
  docker(['start', name]);
  let ready = false;
  for (let i = 0; i < 60; i++) {
    const result = spawnSync('docker', ['exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'axiom', '-d', 'axiom_test'], { windowsHide: true, timeout: 10000 });
    if (result.status === 0) { ready = true; break; }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.ok(ready, 'Disposable PostgreSQL did not become ready');
  const archive = spawnSync('git', ['archive', '--format=tar', receipt.sourceSha, 'scripts/migrate.sh', 'packages/db/migrations'], { cwd: root, windowsHide: true, maxBuffer: 32*1024*1024 });
  assert.equal(archive.status, 0);
  receipt.migrationArchiveSha256 = createHash('sha256').update(archive.stdout).digest('hex');
  docker(['exec', name, 'mkdir', '-p', '/fixture']);
  docker(['exec', '-i', name, 'tar', '-xf', '-', '-C', '/fixture'], { input: archive.stdout });
  for (let attempt = 0; attempt < 2; attempt++) docker(['exec', '--env', 'MIGRATOR_DATABASE_URL=postgresql://axiom@/axiom_test',
    name, 'sh', '/fixture/scripts/migrate.sh']);
  check('all schema tenant tables protected for actual application connection', () => assertRlsCatalog(rows()));
  for (const [fault, setup] of [
    ['disabled RLS', 'ALTER TABLE model_profile DISABLE ROW LEVEL SECURITY;'],
    ['unforced RLS', 'ALTER TABLE model_profile NO FORCE ROW LEVEL SECURITY;'],
    ['missing policy', 'DROP POLICY org_isolation ON model_profile;'],
    ['missing table', 'ALTER TABLE model_profile RENAME TO rehearsal_hidden_model;'],
    ['policy for wrong role', 'ALTER POLICY org_isolation ON model_profile TO axiom_migrator;'],
    ['additional permissive policy', 'CREATE POLICY rehearsal_allow ON model_profile FOR INSERT WITH CHECK (true);'],
    ['superuser runtime', 'ALTER ROLE axiom_app SUPERUSER;'],
    ['BYPASSRLS runtime', 'ALTER ROLE axiom_app BYPASSRLS;'],
    ['membership in elevated role', 'CREATE ROLE rehearsal_bypass BYPASSRLS; GRANT rehearsal_bypass TO axiom_app;'],
  ]) {
    check(`reject ${fault}`, () => {
      assertRlsCatalog(rows());
      assert.throws(() => assertRlsCatalog(rows(setup, 'axiom')), /unsafe/);
      assertRlsCatalog(rows());
    });
  }
  // Original migrated policies must still be intact after every rollback.
  check('catalog restored after fault probes', () => assertRlsCatalog(rows()));

  const a = '11111111-1111-4111-8111-111111111111';
  const b = '22222222-2222-4222-8222-222222222222';
  const seed = `INSERT INTO org(id,name,slug) VALUES ('${a}','RLS A','rls-a'),('${b}','RLS B','rls-b');
    INSERT INTO auth_user(id,name,email,org_id) VALUES ('rls-user-a','RLS A','rls-a@example.invalid','${a}'),('rls-user-b','RLS B','rls-b@example.invalid','${b}');
    INSERT INTO ui_locale_preference(scope,org_id,locale) VALUES ('org','${b}','en');
    SET LOCAL ROLE axiom_app;
    SELECT set_config('app.current_org_id','${a}',true), set_config('app.current_user_id','rls-user-a',true);`;
  const denied = statement => `DO $probe$ BEGIN
    ${statement}; RAISE EXCEPTION 'Expected tenant/user denial';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END $probe$;`;
  const cases = [
    ['own organization insert', `INSERT INTO ui_locale_preference(scope,org_id,locale) VALUES ('org','${a}','en');`],
    ['own user insert', `INSERT INTO ui_locale_preference(scope,org_id,user_id,locale) VALUES ('user','${a}','rls-user-a','en');`],
    ['foreign organization insert denied', denied(`INSERT INTO ui_locale_preference(scope,org_id,user_id,locale) VALUES ('user','${b}','rls-user-a','en')`)],
    ['foreign org default insert denied', `RESET ROLE; DELETE FROM ui_locale_preference WHERE org_id='${b}'; SET LOCAL ROLE axiom_app; ${denied(`INSERT INTO ui_locale_preference(scope,org_id,locale) VALUES ('org','${b}','en')`)}`],
    ['another user insert denied', denied(`INSERT INTO ui_locale_preference(scope,org_id,user_id,locale) VALUES ('user','${a}','rls-user-b','en')`)],
    ['foreign read/update/delete invisible', `DO $probe$ DECLARE n int; BEGIN
      SELECT count(*) INTO n FROM ui_locale_preference WHERE org_id='${b}'; IF n<>0 THEN RAISE EXCEPTION 'Foreign read'; END IF;
      UPDATE ui_locale_preference SET locale='de' WHERE org_id='${b}'; GET DIAGNOSTICS n=ROW_COUNT; IF n<>0 THEN RAISE EXCEPTION 'Foreign update'; END IF;
      DELETE FROM ui_locale_preference WHERE org_id='${b}'; GET DIAGNOSTICS n=ROW_COUNT; IF n<>0 THEN RAISE EXCEPTION 'Foreign delete'; END IF;
      END $probe$;`],
    ['tenant reassignment denied', `INSERT INTO ui_locale_preference(scope,org_id,locale) VALUES ('org','${a}','en');
      ${denied(`UPDATE ui_locale_preference SET org_id='${b}' WHERE org_id='${a}'`)}`],
    ['unset tenant context denied', `SELECT set_config('app.current_org_id','',true); DO $probe$ BEGIN
      INSERT INTO ui_locale_preference(scope,org_id,user_id,locale) VALUES ('user','${b}','rls-user-a','en');
      RAISE EXCEPTION 'Expected unset context denial'; EXCEPTION WHEN insufficient_privilege OR invalid_text_representation THEN NULL; END $probe$;`],
  ];
  for (const [caseName, statement] of cases) check(caseName, () => sql(`BEGIN; ${seed}\n${statement}\nROLLBACK;`));
  check('behavioral fixtures rolled back', () => assert.equal(sql(`SELECT count(*) FROM org WHERE id IN ('${a}','${b}')`), '0'));
  if (receipt.failed) process.exitCode = 1;
} catch (error) {
  receipt.failed++;
  receipt.error = error.message;
  process.exitCode = 1;
} finally {
  try {
    if (created) {
      const info = JSON.parse(docker(['inspect', name]))[0];
      assert.equal(info.Config.Labels[label], id, 'Refuse cleanup of unowned container');
      docker(['rm', '--force', '--volumes', name]);
      const remaining = docker(['ps', '-a', '--filter', `label=${label}=${id}`, '--format', '{{.ID}}']);
      assert.equal(remaining, '', 'Owned container remains');
    }
    receipt.cleanup = true;
  } catch { receipt.failed++; receipt.cleanup = false; process.exitCode = 1; }
  receipt.total = receipt.passed + receipt.failed + receipt.skipped;
  writeFileSync(new URL('receipt.json', output), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt, null, 2));
  console.log(`Private rehearsal logs: ${fileURLToPath(output)}`);
}
