import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const expectedArgs = ['--isolated-fixture', '--tested-sha'];
if (process.argv.length !== 5 || process.argv[2] !== expectedArgs[0] || process.argv[3] !== expectedArgs[1]) {
  console.error('Recovery rehearsal requires --isolated-fixture --tested-sha <full-commit-sha>');
  process.exit(2);
}

const forbiddenEnvironmentNames = Object.keys(process.env).filter(name =>
  /^(?:DATABASE_URL|TEST_DATABASE_URL|MIGRATOR_DATABASE_URL|PG[A-Z0-9_]*|AWS_[A-Z0-9_]*|CLOUDFLARE_[A-Z0-9_]*|R2_[A-Z0-9_]*|AXIOM_(?:R2|KMS|.*ENCRYPTION_KEY).*)$/.test(name)
  && process.env[name] !== '');
if (forbiddenEnvironmentNames.length > 0) {
  console.error('Recovery rehearsal refuses ambient database or cloud credentials');
  process.exit(2);
}

const testedSha = process.argv[4];
assert.match(testedSha, /^[0-9a-f]{40}$/i, 'A full tested commit SHA is required');
const pinnedNode = readFileSync(join(root, '.nvmrc'), 'utf8').trim();
assert.equal(process.versions.node, pinnedNode, 'Use the repository-pinned Node version');
assert.equal(process.platform, 'linux', 'Recovery Docker rehearsal is supported only on isolated Linux runners');

const id = randomUUID();
const shortId = id.replaceAll('-', '').slice(0, 12);
const labelKey = 'axiom.rehearsal-id';
const labelValue = `recovery-${id}`;
const purposeLabel = 'axiom.purpose=isolated-recovery-dr';
const image = 'timescale/timescaledb:2.29.2-pg16@sha256:289d55704b1b3ee8263cd3805c6930f9cd54506835a8f19f9b85dad17d5c5a8a';
const receiptDir = join(root, 'var', 'recovery-dr', id);
const receiptPath = join(receiptDir, 'receipt.json');
mkdirSync(receiptDir, { recursive: true, mode: 0o700 });

const dockerConfig = join(tmpdir(), `axiom-recovery-docker-${shortId}`);
mkdirSync(dockerConfig, { mode: 0o700 });
const processEnv = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', DOCKER_CONFIG: dockerConfig };
const dockerEnv = { ...processEnv, DOCKER_HOST: 'unix:///var/run/docker.sock' };
const receipt = {
  sourceSha: '',
  command: `node scripts/rehearse-pitr-recovery.mjs --isolated-fixture --tested-sha ${testedSha}`,
  node: process.versions.node,
  environment: 'GitHub-hosted Linux runner; two network-disabled disposable PostgreSQL clusters; synthetic data and keys',
  image,
  imageId: null,
  migrationArchiveSha256: null,
  drills: [],
  assertions: [],
  passed: 0,
  failed: 0,
  skipped: 0,
  expectedRejections: 0,
  cleanupVerified: false,
  limitations: [
    'No Cloudflare R2 account, bucket-lock/retention rule, external KMS/KEK, application deployment, worker, or provider was used.',
    'The network-disabled recovery hold and unknown-job row are inspected in the restored migrated database; no post-recovery dispatch is attempted.',
    'This synthetic PITR rehearsal is partial evidence and does not satisfy NONFUNCTIONAL-6 or establish production RPO/RTO.',
  ],
};

class RehearsalAssertion extends Error {}
function safeDiagnostic(value) {
  return String(value ?? '')
    .replace(/\b(?:postgres(?:ql)?|https?):\/\/[^\s"']+/gi, match => `${match.split('://', 1)[0]}://[redacted]`)
    .replace(/\b(?:Bearer|Basic)\s+\S+/gi, match => `${match.split(/\s+/, 1)[0]} [redacted]`)
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/gi, '[redacted-gh-token]')
    .replace(/\b([A-Z0-9_]*(?:PASSWORD|SECRET|TOKEN|CREDENTIAL|PRIVATE_KEY)[A-Z0-9_]*)\s*[:=]\s*\S+/gi, '$1=[redacted]')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .slice(-8)
    .join(' | ')
    .slice(0, 1600);
}
function run(command, args, { input, timeout = 120_000, env = processEnv, binaryOutput = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    input,
    timeout,
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
    ...(binaryOutput ? {} : { encoding: 'utf8' }),
  });
  if (result.error || result.signal || result.status === null) {
    const detail = safeDiagnostic(result.error?.message ?? result.stderr);
    throw new Error(`${command} did not complete successfully${detail ? `: ${detail}` : ''}`);
  }
  return result;
}
function docker(args, options = {}) {
  const result = run('docker', args, { env: dockerEnv, ...options });
  if (result.status !== 0) {
    const detail = safeDiagnostic(result.stderr);
    throw new Error(`Disposable Docker operation failed (exit ${result.status})${detail ? `: ${detail}` : ''}`);
  }
  return options.binaryOutput ? result.stdout : String(result.stdout ?? '').trim();
}
function labeled(args) {
  return ['--label', purposeLabel, '--label', `${labelKey}=${labelValue}`, ...args];
}
function check(name, assertion) {
  try {
    assertion();
    receipt.passed++;
    receipt.assertions.push({ name, result: 'passed' });
  } catch {
    receipt.failed++;
    receipt.assertions.push({ name, result: 'failed' });
    throw new RehearsalAssertion(`Recovery assertion failed: ${name}`);
  }
}
function expectedReject(name, operation, predicate) {
  let result;
  try { result = operation(); } catch { result = null; }
  check(name, () => {
    assert.ok(result, 'Expected a completed negative-control process');
    predicate(result);
  });
  receipt.expectedRejections++;
}
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function encrypt(key, plain) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext };
}
function decrypt(key, encrypted, ciphertext = encrypted.ciphertext) {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(encrypted.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64'));
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
function verifyEncryptedObject(ciphertext, envelope, kek) {
  assert.ok(Buffer.isBuffer(ciphertext) && ciphertext.length > 0, 'Object bytes must exist');
  assert.equal(sha256(ciphertext), envelope.ciphertextSha256, 'Ciphertext checksum must match');
  const dek = decrypt(kek, {
    ...envelope.wrappedDek,
    ciphertext: Buffer.from(envelope.wrappedDek.ciphertext, 'base64'),
  });
  assert.equal(dek.length, 32, 'Unwrapped DEK has the expected size');
  const plain = decrypt(dek, envelope.payload, ciphertext);
  assert.equal(sha256(plain), envelope.plaintextSha256, 'Decrypted object checksum must match');
  return plain;
}
function sql(container, statement) {
  return docker(['exec', container, 'psql', '-X', '-q', '-U', 'axiom',
    '-d', 'axiom_test', '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-c', statement]);
}
function volume(name) {
  docker(['volume', 'create', '--label', purposeLabel, '--label', `${labelKey}=${labelValue}`, name]);
  return name;
}
function runHelper(args, { input, timeout = 120_000 } = {}) {
  docker(['run', '--rm', ...labeled(['--network', 'none', ...args])], { input, timeout });
}
async function waitUntil(description, operation, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if (operation()) return; } catch { /* the service may still be starting */ }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 1000));
  }
  throw new Error(`Timed out waiting for ${description}`);
}
function archiveSnapshot(container) {
  const migrationRows = sql(container,
    "SELECT migration_name || ':' || checksum_sha256 FROM public.axiom_schema_migrations ORDER BY migration_name");
  const roles = sql(container,
    "SELECT rolname || ':' || rolsuper || ':' || rolbypassrls || ':' || rolcanlogin FROM pg_roles WHERE rolname !~ '^pg_' ORDER BY rolname");
  return {
    migrationCount: migrationRows ? migrationRows.split('\n').length : 0,
    migrationLedgerSha256: sha256(migrationRows),
    roleInventorySha256: sha256(roles),
    publicTableCount: Number(sql(container, "SELECT count(*) FROM pg_tables WHERE schemaname='public'")),
    systemIdentifier: sql(container, 'SELECT system_identifier::text FROM pg_control_system()'),
  };
}
function sqlLiteral(value) { return `'${String(value).replaceAll("'", "''")}'`; }

let failure = null;
let migrationArchive;
let dockerReady = false;
let currentStep = 'source preflight';
try {
  const head = run('git', ['rev-parse', 'HEAD']).stdout.trim();
  check('tested SHA matches checked-out source', () => assert.equal(head, testedSha));
  receipt.sourceSha = head;
  const status = run('git', ['status', '--porcelain', '--untracked-files=no']).stdout.trim();
  check('source checkout has no tracked changes', () => assert.equal(status, ''));

  const dockerInfo = docker(['info', '--format', '{{.OSType}}']);
  check('Docker daemon uses Linux containers', () => assert.equal(dockerInfo, 'linux'));
  dockerReady = true;
  currentStep = 'pinned PostgreSQL image pull';
  docker(['pull', image], { timeout: 300_000 });
  receipt.imageId = docker(['image', 'inspect', '--format', '{{.Id}}', image]);
  check('recovery image identity is immutable', () => assert.match(receipt.imageId, /^sha256:[a-f0-9]{64}$/));

  const archived = run('git', ['archive', '--format=tar', testedSha, 'scripts/migrate.sh', 'packages/db/migrations'],
    { timeout: 30_000, binaryOutput: true });
  check('migration source archive is source-bound', () => assert.equal(archived.status, 0));
  migrationArchive = archived.stdout;
  receipt.migrationArchiveSha256 = sha256(migrationArchive);

  for (let drillNumber = 1; drillNumber <= 2; drillNumber++) {
    currentStep = `drill ${drillNumber} cluster creation and migration`;
    const suffix = `${shortId}-${drillNumber}`;
    const source = `axiom-dr-${suffix}-source`;
    const restored = `axiom-dr-${suffix}-restored`;
    const dataVolume = volume(`axiom-dr-${suffix}-data`);
    const backupVolume = volume(`axiom-dr-${suffix}-backup`);
    const restoreVolume = volume(`axiom-dr-${suffix}-restore`);
    const archiveVolume = volume(`axiom-dr-${suffix}-wal`);
    const objectsVolume = volume(`axiom-dr-${suffix}-objects`);
    const corruptVolume = volume(`axiom-dr-${suffix}-corrupt-backup`);
    for (const target of [backupVolume, restoreVolume, archiveVolume, objectsVolume, corruptVolume]) {
      runHelper(['--user', '0:0', '--volume', `${target}:/owned`, image, 'chown', '-R', 'postgres:postgres', '/owned']);
    }
    docker(['run', '--detach', ...labeled([
      '--name', source, '--network', 'none', '--volume', `${dataVolume}:/var/lib/postgresql/data`,
      '--volume', `${backupVolume}:/backup`, '--volume', `${archiveVolume}:/wal-archive`,
      '--volume', `${objectsVolume}:/objects`, '--env', 'POSTGRES_USER=axiom', '--env', 'POSTGRES_DB=axiom_test',
      '--env', 'POSTGRES_HOST_AUTH_METHOD=trust', '--env', 'POSTGRES_INITDB_ARGS=--auth-local=trust', image,
      'postgres', '-c', 'listen_addresses=localhost', '-c', 'timezone=UTC', '-c', 'wal_level=replica',
      '-c', 'max_wal_senders=4', '-c', 'archive_mode=on', '-c', 'archive_timeout=1s',
      '-c', 'archive_command=test ! -f /wal-archive/%f && cp %p /wal-archive/%f',
    ])], { timeout: 120_000 });

    await waitUntil(`${source} readiness`, () => run('docker', ['exec', source, 'pg_isready', '-h', '127.0.0.1', '-U', 'axiom', '-d', 'axiom_test'], { env: dockerEnv, timeout: 8000 }).status === 0);
    check(`drill ${drillNumber}: source cluster starts without network egress`, () =>
      assert.equal(docker(['inspect', '--format', '{{.HostConfig.NetworkMode}}', source]), 'none'));
    docker(['exec', source, 'mkdir', '-p', '/fixture']);
    docker(['exec', '-i', source, 'tar', '-xf', '-', '-C', '/fixture'], { input: migrationArchive });
    let firstMigrationCount = 0;
    for (let pass = 0; pass < 2; pass++) {
      docker(['exec', '--env', 'MIGRATOR_DATABASE_URL=postgresql://axiom@/axiom_test', source,
        'sh', '/fixture/scripts/migrate.sh'], { timeout: 300_000 });
      const currentCount = Number(sql(source, 'SELECT count(*) FROM public.axiom_schema_migrations'));
      if (pass === 0) firstMigrationCount = currentCount;
      else check(`drill ${drillNumber}: migration rerun is idempotent`, () => assert.equal(currentCount, firstMigrationCount));
    }
    const migrationCount = Number(sql(source, 'SELECT count(*) FROM public.axiom_schema_migrations'));
    check(`drill ${drillNumber}: repository migrations applied and rerun safely`, () => assert.ok(migrationCount > 0));

    const orgId = randomUUID();
    const jobId = randomUUID();
    const objectName = `encrypted-media-${drillNumber}-${shortId}.bin`;
    sql(source, `CREATE SCHEMA dr_recovery;
      CREATE TABLE dr_recovery.marker (name text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT clock_timestamp());
      CREATE TABLE dr_recovery.key_envelope (object_name text PRIMARY KEY, envelope jsonb NOT NULL);
      INSERT INTO dr_recovery.marker(name) VALUES ('base-backup-anchor');
      INSERT INTO org (id, name, slug) VALUES (${sqlLiteral(orgId)}, 'Synthetic DR fixture', ${sqlLiteral(`dr-${suffix}`)});
      INSERT INTO org_settings (org_id, publishing_enabled, kill_switch_reason, kill_switch_actor, kill_switch_at)
        VALUES (${sqlLiteral(orgId)}, false, 'restore rehearsal hold', 'recovery-dr-fixture', now());`);

    docker(['exec', source, 'sh', '-c', 'printf "\\nlocal replication axiom trust\\n" >> "$PGDATA/pg_hba.conf" && pg_ctl -D "$PGDATA" reload']);
    docker(['exec', '--user', 'postgres', source, 'pg_basebackup', '-h', '/var/run/postgresql', '-U', 'axiom',
      '-D', '/backup', '--format=plain', '--wal-method=stream', '--no-password'], { timeout: 300_000 });
    const baseSnapshot = archiveSnapshot(source);
    check(`drill ${drillNumber}: physical base backup contains full schema and global roles`, () => {
      assert.ok(baseSnapshot.publicTableCount > 0);
      assert.ok(baseSnapshot.migrationCount > 0);
      assert.match(baseSnapshot.systemIdentifier, /^\d+$/);
    });
    check(`drill ${drillNumber}: base backup manifest verifies`, () => {
      assert.equal(run('docker', ['exec', '--user', 'postgres', source, 'pg_verifybackup', '/backup'],
        { env: dockerEnv, timeout: 120_000 }).status, 0);
    });

    const kek = randomBytes(32);
    const dek = randomBytes(32);
    const plainObject = Buffer.from(`Synthetic recovery media payload for drill ${drillNumber}; no customer content.`);
    const payload = encrypt(dek, plainObject);
    const wrappedDek = encrypt(kek, dek);
    const envelope = {
      keyId: `synthetic-kek-${shortId}-${drillNumber}`,
      wrappedDek: { iv: wrappedDek.iv, tag: wrappedDek.tag, ciphertext: wrappedDek.ciphertext.toString('base64') },
      payload: { iv: payload.iv, tag: payload.tag },
      plaintextSha256: sha256(plainObject),
      ciphertextSha256: sha256(payload.ciphertext),
    };
    docker(['exec', '-i', '--user', 'postgres', source, 'sh', '-c', `cat > /objects/${objectName}`], { input: payload.ciphertext });
    sql(source, `INSERT INTO dr_recovery.key_envelope(object_name, envelope)
      VALUES (${sqlLiteral(objectName)}, ${sqlLiteral(JSON.stringify(envelope))}::jsonb);
      INSERT INTO dr_recovery.marker(name) VALUES ('pitr-recoverable-marker');
      INSERT INTO job (id, org_id, queue, kind, state, attempts, max_attempts, last_error)
        VALUES (${sqlLiteral(jobId)}, ${sqlLiteral(orgId)}, 'publish', 'publish.target', 'dead', 1, 8,
          'external-side-effect-unknown: injected recovery interruption');`);
    const targetTime = sql(source, "SELECT clock_timestamp()::text");
    check(`drill ${drillNumber}: PITR target timestamp is parseable`, () => assert.ok(Number.isFinite(Date.parse(targetTime))));
    sql(source, "INSERT INTO dr_recovery.marker(name) VALUES ('after-pitr-target')");
    const walFile = sql(source, 'SELECT pg_walfile_name(pg_current_wal_lsn())');
    sql(source, 'SELECT pg_switch_wal()');
    currentStep = `drill ${drillNumber} WAL archival`;
    await waitUntil(`archived WAL segment ${walFile}`, () => run('docker',
      ['exec', source, 'test', '-f', `/wal-archive/${walFile}`], { env: dockerEnv, timeout: 8000 }).status === 0, 120_000);
    const archivedWalCount = Number(sql(source, "SELECT count(*) FROM pg_ls_dir('/wal-archive')"));
    check(`drill ${drillNumber}: WAL archiving produced a recoverable segment`, () => assert.ok(archivedWalCount > 0));

    const faultAtMs = Date.now();
    const rpoMs = faultAtMs - Date.parse(targetTime);
    docker(['stop', '--time', '5', source], { timeout: 30_000 });
    check(`drill ${drillNumber}: WAL-derived RPO is at most five minutes`, () => assert.ok(rpoMs >= 0 && rpoMs <= 5 * 60_000));

    const targetConfig = [
      "restore_command = 'test -f /wal-archive/%f && cp /wal-archive/%f %p'",
      `recovery_target_time = '${targetTime.replaceAll("'", "''")}'`,
      "recovery_target_action = 'promote'",
      "recovery_target_inclusive = 'on'",
    ].join('\n') + '\n';
    runHelper(['--volume', `${backupVolume}:/source:ro`, '--volume', `${restoreVolume}:/restore`, image,
      'sh', '-c', 'cp -a /source/. /restore/']);
    runHelper(['--interactive', '--volume', `${restoreVolume}:/restore`, image, 'sh', '-c',
      'touch /restore/recovery.signal && cat > /restore/postgresql.auto.conf'], { input: targetConfig });

    currentStep = `drill ${drillNumber} fresh-cluster PITR restore`;
    docker(['run', '--detach', ...labeled([
      '--name', restored, '--network', 'none', '--volume', `${restoreVolume}:/var/lib/postgresql/data`,
      '--volume', `${archiveVolume}:/wal-archive`, '--volume', `${objectsVolume}:/objects`, image,
      'postgres', '-c', 'listen_addresses=localhost', '-c', 'timezone=UTC',
    ])], { timeout: 120_000 });
    await waitUntil(`${restored} readiness`, () => run('docker', ['exec', restored, 'pg_isready', '-h', '127.0.0.1', '-U', 'axiom', '-d', 'axiom_test'], { env: dockerEnv, timeout: 8000 }).status === 0, 180_000);
    await waitUntil(`${restored} PITR promotion`, () => sql(restored, 'SELECT pg_is_in_recovery()') === 'f', 180_000);

    const restoredSnapshot = archiveSnapshot(restored);
    check(`drill ${drillNumber}: fresh cluster restored the original system identifier`, () => assert.equal(restoredSnapshot.systemIdentifier, baseSnapshot.systemIdentifier));
    check(`drill ${drillNumber}: full migration ledger and roles survived physical restore`, () => {
      assert.equal(restoredSnapshot.migrationCount, baseSnapshot.migrationCount);
      assert.equal(restoredSnapshot.migrationLedgerSha256, baseSnapshot.migrationLedgerSha256);
      assert.equal(restoredSnapshot.roleInventorySha256, baseSnapshot.roleInventorySha256);
      assert.equal(restoredSnapshot.publicTableCount, baseSnapshot.publicTableCount);
    });
    check(`drill ${drillNumber}: target time includes prior WAL and excludes later commits`, () => {
      assert.equal(sql(restored, "SELECT count(*) FROM dr_recovery.marker WHERE name='pitr-recoverable-marker'"), '1');
      assert.equal(sql(restored, "SELECT count(*) FROM dr_recovery.marker WHERE name='after-pitr-target'"), '0');
    });
    check(`drill ${drillNumber}: unknown publish outcome and recovery hold remain durable`, () => {
      assert.equal(sql(restored, `SELECT state || ':' || (last_error LIKE 'external-side-effect-unknown:%')::text
        FROM job WHERE id=${sqlLiteral(jobId)}`), 'dead:true');
      assert.equal(sql(restored, `SELECT publishing_enabled::text FROM org_settings WHERE org_id=${sqlLiteral(orgId)}`), 'false');
      assert.equal(sql(restored, `SELECT count(*) FROM job WHERE org_id=${sqlLiteral(orgId)} AND state='ready'
        AND kind IN ('publish.target','relay.card')`), '0');
    });
    check(`drill ${drillNumber}: restored unknown publish job is not auto-claimed`, () => {
      assert.equal(sql(restored, "SELECT count(*) FROM claim_job('recovery-dr-negative-control')"), '0');
    });
    const recoveredCiphertext = docker(['exec', '--user', 'postgres', restored, 'cat', `/objects/${objectName}`], { binaryOutput: true });
    const recoveredEnvelope = JSON.parse(sql(restored,
      `SELECT envelope::text FROM dr_recovery.key_envelope WHERE object_name=${sqlLiteral(objectName)}`));
    const plaintext = verifyEncryptedObject(recoveredCiphertext, recoveredEnvelope, kek);
    check(`drill ${drillNumber}: separately stored encrypted media and synthetic wrapped key recover`, () => {
      assert.equal(sha256(plaintext), sha256(plainObject));
      assert.equal(sha256(recoveredCiphertext), envelope.ciphertextSha256);
    });
    const rtoMs = Date.now() - faultAtMs;
    check(`drill ${drillNumber}: database PITR duration is at most sixty minutes`, () => assert.ok(rtoMs <= 60 * 60_000));
    const networkMode = docker(['inspect', '--format', '{{.HostConfig.NetworkMode}}', restored]);
    check(`drill ${drillNumber}: recovered cluster has egress disabled`, () => assert.equal(networkMode, 'none'));

    expectedReject(`drill ${drillNumber}: recovered object integrity rejects incomplete bytes`, () => {
      try { verifyEncryptedObject(Buffer.alloc(0), recoveredEnvelope, kek); return { accepted: true }; }
      catch { return { accepted: false }; }
    }, value => assert.equal(value.accepted, false));
    expectedReject(`drill ${drillNumber}: recovered object integrity rejects changed bytes`, () => {
      const changed = Buffer.from(recoveredCiphertext);
      changed[0] ^= 0xff;
      try { verifyEncryptedObject(changed, recoveredEnvelope, kek); return { accepted: true }; }
      catch { return { accepted: false }; }
    }, value => assert.equal(value.accepted, false));
    expectedReject(`drill ${drillNumber}: synthetic key access rejects an unavailable KEK`, () => {
      try { verifyEncryptedObject(recoveredCiphertext, recoveredEnvelope, randomBytes(32)); return { accepted: true }; }
      catch { return { accepted: false }; }
    }, value => assert.equal(value.accepted, false));

    currentStep = `drill ${drillNumber} recovery negative controls`;
    docker(['run', '--rm', ...labeled(['--network', 'none', '--volume', `${backupVolume}:/source:ro`,
      '--volume', `${corruptVolume}:/corrupt`, image, 'sh', '-c',
      'cp -a /source/. /corrupt/ && printf "corrupt-manifest\\n" > /corrupt/backup_manifest'])]);
    const corruptCheck = run('docker', ['run', '--rm', ...labeled(['--network', 'none', '--volume',
      `${corruptVolume}:/corrupt:ro`, image, 'pg_verifybackup', '/corrupt'])], { env: dockerEnv, timeout: 120_000 });
    expectedReject(`drill ${drillNumber}: pg_verifybackup rejects a corrupted base backup`, () => corruptCheck,
      value => { assert.notEqual(value.status, 0); assert.match(`${value.stdout ?? ''}${value.stderr ?? ''}`, /pg_verifybackup:/i); });
    const missingCheck = run('docker', ['run', '--rm', ...labeled(['--network', 'none', image,
      'pg_verifybackup', `/missing/${shortId}`])], { env: dockerEnv, timeout: 120_000 });
    expectedReject(`drill ${drillNumber}: pg_verifybackup rejects a missing base backup`, () => missingCheck,
      value => { assert.notEqual(value.status, 0); assert.match(`${value.stdout ?? ''}${value.stderr ?? ''}`, /pg_verifybackup:/i); });

    receipt.drills.push({
      number: drillNumber,
      systemIdentifier: restoredSnapshot.systemIdentifier,
      migrationCount: restoredSnapshot.migrationCount,
      publicTableCount: restoredSnapshot.publicTableCount,
      archivedWalSegments: archivedWalCount,
      targetTime,
      rpoMs,
      databaseRtoMs: rtoMs,
      egress: 'disabled (Docker network=none)',
      unknownPublishOutcome: 'preserved as dead/unknown; publishing remains disabled; no dispatch attempted',
      objectCiphertextSha256: envelope.ciphertextSha256,
      keyHandling: 'synthetic in-memory KEK only; not an external KMS test',
    });
  }
} catch (error) {
  failure = error instanceof RehearsalAssertion
    ? error.message
    : `${currentStep}: ${safeDiagnostic(error.message) || 'recovery rehearsal execution failed'}`;
  if (!(error instanceof RehearsalAssertion)) {
    receipt.failed++;
    receipt.assertions.push({ name: 'recovery rehearsal execution', result: 'failed' });
  }
} finally {
  let dockerResourcesClean = false;
  let clientConfigClean = false;
  try {
    if (dockerReady) {
      const containers = docker(['ps', '-aq', '--filter', `label=${labelKey}=${labelValue}`]).split(/\r?\n/).filter(Boolean);
      for (const container of containers) {
        const labels = docker(['inspect', '--format', `{{index .Config.Labels "${labelKey}"}}`, container]);
        if (labels !== labelValue) throw new Error('Refusing to remove a container with a different rehearsal label');
        docker(['rm', '-f', container]);
      }
      const volumes = docker(['volume', 'ls', '-q', '--filter', `label=${labelKey}=${labelValue}`]).split(/\r?\n/).filter(Boolean);
      for (const target of volumes) {
        const labels = docker(['volume', 'inspect', '--format', `{{index .Labels "${labelKey}"}}`, target]);
        if (labels !== labelValue) throw new Error('Refusing to remove a volume with a different rehearsal label');
        docker(['volume', 'rm', target]);
      }
      const remainingContainers = docker(['ps', '-aq', '--filter', `label=${labelKey}=${labelValue}`]);
      const remainingVolumes = docker(['volume', 'ls', '-q', '--filter', `label=${labelKey}=${labelValue}`]);
      dockerResourcesClean = remainingContainers === '' && remainingVolumes === '';
      if (!dockerResourcesClean) failure ??= 'Owned Docker resource cleanup could not be verified';
    }
  } catch {
    dockerResourcesClean = false;
    failure ??= 'Owned Docker resource cleanup could not be verified';
  }
  try {
    rmSync(dockerConfig, { recursive: true, force: true });
    if (existsSync(dockerConfig)) throw new Error('Temporary Docker client configuration remains');
    clientConfigClean = true;
  }
  catch { failure ??= 'Temporary Docker client configuration cleanup could not be verified'; }
  receipt.cleanupVerified = dockerResourcesClean && clientConfigClean;
  receipt.failure = failure;
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(receipt));
}

if (failure || receipt.failed > 0 || !receipt.cleanupVerified) process.exitCode = 1;
