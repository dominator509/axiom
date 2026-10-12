// Source-bound local acceptance. Every database, model volume and target is owned.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

assert.deepEqual(process.argv.slice(2), ['--isolated-fixture']);
const root = resolve(import.meta.dirname, '..');
assert.equal(process.versions.node, readFileSync(join(root, '.nvmrc'), 'utf8').trim());
const id = randomUUID(), prefix = `axiom-l5-${id}`, label = 'axiom.l5-runtime';
const labels = ['--label', `${label}=${id}`];
const directory = join(root, 'var', 'l5-runtime', id);
mkdirSync(directory, { recursive: true });
const receipt = { sourceSha: '', command: 'node scripts/rehearse-l5-runtime.mjs --isolated-fixture',
  node: process.versions.node, environment: 'owned network-disabled Docker fixtures',
  egressFixture: { mode: 'test', scope: 'database-backed-health-only', productionProvisioner: 'scripts/rehearse-egress.mjs' },
  secretDelivery: { mechanism: 'ephemeral read-only file mount', containerPath: '/run/secrets/egress-kek',
    rootKeyInEnvironment: null, externalKms: false, filesCreated: 0, filesRemoved: 0, cleanupVerified: false },
  images: {}, runs: [], auditChecks: [], availability: null, passed: 0, failed: 0, skipped: 0, cleanup: false };
const secrets = [];
const secret = () => { const value = randomBytes(32).toString('hex'); secrets.push(value); return value; };
const scrub = text => secrets.reduce((value, key) => value.replaceAll(key, '[FIXTURE-REDACTED]'), String(text ?? ''));
let operation = 0;
const owned = { containers: new Set(), volumes: new Set(), images: new Set() };
const secretFiles = new Set();
function run(command, args, { input, env = {}, timeout = 180000, allowFailure = false } = {}) {
  const result = spawnSync(command, args, { cwd: root, input, windowsHide: true, timeout,
    env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 });
  writeFileSync(join(directory, `${++operation}.log`), scrub(Buffer.concat([result.stdout ?? Buffer.alloc(0), result.stderr ?? Buffer.alloc(0)]).toString()));
  if (result.status !== 0 && !allowFailure) throw new Error(`${command} operation ${operation} failed; inspect sanitized log`);
  return { status: result.status, stdout: (result.stdout ?? Buffer.alloc(0)).toString().trim() };
}
const docker = (args, options) => run('docker', args, options);
const sql = (db, statement) => docker(['exec', '-i', db, 'psql', '-X', '-qAt', '-U', 'axiom', '-d', 'axiom_test', '-v', 'ON_ERROR_STOP=1'], { input: statement });
function create(name, image, network, env, extra = [], command = [], allowedBindMountDestinations = []) {
  docker(['create', '--name', name, ...labels, '--network', network,
    ...Object.keys(env).flatMap(key => ['--env', key]), ...extra, image, ...command], { env });
  owned.containers.add(name);
  const info = JSON.parse(docker(['inspect', '--format',
    '{"labels":{{json .Config.Labels}},"privileged":{{json .HostConfig.Privileged}},"network":{{json .HostConfig.NetworkMode}},"mounts":{{json .Mounts}},"ports":{{json .HostConfig.PortBindings}}}', name]).stdout);
  assert.equal(info.labels[label], id);
  assert.equal(info.privileged, false);
  const networkModes = network.startsWith('container:')
    ? [network, `container:${docker(['inspect', '--format', '{{.Id}}', network.slice('container:'.length)]).stdout}`]
    : [network];
  assert.ok(networkModes.includes(info.network), 'Container must share only the intended fixture network namespace');
  assert.deepEqual(
    info.mounts.filter(m => m.Type === 'bind').map(m => m.Destination).sort(),
    [...allowedBindMountDestinations].sort(),
    'Only explicitly approved read-only fixture secret mounts may bind host files',
  );
  assert.equal(Object.keys(info.ports ?? {}).length, 0);
  docker(['start', name]);
  return info;
}
function remove(kind, name) {
  const inspect = kind === 'containers' ? ['inspect', '--format', '{{json .Config.Labels}}', name]
    : [kind === 'images' ? 'image' : 'volume', 'inspect', '--format', kind === 'images' ? '{{json .Config.Labels}}' : '{{json .Labels}}', name];
  assert.equal(JSON.parse(docker(inspect).stdout)[label], id, 'Owned resource required for cleanup');
  docker(kind === 'containers' ? ['rm', '--force', '--volumes', name] : [kind === 'images' ? 'image' : 'volume', 'rm', name]);
  owned[kind].delete(name);
}
async function ready(runner, port, expected = 200) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const result = docker(['exec', runner, 'node', '-e',
      `fetch('http://127.0.0.1:${port}/health').then(r=>{if(r.status!==${expected})process.exit(1)}).catch(()=>process.exit(1))`], { allowFailure: true, timeout: 10000 });
    if (result.status === 0) return;
    await delay(1000);
  }
  throw new Error(`Readiness on fixture port ${port} did not reach ${expected}`);
}
try {
  receipt.sourceSha = run('git', ['rev-parse', 'HEAD']).stdout;
  assert.match(receipt.sourceSha, /^[a-f0-9]{40}$/);
  assert.equal(run('git', ['status', '--porcelain']).stdout, '', 'Commit source before testing');
  const contextEndpoint = JSON.parse(docker(['context', 'inspect']).stdout)[0].Endpoints.docker.Host;
  const endpoint = process.env.DOCKER_CONTEXT ? contextEndpoint : process.env.DOCKER_HOST || contextEndpoint;
  assert.ok(endpoint.startsWith('npipe://') || endpoint.startsWith('unix://'), 'Local Docker only');
  const model = join(root, 'var', 'models', 'nsfw-vit.onnx');
  receipt.modelSha256 = createHash('sha256').update(readFileSync(model)).digest('hex');
  assert.equal(receipt.modelSha256, '2605f68c77b9262e51afa0ff022971c7a8dabcfa51f55c78321b711b889b0e93', 'Fetch the approved pinned model first');
  const archive = spawnSync('git', ['archive', '--format=tar', receipt.sourceSha], { cwd: root, windowsHide: true, maxBuffer: 128 * 1024 * 1024 });
  assert.equal(archive.status, 0);
  receipt.sourceArchiveSha256 = createHash('sha256').update(archive.stdout).digest('hex');
  for (const [kind, dockerfile] of [['hono', 'hono'], ['egress', 'rust'], ['vision', 'vision'], ['media', 'media']]) {
    console.log(`Building ${kind} from ${receipt.sourceSha}`);
    const tag = `${prefix}:${kind}`;
    docker(['build', ...labels, '-f', `infra/Dockerfile.${dockerfile}`, '-t', tag, '-'], { input: archive.stdout, timeout: 1800000 });
    owned.images.add(tag);
    receipt.images[kind] = docker(['image', 'inspect', '--format', '{{.Id}}', tag]).stdout;
  }
  receipt.images.database = 'timescale/timescaledb:2.29.2-pg16@sha256:289d55704b1b3ee8263cd3805c6930f9cd54506835a8f19f9b85dad17d5c5a8a';
  const migrations = spawnSync('git', ['archive', '--format=tar', receipt.sourceSha, 'scripts/migrate.sh', 'packages/db/migrations'], { cwd: root, windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  assert.equal(migrations.status, 0);
  for (let repetition = 1; repetition <= 2; repetition++) {
    console.log(`Runtime fixture ${repetition}/2`);
    const db = `${prefix}-${repetition}-db`, runner = `${prefix}-${repetition}-runner`;
    const media = `${prefix}-${repetition}-media`, models = `${prefix}-${repetition}-models`;
    for (const volume of [media, models]) {
      docker(['volume', 'create', ...labels, volume]); owned.volumes.add(volume);
    }
    const password = secret(), appPassword = secret(), token = secret(), relaySecret = secret(), hookToken = secret(), authSecret = secret();
    const egressToken = secret(), egressDek = secret();
    const egressKekFile = join(directory, `egress-kek-${repetition}.secret`);
    writeFileSync(egressKekFile, `${egressDek}\n`, { flag: 'wx', mode: 0o400 });
    secretFiles.add(egressKekFile);
    receipt.secretDelivery.filesCreated++;
    assert.equal(run('git', ['check-ignore', '--quiet', `var/l5-runtime/${id}/egress-kek-${repetition}.secret`]).status, 0,
      'Generated key file must remain outside tracked source');
    const providerAccessToken = secret(), providerRefreshToken = secret();
    const providerAccessTokenEnv = ['AXIOM_L5_PROVIDER_ACCESS', 'TOKEN'].join('_');
    const providerRefreshTokenEnv = ['AXIOM_L5_PROVIDER_REFRESH', 'TOKEN'].join('_');
    create(db, receipt.images.database, 'none', { POSTGRES_USER: 'axiom', POSTGRES_PASSWORD: password, POSTGRES_DB: 'axiom_test' });
    let databaseReady = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (docker(['exec', db, 'pg_isready', '-h', '127.0.0.1', '-U', 'axiom', '-d', 'axiom_test'], { allowFailure: true }).status === 0) { databaseReady = true; break; }
      await delay(1000);
    }
    assert.ok(databaseReady, 'Owned database readiness required');
    docker(['exec', db, 'mkdir', '-p', '/fixture']);
    docker(['exec', '-i', db, 'tar', '-xf', '-', '-C', '/fixture'], { input: migrations.stdout });
    docker(['exec', '--env', 'MIGRATOR_DATABASE_URL=postgresql://axiom@/axiom_test', db, 'sh', '/fixture/scripts/migrate.sh']);
    sql(db, `ALTER ROLE axiom_app WITH LOGIN PASSWORD '${appPassword}';`);
    create(runner, receipt.images.hono, `container:${db}`, {
      NODE_ENV: 'production', AXIOM_L5_FIXTURE: id,
      DATABASE_URL: `postgresql://axiom_app:${appPassword}@127.0.0.1:5432/axiom_test`,
      L5_OWNER_DATABASE_URL: `postgresql://axiom:${password}@127.0.0.1:5432/axiom_test`,
      BETTER_AUTH_SECRET: authSecret, BETTER_AUTH_URL: 'https://l5-fixture.invalid',
      AXIOM_VISION_AUTH_TOKEN: token, MEDIA_PLANE_AUTH_TOKEN: token,
      RELAY_SECRET: relaySecret, AXIOM_L5_DISCORD_WEBHOOK_TOKEN: hookToken,
      EGRESS_PLANE_URL: 'http://127.0.0.1:9090', EGRESS_PLANE_TOKEN: egressToken,
      EGRESS_KEK_ID: 'egress-dek',
      [providerAccessTokenEnv]: providerAccessToken,
      [providerRefreshTokenEnv]: providerRefreshToken,
      AXIOM_ASSET_DELIVERY_BASE_URL: 'https://media.example.invalid/assets/',
      VISION_ENGINE_URL: 'http://127.0.0.1:8101', MEDIA_PLANE_URL: 'http://127.0.0.1:8100',
    }, ['--cap-drop=ALL', '--cap-add=CHOWN', '--security-opt=no-new-privileges',
      '--mount', `type=volume,source=${media},target=/app/var/media`, '--mount', `type=volume,source=${models},target=/models`],
      ['node', '-e', 'setInterval(()=>{},1000)']);
    const egress = `${prefix}-${repetition}-egress`;
    // Production provisioner lifecycle is exercised by the separate isolated
    // Linux socket rehearsal; this unprivileged worker/model fixture verifies
    // the database-backed control-plane health endpoint only.
    const egressInfo = create(egress, receipt.images.egress, `container:${db}`, {
      NODE_ENV: 'test', LISTEN_ADDR: '0.0.0.0:9090',
      EGRESS_DATABASE_URL: `postgresql://axiom_app:${appPassword}@127.0.0.1:5432/axiom_test`,
      EGRESS_PLANE_TOKEN: egressToken, EGRESS_KEK_FILE: '/run/secrets/egress-kek',
      EGRESS_LEGACY_DEK_ID: 'l5-fixture-dek',
    }, ['--cap-drop=ALL', '--security-opt=no-new-privileges', '--mount',
      `type=bind,source=${egressKekFile},target=/run/secrets/egress-kek,readonly`], [], ['/run/secrets/egress-kek']);
    const egressEnv = JSON.parse(docker(['inspect', '--format', '{{json .Config.Env}}', egress]).stdout);
    assert.ok(egressEnv.includes('EGRESS_KEK_FILE=/run/secrets/egress-kek'));
    assert.equal(egressEnv.some(value => /^(?:EGRESS_KEK|EGRESS_DEK)=/.test(value)), false,
      'Root key value must not be present in container environment');
    assert.equal(egressEnv.some(value => value.includes(egressDek)), false,
      'Root key value must not be present in container environment');
    const keyMount = egressInfo.mounts.find(mount => mount.Destination === '/run/secrets/egress-kek');
    assert.ok(keyMount, 'Root key file must be mounted at the documented secret path');
    assert.equal(keyMount.Type, 'bind');
    assert.equal(keyMount.RW, false, 'Root key file mount must be read-only');
    docker(['exec', '--user', '0', runner, 'chown', '1001:1001', '/app/var/media', '/models']);
    docker(['cp', model, `${runner}:/models/nsfw-vit.onnx`]);
    assert.equal(docker(['exec', runner, 'node', '-e', "console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync('/models/nsfw-vit.onnx')).digest('hex'))"]).stdout,
      receipt.modelSha256, 'Verify the copied artifact after the build');
    docker(['exec', runner, 'ffmpeg', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64', '-frames:v', '1', '-threads', '1', '/app/var/media/fixture.png']);
    docker(['exec', runner, 'ffmpeg', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=4:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '/app/var/media/source.mp4']);
    create(`${prefix}-${repetition}-media-service`, receipt.images.media, `container:${db}`, { AXIOM_MEDIA_AUTH_TOKEN: token },
      ['--cap-drop=ALL', '--security-opt=no-new-privileges', '--mount', `type=volume,source=${media},target=/app/var/media`]);
    for (const [mode, port] of [['normal', 8101], ['missing', 8102], ['override', 8103]]) {
      create(`${prefix}-${repetition}-vision-${mode}`, receipt.images.vision, `container:${db}`, {
        AXIOM_VISION_AUTH_TOKEN: token, AXIOM_VISION_ADDR: `0.0.0.0:${port}`,
        ...(mode === 'missing' ? { AXIOM_VISION_MODEL: '/absent/model.onnx' } : {}),
        ...(mode === 'override' ? { AXIOM_VISION_OVERRIDE: 'pass' } : {}),
      }, ['--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
        '--mount', `type=volume,source=${media},target=/app/var/media,readonly`,
        '--mount', `type=volume,source=${models},target=/opt/axiom/models,readonly`]);
      await ready(runner, port, mode === 'missing' ? 503 : 200);
    }
    await ready(runner, 8100);
    await ready(runner, 9090);
    const source = run('git', ['show', `${receipt.sourceSha}:scripts/l5/runtime.mjs`]).stdout;
    docker(['exec', '-i', runner, 'node', '-e', "let s='';process.stdin.on('data',b=>s+=b);process.stdin.on('end',()=>require('fs').writeFileSync('/app/fixture.mjs',s))"], { input: source });
    const availabilityArgs = repetition === 1 ? ['--env', 'AXIOM_L5_AVAILABILITY=enabled'] : [];
    const result = docker(['exec', ...availabilityArgs, runner, 'node', '/app/fixture.mjs'], { allowFailure: true, timeout: 600000 });
    const report = JSON.parse(scrub(result.stdout.split(/\r?\n/).find(line => line.startsWith('{"l5Runtime":')) ?? 'null'));
    assert.ok(report && report.total === report.passed + report.failed + report.skipped, 'Complete runtime counts required');
    const expectedCases = repetition === 1 ? 58 : 57;
    assert.equal(report.total, expectedCases, `Runtime fixture ${repetition} must execute ${expectedCases} cases`);
    assert.equal(report.node, receipt.node, 'Runtime container must match the pinned Node release');
    receipt.runs.push({ repetition, ...report });
    receipt.passed += report.passed; receipt.failed += report.failed; receipt.skipped += report.skipped;
    if (repetition === 1 && report.availability) receipt.availability = report.availability;
    if (report.failed > 0) {
      const failures = report.tests.filter(test => !test.passed).map(({ name, error }) => ({ name, error }));
      throw new Error(`Runtime fixture ${repetition} failed cases: ${JSON.stringify(failures)}`);
    }
    if (result.status !== 0) throw new Error('Runtime process failed outside its test report');
    if (repetition === 1) {
      const availability = report.availability;
      assert.ok(availability, 'The source-bound availability canary receipt is required');
      assert.ok(Array.isArray(availability.scaleRuns), 'The availability scale matrix is required');
      const expectedScales = [
        { models: 1, targetsPerModel: 20, denominator: 20 },
        { models: 5, targetsPerModel: 20, denominator: 100 },
        { models: 10, targetsPerModel: 20, denominator: 200 },
        { models: 20, targetsPerModel: 20, denominator: 400 },
      ];
      const actualScales = availability.scaleRuns.map(({ models, targetsPerModel, denominator }) =>
        ({ models, targetsPerModel, denominator }));
      assert.deepEqual(actualScales, expectedScales, 'The availability matrix must cover every agreed model scale');
      assert.equal(availability.totalMeasuredTargets, 720);
      assert.equal(availability.queueBurst.allApprovedTargetsQueuedBeforeDispatch, true);
      assert.equal(availability.queueBurst.approvalApiBurstExercised, true);
      assert.equal(availability.queueBurst.generationApiBurstExercised, true);
      assert.equal(availability.generationBatchesMeasured, true);
      assert.equal(availability.localFixtureStorageCleaned, true);
      for (const scale of availability.scaleRuns) {
        const expectedGenerationRequests = scale.models * 4;
        assert.equal(scale.generationBatchesPerModel, 4);
        assert.equal(scale.generation.requestCount, expectedGenerationRequests);
        assert.equal(scale.generation.generatedBundles, expectedGenerationRequests);
        assert.equal(scale.generation.promptVariants, expectedGenerationRequests * 5);
        assert.equal(scale.generation.concurrentRequestsSubmitted, expectedGenerationRequests);
        assert.equal(scale.generation.llmEnrichmentRequested, false);
        assert.equal(scale.mediaBundles.requests, scale.models);
        assert.equal(scale.mediaBundles.bundlesCreated, scale.models);
        assert.equal(scale.mediaBundles.concurrentRequestsSubmitted, scale.models);
        assert.equal(scale.tosScan.promptBundlesScanned, expectedGenerationRequests);
        assert.equal(scale.tosScan.mediaBundlesScanned, scale.models);
        assert.equal(scale.tosScan.completedJobs, expectedGenerationRequests + scale.models);
        assert.equal(scale.tosScan.verdict, 'pass');
        assert.equal(scale.approvalAndSchedule.approvedBundles, scale.models);
        assert.equal(scale.approvalAndSchedule.approvalRequests, scale.models);
        assert.equal(scale.approvalAndSchedule.concurrentApprovalRequestsSubmitted, scale.models);
        assert.equal(scale.approvalAndSchedule.scheduleRequests, scale.models * 19);
        assert.equal(scale.approvalAndSchedule.scheduledTargets, scale.denominator);
        assert.equal(scale.approvalAndSchedule.scheduledTargetsPerModel, 20);
        assert.equal(scale.approvalAndSchedule.targetsPerApprovedBundle, 20);
        assert.equal(scale.approvalAndSchedule.isolatedClockAdvance.futureTargetsValidated, scale.denominator);
        assert.equal(scale.approvalAndSchedule.isolatedClockAdvance.targetsAdvanced, scale.denominator);
        assert.equal(scale.approvalAndSchedule.isolatedClockAdvance.publishJobsAdvanced, scale.denominator);
        assert.equal(scale.completedJobs, scale.denominator);
        assert.equal(scale.durablePublishedTargets, scale.denominator);
        assert.equal(scale.failedTargets, 0);
        assert.ok(Number.isFinite(scale.workloadWindow.durationMs) && scale.workloadWindow.durationMs > 0);
        assert.ok(Number.isFinite(scale.generation.requestLatencyMs.p95) && scale.generation.requestLatencyMs.p95 >= 0);
        assert.ok(Number.isFinite(scale.tosScan.workerLatencyMs.p95) && scale.tosScan.workerLatencyMs.p95 >= 0);
        assert.ok(Number.isFinite(scale.approvalAndSchedule.approvalLatencyMs.p95)
          && scale.approvalAndSchedule.approvalLatencyMs.p95 >= 0);
        assert.ok(Number.isFinite(scale.approvalAndSchedule.scheduleLatencyMs.p95)
          && scale.approvalAndSchedule.scheduleLatencyMs.p95 >= 0);
        assert.ok(Number.isFinite(scale.window.durationMs) && scale.window.durationMs > 0);
        assert.ok(Number.isFinite(scale.queueWaitFromBurstStartMs.p95) && scale.queueWaitFromBurstStartMs.p95 >= 0);
        assert.ok(Number.isFinite(scale.throughputTargetsPerSecond) && scale.throughputTargetsPerSecond > 0);
        assert.equal(scale.providerAvailability.requests, scale.denominator);
        assert.equal(scale.providerAvailability.successfulResponses, scale.denominator);
        assert.equal(scale.providerAvailability.failedResponses, 0);
        assert.equal(scale.providerAvailability.externalProviderMeasured, false);
        assert.ok(scale.availabilityPercent >= 99.5);
        assert.ok(scale.dispatchLatencyMs.p95 < 2_000);
      }
      assert.equal(availability.models, 20);
      assert.equal(availability.targetsPerModel, 20);
      assert.equal(availability.denominator, 400);
      assert.equal(availability.providerAvailability.requests, 400);
      assert.equal(availability.providerAvailability.successfulResponses, 400);
      assert.equal(availability.providerAvailability.failedResponses, 0);
      assert.equal(availability.durablePublishedTargets, 400);
      assert.equal(availability.failedTargets, 0);
      assert.equal(availability.providerAvailability.externalProviderMeasured, false);
      assert.ok(availability.availabilityPercent >= 99.5);
    } else {
      assert.equal(report.availability, null, 'The load canary runs once, avoiding a duplicate measurement');
    }
    const dump = docker(['exec', db, 'pg_dump', '-U', 'axiom', '-d', 'axiom_test', '--data-only', '--table=public.platform_connection', '--inserts']).stdout;
    assert.equal(dump.includes(providerAccessToken), false, 'Provider access token must not appear in the database dump');
    assert.equal(dump.includes(providerRefreshToken), false, 'Provider refresh token must not appear in the database dump');
    assert.equal(dump.includes(egressDek), false, 'Root key must not appear in the database dump');
    const egressLogs = docker(['logs', egress]).stdout;
    assert.equal(egressLogs.includes(providerAccessToken), false, 'Egress logs must not contain provider access tokens');
    assert.equal(egressLogs.includes(providerRefreshToken), false, 'Egress logs must not contain provider refresh tokens');
    assert.equal(egressLogs.includes(egressDek), false, 'Egress logs must not contain the root key');
    receipt.auditChecks.push({ repetition, databaseDumpPlaintextAbsent: true, egressLogPlaintextAbsent: true,
      rootKeyFileIgnoredByGit: true, rootKeyMountedAtDocumentedPath: true, rootKeyMountReadOnly: true,
      rootKeyAbsentFromContainerEnvironment: true });
    receipt.secretDelivery.rootKeyInEnvironment = false;
    receipt.secretDelivery.readOnlyMountVerified = true;
    receipt.passed += 5;
    for (const name of [...owned.containers].reverse()) remove('containers', name);
    for (const name of [...owned.volumes].reverse()) remove('volumes', name);
    unlinkSync(egressKekFile);
    secretFiles.delete(egressKekFile);
    assert.equal(existsSync(egressKekFile), false, 'Generated root key file must be removed after its fixture');
    receipt.secretDelivery.filesRemoved++;
    receipt.passed++;
  }
} catch (error) {
  receipt.failed++;
  receipt.error = scrub(error.message);
} finally {
  for (const kind of ['containers', 'volumes', 'images']) for (const name of [...owned[kind]].reverse()) {
    try { remove(kind, name); } catch { receipt.failed++; }
  }
  for (const file of [...secretFiles]) {
    try {
      if (!existsSync(file)) throw new Error('Generated root key file disappeared before cleanup');
      unlinkSync(file);
      receipt.secretDelivery.filesRemoved++;
      secretFiles.delete(file);
    }
    catch { receipt.failed++; }
  }
  receipt.secretDelivery.cleanupVerified = receipt.secretDelivery.filesCreated === 2
    && receipt.secretDelivery.filesRemoved === 2 && secretFiles.size === 0;
  if (!receipt.secretDelivery.cleanupVerified) receipt.failed++;
  try {
    receipt.cleanup = [['ps', '-aq'], ['volume', 'ls', '-q'], ['image', 'ls', '-q']].every(args =>
      docker([...args, '--filter', `label=${label}=${id}`]).stdout === '');
    if (!receipt.cleanup) receipt.failed++;
  } catch { receipt.failed++; }
  receipt.total = receipt.passed + receipt.failed + receipt.skipped;
  writeFileSync(join(directory, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt, null, 2));
  process.exitCode = receipt.failed > 0 || receipt.skipped > 0 || receipt.passed === 0 || !receipt.cleanup ? 1 : 0;
}
