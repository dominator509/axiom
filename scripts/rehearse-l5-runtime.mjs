// Source-bound local acceptance. Every database, model volume and target is owned.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  images: {}, runs: [], auditChecks: [], passed: 0, failed: 0, skipped: 0, cleanup: false };
const secrets = [];
const secret = () => { const value = randomBytes(32).toString('hex'); secrets.push(value); return value; };
const scrub = text => secrets.reduce((value, key) => value.replaceAll(key, '[FIXTURE-REDACTED]'), String(text ?? ''));
let operation = 0;
const owned = { containers: new Set(), volumes: new Set(), images: new Set() };
function run(command, args, { input, env = {}, timeout = 180000, allowFailure = false } = {}) {
  const result = spawnSync(command, args, { cwd: root, input, windowsHide: true, timeout,
    env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 });
  writeFileSync(join(directory, `${++operation}.log`), scrub(Buffer.concat([result.stdout ?? Buffer.alloc(0), result.stderr ?? Buffer.alloc(0)]).toString()));
  if (result.status !== 0 && !allowFailure) throw new Error(`${command} operation ${operation} failed; inspect sanitized log`);
  return { status: result.status, stdout: (result.stdout ?? Buffer.alloc(0)).toString().trim() };
}
const docker = (args, options) => run('docker', args, options);
const sql = (db, statement) => docker(['exec', '-i', db, 'psql', '-X', '-qAt', '-U', 'axiom', '-d', 'axiom_test', '-v', 'ON_ERROR_STOP=1'], { input: statement });
function create(name, image, network, env, extra = [], command = []) {
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
  assert.equal(info.mounts.some(m => m.Type === 'bind'), false);
  assert.equal(Object.keys(info.ports ?? {}).length, 0);
  docker(['start', name]);
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
      EGRESS_DEK_ID: 'l5-fixture-dek',
      [providerAccessTokenEnv]: providerAccessToken,
      [providerRefreshTokenEnv]: providerRefreshToken,
      AXIOM_ASSET_DELIVERY_BASE_URL: 'https://media.example.invalid/assets/',
      VISION_ENGINE_URL: 'http://127.0.0.1:8101', MEDIA_PLANE_URL: 'http://127.0.0.1:8100',
    }, ['--cap-drop=ALL', '--cap-add=CHOWN', '--security-opt=no-new-privileges',
      '--mount', `type=volume,source=${media},target=/app/var/media`, '--mount', `type=volume,source=${models},target=/models`],
      ['node', '-e', 'setInterval(()=>{},1000)']);
    const egress = `${prefix}-${repetition}-egress`;
    create(egress, receipt.images.egress, `container:${db}`, {
      NODE_ENV: 'production', LISTEN_ADDR: '0.0.0.0:9090',
      EGRESS_DATABASE_URL: `postgresql://axiom_app:${appPassword}@127.0.0.1:5432/axiom_test`,
      EGRESS_PLANE_TOKEN: egressToken, EGRESS_DEK: egressDek,
    }, ['--cap-drop=ALL', '--security-opt=no-new-privileges']);
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
    const result = docker(['exec', runner, 'node', '/app/fixture.mjs'], { allowFailure: true, timeout: 600000 });
    const report = JSON.parse(scrub(result.stdout.split(/\r?\n/).find(line => line.startsWith('{"l5Runtime":')) ?? 'null'));
    assert.ok(report && report.total === report.passed + report.failed + report.skipped, 'Complete runtime counts required');
    assert.equal(report.total, 51, 'All fifty-one runtime cases must execute');
    receipt.runs.push({ repetition, ...report });
    receipt.passed += report.passed; receipt.failed += report.failed; receipt.skipped += report.skipped;
    if (result.status !== 0 && report.failed === 0) throw new Error('Runtime process failed outside its test report');
    const dump = docker(['exec', db, 'pg_dump', '-U', 'axiom', '-d', 'axiom_test', '--data-only', '--table=public.platform_connection', '--inserts']).stdout;
    assert.equal(dump.includes(providerAccessToken), false, 'Provider access token must not appear in the database dump');
    assert.equal(dump.includes(providerRefreshToken), false, 'Provider refresh token must not appear in the database dump');
    const egressLogs = docker(['logs', egress]).stdout;
    assert.equal(egressLogs.includes(providerAccessToken), false, 'Egress logs must not contain provider access tokens');
    assert.equal(egressLogs.includes(providerRefreshToken), false, 'Egress logs must not contain provider refresh tokens');
    receipt.auditChecks.push({ repetition, databaseDumpPlaintextAbsent: true, egressLogPlaintextAbsent: true });
    receipt.passed += 2;
    for (const name of [...owned.containers].reverse()) remove('containers', name);
    for (const name of [...owned.volumes].reverse()) remove('volumes', name);
  }
} catch (error) {
  receipt.failed++;
  receipt.error = scrub(error.message);
} finally {
  for (const kind of ['containers', 'volumes', 'images']) for (const name of [...owned[kind]].reverse()) {
    try { remove(kind, name); } catch { receipt.failed++; }
  }
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
