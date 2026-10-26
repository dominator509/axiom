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
const recoveryRunId = process.env.GITHUB_RUN_ID?.trim();
const apiImage = process.env.AXIOM_RECOVERY_API_IMAGE?.trim();
const workerImage = process.env.AXIOM_RECOVERY_WORKER_IMAGE?.trim();
if (!/^\d+$/.test(recoveryRunId ?? '')
  || apiImage !== `axiom-recovery-api:${recoveryRunId}`
  || workerImage !== `axiom-recovery-worker:${recoveryRunId}`) {
  console.error('Recovery rehearsal requires the run-scoped API and worker images built by recovery-dr CI');
  process.exit(2);
}
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
  environment: 'GitHub-hosted Linux runner; two network-disabled disposable PostgreSQL clusters; source-labeled API/worker images; separate synthetic media backup/restore volumes, data, and keys',
  image,
  imageId: null,
  apiImage,
  apiImageId: null,
  workerImage,
  workerImageId: null,
  migrationArchiveSha256: null,
  drills: [],
  assertions: [],
  passed: 0,
  failed: 0,
  skipped: 0,
  expectedRejections: 0,
  cleanupVerified: false,
  limitations: [
    'No dashboard, reverse proxy, production deployment, Cloudflare R2 account/retention rule, external KMS/KEK, or real provider was used.',
    'Media backup and restore use separate disposable Docker volumes; this does not test an S3/R2 API or object-retention policy.',
    'The operator reconciliation uses a synthetic provider-readback assertion; it does not contact a provider or establish external provider reconciliation.',
    'PostgreSQL may promote at the end of available WAL before the requested recovery target; the missing-WAL control requires the post-backup target marker to remain absent, while production acceptance still needs an operator-facing target-integrity gate.',
    'This isolated recovery rehearsal is partial evidence and does not satisfy NONFUNCTIONAL-6 or establish production RPO/RTO.',
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
  } catch (error) {
    receipt.failed++;
    receipt.assertions.push({ name, result: 'failed', diagnostic: safeDiagnostic(error?.message ?? error) });
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
function nodeInContainer(container, source) {
  return docker(['exec', container, 'node', '--input-type=module', '-e', source]);
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
async function waitForContainerHealth(container, timeoutMs, secrets = []) {
  try {
    await waitUntil(`${container} health check`, () =>
      docker(['inspect', '--format', '{{.State.Health.Status}}', container]) === 'healthy', timeoutMs);
  } catch {
    const state = run('docker', ['inspect', '--format',
      '{{.State.Status}}|{{.State.ExitCode}}|{{.State.Health.Status}}|{{range .State.Health.Log}}{{.ExitCode}}:{{.Output}}{{end}}', container],
    { env: dockerEnv });
    const logs = run('docker', ['logs', '--tail', '40', container], { env: dockerEnv });
    let diagnostic = safeDiagnostic(`${state.stdout ?? ''} ${logs.stdout ?? ''} ${logs.stderr ?? ''}`);
    for (const secret of secrets) if (secret) diagnostic = diagnostic.replaceAll(secret, '[redacted-synthetic-secret]');
    throw new Error(`Timed out waiting for ${container} health${diagnostic ? `: ${diagnostic}` : ''}`);
  }
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
  for (const [label, ref, outputKey] of [
    ['API', apiImage, 'apiImageId'],
    ['worker', workerImage, 'workerImageId'],
  ]) {
    const imageId = docker(['image', 'inspect', '--format', '{{.Id}}', ref]);
    const imagePurpose = docker(['image', 'inspect', '--format', '{{index .Config.Labels "axiom.purpose"}}', ref]);
    const imageRun = docker(['image', 'inspect', '--format', '{{index .Config.Labels "axiom.rehearsal-run"}}', ref]);
    const imageRevision = docker(['image', 'inspect', '--format', '{{index .Config.Labels "org.opencontainers.image.revision"}}', ref]);
    check(`${label} image is immutable and source/run-bound`, () => {
      assert.match(imageId, /^sha256:[a-f0-9]{64}$/);
      assert.equal(imagePurpose, 'isolated-recovery-dr');
      assert.equal(imageRun, recoveryRunId);
      assert.equal(imageRevision, testedSha);
    });
    receipt[outputKey] = imageId;
  }
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
    const objectBackupVolume = volume(`axiom-dr-${suffix}-object-backup`);
    const objectRestoreVolume = volume(`axiom-dr-${suffix}-object-restore`);
    const missingObjectsVolume = volume(`axiom-dr-${suffix}-missing-objects`);
    const missingWalVolume = volume('axiom-dr-' + suffix + '-missing-wal');
    const corruptVolume = volume(`axiom-dr-${suffix}-corrupt-backup`);
    for (const target of [backupVolume, restoreVolume, archiveVolume, objectsVolume,
      objectBackupVolume, objectRestoreVolume, corruptVolume, missingWalVolume]) {
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
    const modelId = randomUUID();
    const bundleId = randomUUID();
    const targetId = randomUUID();
    const jobId = randomUUID();
    const idempotencyKey = randomBytes(32).toString('hex');
    const objectName = `encrypted-media-${drillNumber}-${shortId}.bin`;
    sql(source, `CREATE SCHEMA dr_recovery;
      CREATE TABLE dr_recovery.marker (name text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT clock_timestamp());
      CREATE TABLE dr_recovery.key_envelope (object_name text PRIMARY KEY, envelope jsonb NOT NULL);
      INSERT INTO dr_recovery.marker(name) VALUES ('base-backup-anchor');
      INSERT INTO org (id, name, slug) VALUES (${sqlLiteral(orgId)}, 'Synthetic DR fixture', ${sqlLiteral(`dr-${suffix}`)});
      INSERT INTO model_profile (id, org_id, display_name, handle)
        VALUES (${sqlLiteral(modelId)}, ${sqlLiteral(orgId)}, 'Synthetic recovery talent', ${sqlLiteral(`dr-${suffix}`)});
      INSERT INTO org_settings (org_id, publishing_enabled, kill_switch_reason, kill_switch_actor, kill_switch_at)
        VALUES (${sqlLiteral(orgId)}, false, 'restore rehearsal hold', 'recovery-dr-fixture', now());
      INSERT INTO content_bundle (id, org_id, model_id, captions, hashtags, state)
        VALUES (${sqlLiteral(bundleId)}, ${sqlLiteral(orgId)}, ${sqlLiteral(modelId)},
          '{"discord":"Synthetic recovery fixture"}'::jsonb, '[]'::jsonb, 'approved');
      INSERT INTO post_target (id, org_id, bundle_id, platform, state, idem_key)
        VALUES (${sqlLiteral(targetId)}, ${sqlLiteral(orgId)}, ${sqlLiteral(bundleId)}, 'discord', 'pending', decode(${sqlLiteral(idempotencyKey)}, 'hex'));`);

    docker(['exec', '--user', 'postgres', source, 'sh', '-c', 'printf "\\nlocal replication axiom trust\\n" >> "$PGDATA/pg_hba.conf" && pg_ctl -D "$PGDATA" reload']);
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

    currentStep = 'drill ' + drillNumber + ' missing-WAL negative control';
    const emptyWalCheck = run('docker', ['run', '--rm', ...labeled([
      '--network', 'none', '--volume', missingWalVolume + ':/wal:ro', image,
      'sh', '-c', 'test -z "$(ls -A /wal)"',
    ])], { env: dockerEnv, timeout: 30_000 });
    check('drill ' + drillNumber + ': missing-WAL control starts with an empty archive',
      () => assert.equal(emptyWalCheck.status, 0));
    const missingWalBackupCheck = run('docker', ['run', '--rm', ...labeled([
      '--network', 'none', '--volume', backupVolume + ':/backup:ro',
      '--volume', missingWalVolume + ':/wal:ro', image, 'pg_verifybackup',
      '--wal-directory=/wal', '/backup',
    ])], { env: dockerEnv, timeout: 120_000 });
    expectedReject('drill ' + drillNumber + ': pg_verifybackup rejects a backup when required WAL is missing',
      () => missingWalBackupCheck, value => {
        assert.notEqual(value.status, 0);
        assert.match(`${value.stdout ?? ''}${value.stderr ?? ''}`, /WAL|pg_waldump/i);
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
    runHelper(['--volume', `${objectsVolume}:/source:ro`, '--volume', `${objectBackupVolume}:/backup`, image,
      'sh', '-c', 'cp -a /source/. /backup/']);
    const backedUpCiphertext = docker(['run', '--rm', ...labeled(['--network', 'none',
      '--volume', `${objectBackupVolume}:/backup:ro`, image, 'sh', '-c', `cat /backup/${objectName}`])],
    { binaryOutput: true });
    check(`drill ${drillNumber}: media backup snapshot is separate and checksum-valid`, () => {
      assert.notEqual(objectBackupVolume, objectsVolume);
      assert.equal(sha256(backedUpCiphertext), envelope.ciphertextSha256);
    });
    sql(source, `INSERT INTO dr_recovery.key_envelope(object_name, envelope)
      VALUES (${sqlLiteral(objectName)}, ${sqlLiteral(JSON.stringify(envelope))}::jsonb);
      INSERT INTO dr_recovery.marker(name) VALUES ('pitr-recoverable-marker');
      INSERT INTO job (id, org_id, queue, kind, state, attempts, max_attempts, last_error)
        VALUES (${sqlLiteral(jobId)}, ${sqlLiteral(orgId)}, 'publish', 'publish.target', 'dead', 1, 8,
          'external-side-effect-unknown: injected recovery interruption');
      UPDATE job SET payload=jsonb_build_object('targetId', ${sqlLiteral(targetId)}::text) WHERE id=${sqlLiteral(jobId)};
      INSERT INTO pre_post_run (org_id, model_id, target_id, script, status, input, started_at)
        VALUES (${sqlLiteral(orgId)}, ${sqlLiteral(modelId)}, ${sqlLiteral(targetId)}, 'publish.dispatch', 'pending',
          jsonb_build_object('platform','discord','idempotencyKey',${sqlLiteral(idempotencyKey)}), now());`);
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
    runHelper(['--volume', `${objectBackupVolume}:/source:ro`, '--volume', `${objectRestoreVolume}:/restore`, image,
      'sh', '-c', 'cp -a /source/. /restore/']);

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
      '--volume', `${archiveVolume}:/wal-archive`, '--volume', `${objectRestoreVolume}:/objects`, image,
      'postgres', '-c', 'listen_addresses=localhost', '-c', 'timezone=UTC',
    ])], { timeout: 120_000 });
    await waitUntil(`${restored} readiness`, () => run('docker', ['exec', restored, 'pg_isready', '-h', '127.0.0.1', '-U', 'axiom', '-d', 'axiom_test'], { env: dockerEnv, timeout: 8000 }).status === 0, 180_000);
    await waitUntil(`${restored} PITR promotion`, () => sql(restored, 'SELECT pg_is_in_recovery()') === 'f', 180_000);
    check(`drill ${drillNumber}: fresh cluster mounts the separately restored media volume`, () => {
      const mounts = JSON.parse(docker(['inspect', '--format', '{{json .Mounts}}', restored]));
      assert.ok(mounts.some(mount => mount.Name === objectRestoreVolume && mount.Destination === '/objects'));
      assert.equal(mounts.some(mount => mount.Name === objectsVolume || mount.Name === objectBackupVolume), false);
    });

    currentStep = `drill ${drillNumber} missing archived WAL recovery rejection`;
    const missingWalRestored = `axiom-dr-${suffix}-missing-wal-restored`;
    const missingWalRestoreVolume = volume(`axiom-dr-${suffix}-missing-wal-restore`);
    runHelper(['--volume', `${backupVolume}:/source:ro`, '--volume', `${missingWalRestoreVolume}:/restore`, image,
      'sh', '-c', 'cp -a /source/. /restore/']);
    runHelper(['--interactive', '--volume', `${missingWalRestoreVolume}:/restore`, image, 'sh', '-c',
      'touch /restore/recovery.signal && cat > /restore/postgresql.auto.conf'], { input: targetConfig });
    docker(['run', '--detach', ...labeled([
      '--name', missingWalRestored, '--network', 'none', '--volume', `${missingWalRestoreVolume}:/var/lib/postgresql/data`,
      '--volume', `${missingWalVolume}:/wal-archive`, image,
      'postgres', '-c', 'listen_addresses=localhost', '-c', 'timezone=UTC',
    ])], { timeout: 120_000 });

    const missingWalProbeDeadline = Date.now() + 15_000;
    let missingWalProbe = { status: 1, stdout: '', stderr: '' };
    let missingWalContainerState;
    do {
      missingWalContainerState = JSON.parse(docker(['inspect', '--format', '{{json .State}}', missingWalRestored]));
      if (!missingWalContainerState.Running) break;
      missingWalProbe = run('docker', ['exec', missingWalRestored, 'psql', '-X', '-q', '-U', 'axiom',
        '-d', 'axiom_test', '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-c', 'SELECT pg_is_in_recovery()'],
      { env: dockerEnv, timeout: 8_000 });
      if (missingWalProbe.status === 0) break;
      await new Promise(resolve => setTimeout(resolve, 1_000));
    } while (Date.now() < missingWalProbeDeadline);
    missingWalContainerState = JSON.parse(docker(['inspect', '--format', '{{json .State}}', missingWalRestored]));
    const missingWalLogs = run('docker', ['logs', missingWalRestored], { env: dockerEnv, timeout: 8_000 });
    const missingWalRecoveryState = missingWalProbe.status === 0 ? missingWalProbe.stdout.trim() : null;
    const missingWalTargetMarkerCount = missingWalRecoveryState === 'f'
      ? sql(missingWalRestored, "SELECT count(*) FROM dr_recovery.marker WHERE name='pitr-recoverable-marker'")
      : null;
    const missingWalDiagnostic = safeDiagnostic(`${missingWalLogs.stdout ?? ''}${missingWalLogs.stderr ?? ''}`);
    const missingWalRecoveryOutcome = missingWalContainerState.Running
      ? (missingWalProbe.status === 0
        ? (missingWalRecoveryState === 't' ? 'waiting-in-recovery' : 'promoted-before-target')
        : 'unavailable')
      : 'exited-fail-closed';
    receipt.missingWalControls ??= [];
    receipt.missingWalControls.push({
      drill: drillNumber,
      outcome: missingWalRecoveryOutcome,
      containerStatus: missingWalContainerState.Status,
      exitCode: missingWalContainerState.ExitCode,
      probeStatus: missingWalProbe.status,
      recoveryState: missingWalRecoveryState,
      targetMarkerCount: missingWalTargetMarkerCount,
      diagnostic: missingWalDiagnostic,
    });
    check(`drill ${drillNumber}: missing archived WAL cannot recover the requested PITR target`, () => {
      assert.ok(missingWalContainerState.Running
        || (missingWalContainerState.Status === 'exited' && missingWalContainerState.ExitCode !== 0));
      if (missingWalContainerState.Running && missingWalProbe.status === 0) {
        assert.ok(missingWalRecoveryState === 't' || missingWalRecoveryState === 'f');
        if (missingWalRecoveryState === 'f') assert.equal(missingWalTargetMarkerCount, '0');
      } else if (missingWalContainerState.Status === 'exited') {
        assert.match(missingWalDiagnostic, /FATAL:\s+recovery ended before configured recovery target was reached/i);
      } else {
        assert.match(missingWalDiagnostic, /wal|restore command|archive/i);
      }
    });
    receipt.expectedRejections++;
    if (missingWalContainerState.Running) docker(['stop', '--time', '5', missingWalRestored]);

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
    check(`drill ${drillNumber}: independently backed-up encrypted media and synthetic wrapped key recover`, () => {
      assert.equal(sha256(plaintext), sha256(plainObject));
      assert.equal(sha256(recoveredCiphertext), envelope.ciphertextSha256);
    });

    const apiContainer = `axiom-dr-${suffix}-api`;
    const workerContainer = `axiom-dr-${suffix}-worker`;
    const databaseUrl = 'postgresql://axiom_app@127.0.0.1:5432/axiom_test';
    const authSecret = randomBytes(48).toString('base64url');
    const relaySecret = randomBytes(48).toString('base64url');
    currentStep = `drill ${drillNumber} restored application and worker startup`;
    docker(['run', '--detach', ...labeled([
      '--name', apiContainer, '--network', `container:${restored}`,
      '--health-interval', '1s', '--health-timeout', '5s', '--health-start-period', '2s', '--health-retries', '5',
      '--env', 'NODE_ENV=production', '--env', 'AXIOM_ENV=production', '--env', `DATABASE_URL=${databaseUrl}`,
      '--env', `BETTER_AUTH_SECRET=${authSecret}`, '--env', `RELAY_SECRET=${relaySecret}`,
      '--env', 'BETTER_AUTH_URL=https://127.0.0.1:3001',
      '--env', 'API_HOST=0.0.0.0', '--env', 'API_PORT=3001', '--env', 'AXIOM_SERVICE_NAME=recovery-api',
      apiImage,
    ])]);
    await waitForContainerHealth(apiContainer, 180_000, [authSecret, relaySecret]);
    check(`drill ${drillNumber}: restored API starts healthy against the PITR database`, () => {
      assert.equal(docker(['inspect', '--format', '{{.State.Status}}', apiContainer]), 'running');
      assert.equal(nodeInContainer(apiContainer,
        "const r=await fetch('http://127.0.0.1:3001/api/v1/health'); console.log(r.status)").trim(), '200');
    });
    const unauthenticatedStatus = Number(nodeInContainer(apiContainer,
      "const r=await fetch('http://127.0.0.1:3001/api/v1/incidents'); console.log(r.status)"));
    check(`drill ${drillNumber}: restored API keeps incident reads behind authentication`, () =>
      assert.equal(unauthenticatedStatus, 401));

    const operatorEmail = `recovery-${randomUUID()}@fixture.invalid`;
    const operatorPassword = randomBytes(32).toString('base64url');
    const signupSource = `const response=await fetch('http://127.0.0.1:3001/api/auth/sign-up/email',{method:'POST',headers:{Origin:'https://127.0.0.1:3001','Content-Type':'application/json'},body:JSON.stringify({email:${JSON.stringify(operatorEmail)},password:${JSON.stringify(operatorPassword)},name:'Synthetic recovery operator'})}); const body=await response.json(); const cookie=response.headers.getSetCookie().map(value=>value.split(';',1)[0]).join('; '); console.log(JSON.stringify({status:response.status,userId:body.user?.id??null,cookie}));`;
    const operator = JSON.parse(nodeInContainer(apiContainer, signupSource));
    check(`drill ${drillNumber}: restored API issues a synthetic operator session`, () => {
      assert.equal(operator.status, 200);
      assert.equal(typeof operator.userId, 'string');
      assert.match(operator.cookie, /session_token=/);
    });
    sql(restored, `UPDATE auth_user SET org_id=${sqlLiteral(orgId)}, role='operator'
      WHERE id=${sqlLiteral(operator.userId)}`);
    check(`drill ${drillNumber}: synthetic operator is assigned only to the recovery tenant`, () => {
      assert.equal(sql(restored, `SELECT count(*) FROM auth_user WHERE id=${sqlLiteral(operator.userId)}
        AND org_id=${sqlLiteral(orgId)} AND role='operator'`), '1');
    });
    const reconciliationIdempotencyKey = randomUUID();
    const reconcileSource = `const response=await fetch(${JSON.stringify(`http://127.0.0.1:3001/api/v1/incidents/${jobId}/reconcile`)},{method:'POST',headers:{Origin:'https://127.0.0.1:3001',Cookie:${JSON.stringify(operator.cookie)},'Content-Type':'application/json','Idempotency-Key':${JSON.stringify(reconciliationIdempotencyKey)}},body:JSON.stringify({outcome:'not_published',confirmed:true})}); const body=await response.json(); console.log(JSON.stringify({status:response.status,data:body.data??null}));`;
    const reconciliation = JSON.parse(nodeInContainer(apiContainer, reconcileSource));
    check(`drill ${drillNumber}: provider absence reconciliation returns HTTP ${reconciliation.status}`, () =>
      assert.equal(reconciliation.status, 200));
    check(`drill ${drillNumber}: provider absence reconciliation returns the expected safe outcome`, () =>
      assert.deepEqual(reconciliation.data, {
        jobId, targetId, outcome: 'not_published', state: 'dead', replayRequired: true, dispatchStarted: false,
      }));
    check(`drill ${drillNumber}: reconciliation keeps the publish job dead and replay-required`, () =>
      assert.equal(sql(restored, `SELECT state || ':' || (last_error LIKE 'provider-reconciled-not-published:%')::text
        FROM job WHERE id=${sqlLiteral(jobId)}`), 'dead:true'));
    check(`drill ${drillNumber}: reconciliation does not mark the target published`, () =>
      assert.equal(sql(restored, `SELECT state FROM post_target WHERE id=${sqlLiteral(targetId)}`), 'pending'));
    check(`drill ${drillNumber}: reconciliation resolves the uncertain dispatch marker`, () =>
      assert.equal(sql(restored, `SELECT status FROM pre_post_run WHERE target_id=${sqlLiteral(targetId)}`), 'reconciled-not-published'));
    check(`drill ${drillNumber}: reconciliation is written to the audit trail`, () =>
      assert.equal(sql(restored, `SELECT count(*) FROM audit_log WHERE org_id=${sqlLiteral(orgId)}
        AND action='incident.publish.reconcile' AND target=${sqlLiteral(jobId)}`), '1'));

    docker(['run', '--detach', ...labeled([
      '--name', workerContainer, '--network', `container:${restored}`,
      '--health-interval', '1s', '--health-timeout', '5s', '--health-start-period', '2s', '--health-retries', '5',
      '--env', 'NODE_ENV=production', '--env', 'AXIOM_ENV=production', '--env', `DATABASE_URL=${databaseUrl}`,
      '--env', 'MEDIA_PLANE_URL=http://127.0.0.1:8100', '--env', `RELAY_SECRET=${relaySecret}`,
      '--env', `WORKER_ID=recovery-${shortId}`, '--env', 'WORKER_POLL_INTERVAL_MS=250',
      workerImage,
    ])]);
    await waitForContainerHealth(workerContainer, 120_000, [relaySecret]);
    const restoredNetworkMode = docker(['inspect', '--format', '{{.HostConfig.NetworkMode}}', restored]);
    const restoredId = docker(['inspect', '--format', '{{.Id}}', restored]);
    const sharedNamespaceModes = new Set([`container:${restored}`, `container:${restoredId}`]);
    check(`drill ${drillNumber}: recovered API and worker share only the egress-disabled database namespace`, () => {
      assert.equal(restoredNetworkMode, 'none');
      assert.ok(sharedNamespaceModes.has(docker(['inspect', '--format', '{{.HostConfig.NetworkMode}}', apiContainer])));
      assert.ok(sharedNamespaceModes.has(docker(['inspect', '--format', '{{.HostConfig.NetworkMode}}', workerContainer])));
      assert.equal(docker(['inspect', '--format', '{{.State.Status}}', workerContainer]), 'running');
    });
    check(`drill ${drillNumber}: worker restart does not claim or replay the reconciled interrupted job`, () => {
      assert.equal(sql(restored, `SELECT state || ':' || (last_error LIKE 'provider-reconciled-not-published:%')::text
        FROM job WHERE id=${sqlLiteral(jobId)}`), 'dead:true');
      assert.equal(sql(restored, `SELECT count(*) FROM job WHERE org_id=${sqlLiteral(orgId)} AND state='ready'
        AND kind IN ('publish.target','relay.card')`), '0');
    });

    const rtoMs = Date.now() - faultAtMs;
    check(`drill ${drillNumber}: database, API, and worker recovery is at most sixty minutes`, () => assert.ok(rtoMs <= 60 * 60_000));

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
    const missingObjectCheck = run('docker', ['run', '--rm', ...labeled(['--network', 'none',
      '--volume', `${missingObjectsVolume}:/objects:ro`, image, 'sh', '-c', `cat /objects/${objectName}`])],
    { env: dockerEnv, timeout: 30_000 });
    expectedReject(`drill ${drillNumber}: recovery rejects a missing media object`, () => missingObjectCheck,
      value => { assert.notEqual(value.status, 0); assert.match(`${value.stdout ?? ''}${value.stderr ?? ''}`, /No such file/i); });
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
      missingWalRecoveryOutcome,
      archivedWalSegments: archivedWalCount,
      targetTime,
      rpoMs,
      databaseApiWorkerRtoMs: rtoMs,
      egress: 'disabled (Docker network=none)',
      restoredApi: 'healthy; unauthenticated incident read rejected; synthetic operator session issued',
      restoredWorker: 'healthy; shared only the restored PostgreSQL network=none namespace',
      unknownPublishOutcome: 'synthetic operator recorded not-published; job remains dead and replay-required; no dispatch attempted',
      mediaRestore: 'separate disposable backup volume copied into a distinct fresh volume; restored object checksum verified; no R2 API or retention test',
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
  let imageResourcesClean = false;
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
      for (const [ref, expectedImage] of [[apiImage, 'axiom-recovery-api'], [workerImage, 'axiom-recovery-worker']]) {
        const labels = docker(['image', 'inspect', '--format',
          '{{index .Config.Labels "axiom.purpose"}}|{{index .Config.Labels "axiom.rehearsal-run"}}|{{index .Config.Labels "org.opencontainers.image.revision"}}', ref]);
        if (labels !== `isolated-recovery-dr|${recoveryRunId}|${testedSha}` || !ref.startsWith(`${expectedImage}:`)) {
          throw new Error('Refusing to remove a recovery image without matching run/source labels');
        }
        docker(['image', 'rm', ref]);
      }
      const remainingContainers = docker(['ps', '-aq', '--filter', `label=${labelKey}=${labelValue}`]);
      const remainingVolumes = docker(['volume', 'ls', '-q', '--filter', `label=${labelKey}=${labelValue}`]);
      const remainingImages = docker(['image', 'ls', '-aq', '--filter', `label=axiom.rehearsal-run=${recoveryRunId}`,
        '--filter', 'label=axiom.purpose=isolated-recovery-dr']);
      imageResourcesClean = remainingImages === ''
        && [apiImage, workerImage].every(ref => run('docker', ['image', 'inspect', ref], { env: dockerEnv }).status !== 0);
      dockerResourcesClean = remainingContainers === '' && remainingVolumes === '';
      if (!dockerResourcesClean || !imageResourcesClean) failure ??= 'Owned Docker resource cleanup could not be verified';
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
  receipt.cleanupVerified = dockerResourcesClean && imageResourcesClean && clientConfigClean;
  receipt.failure = failure;
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(receipt));
}

if (failure || receipt.failed > 0 || !receipt.cleanupVerified) process.exitCode = 1;
