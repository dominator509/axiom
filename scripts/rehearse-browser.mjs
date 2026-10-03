import { spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// This entry point owns every target. It accepts no application/database URL,
// host mount, production credentials, or reusable fixture secrets.
if (process.argv.length !== 3 || process.argv[2] !== '--isolated-fixture') throw new Error('Use --isolated-fixture');
const root = resolve(import.meta.dirname, '..');
const id = randomUUID();
const prefix = `axiom-browser-${id}`;
const directory = join(root, 'var', 'browser-rehearsal', id);
mkdirSync(directory, { recursive: true });
const label = 'axiom.browser.run';
const labels = ['--label', `${label}=${id}`];
const receipt = { runId: id, sourceSha: '', commands: [], images: {}, journeys: [], cleanup: [], status: 'running' };
const secrets = [];
const secret = () => { const value = randomBytes(32).toString('hex'); secrets.push(value); return value; };
const scrub = text => secrets.reduce((output, value) => output.replaceAll(value, '[FIXTURE-REDACTED]'), String(text ?? ''));
const save = () => writeFileSync(join(directory, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
const execute = (name, args, options = {}) => {
  const result = spawnSync('docker', args, { cwd: root, env: { ...process.env, ...options.env }, input: options.input,
    encoding: 'utf8', timeout: options.timeout ?? 300000, maxBuffer: 64 * 1024 * 1024 });
  writeFileSync(join(directory, name + '.log'), scrub((result.stdout ?? '') + (result.stderr ?? '')));
  receipt.commands.push({ command: 'docker ' + args.join(' '), exitCode: result.status });
  save();
  if (result.status !== 0) throw new Error(`${name} failed (exit ${result.status}); see sanitized log`);
  return result.stdout.trim();
};
const owned = { containers: new Set(), networks: new Set(), volumes: new Set(), images: new Set() };
const remove = (kind, name) => {
  const format = kind === 'containers' ? '{{json .Config.Labels}}' : '{{json .Labels}}';
  const args = kind === 'containers' ? ['inspect', '--format', format, name]
    : [kind === 'images' ? 'image' : kind.slice(0, -1), 'inspect', '--format', format, name];
  if (kind === 'images') args[3] = '{{json .Config.Labels}}';
  const actual = JSON.parse(execute('cleanup-label-' + name.replaceAll(':', '-'), args));
  if (actual?.[label] !== id) throw new Error('Refusing cleanup: ownership label mismatch');
  execute('remove-' + name.replaceAll(':', '-'), kind === 'containers' ? ['rm', '--force', '--volumes', name]
    : [kind === 'images' ? 'image' : kind.slice(0, -1), 'rm', name]);
  owned[kind].delete(name);
  receipt.cleanup.push({ kind, name, removed: true });
};
const start = (name, image, network, env = {}, extra = []) => {
  // Track before creation so a started container cannot be forgotten by a later failure.
  execute('create-' + name, ['create', '--name', name, ...labels, '--network', network,
    ...extra, ...Object.keys(env).flatMap(key => ['--env', key]), image], { env });
  owned.containers.add(name);
  const info = JSON.parse(execute('isolation-' + name, ['inspect', name]))[0];
  if (info.HostConfig.Privileged || info.Mounts.some(mount => mount.Type === 'bind')
    || Object.keys(info.HostConfig.PortBindings ?? {}).length || info.Config.Labels[label] !== id)
    throw new Error('Fixture isolation mismatch');
  execute('start-' + name, ['start', name]);
};
try {
  const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  const status = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
  if (git.status !== 0 || status.status !== 0 || status.stdout.trim()) throw new Error('A clean committed source checkout is required');
  receipt.sourceSha = git.stdout.trim();
  if (!/^[a-f0-9]{40}$/.test(receipt.sourceSha)) throw new Error('Invalid source SHA');
  // All three builds consume the same immutable tracked source, even if the
  // working directory changes while a long-running dependency install runs.
  const archive = spawnSync('git', ['archive', '--format=tar', receipt.sourceSha],
    { cwd: root, maxBuffer: 128 * 1024 * 1024 });
  if (archive.status !== 0) throw new Error('Cannot archive the pinned source');
  receipt.sourceArchive = { command: `git archive --format=tar ${receipt.sourceSha}`,
    sha256: createHash('sha256').update(archive.stdout).digest('hex') };
  const endpoint = process.env.DOCKER_HOST || JSON.parse(execute('docker-context', ['context', 'inspect']))[0].Endpoints.docker.Host;
  if (!endpoint.startsWith('npipe://') && !endpoint.startsWith('unix://')) throw new Error('Only a local Docker engine is allowed');
  for (const [kind, file] of [['api', 'hono'], ['dashboard', 'next'], ['runner', 'browser']]) {
    const tag = `${prefix}:${kind}`;
    console.log(`Building disposable ${kind} image at ${receipt.sourceSha}`);
    const args = ['build', ...labels, '-f', `infra/Dockerfile.${file}`, '-t', tag];
    if (kind === 'dashboard') args.push('--build-arg', 'API_ORIGIN=http://127.0.0.1:3001');
    execute('build-' + kind, [...args, '-'], { input: archive.stdout, timeout: 1800000 });
    owned.images.add(tag);
    receipt.images[kind] = execute('image-' + kind, ['image', 'inspect', '--format', '{{.Id}}', tag]);
  }
  const dbImage = 'timescale/timescaledb:2.29.2-pg16@sha256:289d55704b1b3ee8263cd3805c6930f9cd54506835a8f19f9b85dad17d5c5a8a';
  execute('pull-db', ['pull', dbImage]);
  receipt.images.database = dbImage;
  for (let repetition = 1; repetition <= 2; repetition++) {
    console.log(`Browser fixture ${repetition}/2: fresh database, default and configured brand`);
    const fixture = `${prefix}-${repetition}`;
    const db = fixture + '-db';
    const runner = fixture + '-runner';
    const api = fixture + '-api';
    const dashboard = fixture + '-dashboard';
    const volume = fixture + '-database';
    const ownerPassword = secret();
    const appPassword = secret();
    const sentinel = secret();
    const ownerUrl = `postgresql://axiom:${ownerPassword}@127.0.0.1:5432/axiom_test`;
    const apiEnv = { NODE_ENV: 'production', API_HOST: '0.0.0.0',
      DATABASE_URL: `postgresql://axiom_app:${appPassword}@127.0.0.1:5432/axiom_test`,
      BETTER_AUTH_SECRET: secret(), BETTER_AUTH_URL: 'https://127.0.0.1:3443', RELAY_SECRET: secret(),
      BROWSER_SECRET_SENTINEL: sentinel };
    execute('network-' + repetition, ['network', 'create', '--internal', ...labels, fixture]);
    owned.networks.add(fixture);
    if (execute('internal-' + repetition, ['network', 'inspect', '--format', '{{.Internal}}', fixture]) !== 'true') throw new Error('Internal network required');
    execute('volume-' + repetition, ['volume', 'create', ...labels, volume]);
    owned.volumes.add(volume);
    start(db, dbImage, fixture, { POSTGRES_USER: 'axiom', POSTGRES_PASSWORD: ownerPassword, POSTGRES_DB: 'axiom_test' },
      ['--mount', `type=volume,source=${volume},target=/var/lib/postgresql/data`]);
    start(runner, receipt.images.runner, 'container:' + db, { CI: 'true', AXIOM_BROWSER_FIXTURE: 'owned-internal',
      MIGRATOR_DATABASE_URL: ownerUrl, BROWSER_SECRET_SENTINEL: sentinel }, ['--init', '--shm-size=1g']);
    execute('database-ready-' + repetition, ['exec', runner, 'sh', '-ec',
      'for i in $(seq 1 60); do pg_isready -h 127.0.0.1 -U axiom -d axiom_test && exit 0; sleep 1; done; exit 1']);
    execute('migrate-' + repetition, ['exec', runner, 'bash', 'scripts/migrate.sh']);
    execute('runtime-role-' + repetition, ['exec', '-i', runner, 'sh', '-c', 'psql -X -q -v ON_ERROR_STOP=1 -d "$MIGRATOR_DATABASE_URL"'],
      { input: `ALTER ROLE axiom_app WITH LOGIN PASSWORD '${appPassword}';\n` });
    start(api, receipt.images.api, 'container:' + db, apiEnv);
    start(dashboard, receipt.images.dashboard, 'container:' + db, { NODE_ENV: 'production', PORT: '3000', HOSTNAME: '0.0.0.0', BROWSER_SECRET_SENTINEL: sentinel });
    const wait = async () => {
      for (let attempt = 0; attempt < 60; attempt++) {
        const probe = spawnSync('docker', ['exec', runner, 'node', '-e',
          "Promise.all(['http://127.0.0.1:3001/api/v1/ready','http://127.0.0.1:3000/login'].map(async u=>{if(!(await fetch(u)).ok)throw Error()})).catch(()=>process.exit(1))"], { stdio: 'ignore', timeout: 15000 });
        if (probe.status === 0) return;
        await delay(1000);
      }
      throw new Error('API readiness/dashboard login timed out');
    };
    const journey = async mode => {
      // Independent scenarios reuse the real API, so respect its unchanged
      // authentication windows before creating the next pair of identities.
      await delay(21_000);
      console.log(`Browser fixture ${repetition}: ${mode}`);
      let output;
      try {
        output = execute(`journey-${repetition}-${mode}`, ['exec', runner, 'node', 'scripts/browser/journey.mjs', mode]);
      } catch (error) {
        const log = readFileSync(join(directory, `journey-${repetition}-${mode}.log`), 'utf8');
        const summary = log.split(/\r?\n/).find(line => line.startsWith('{"mode":'));
        receipt.journeys.push({ repetition, ...(summary ? JSON.parse(summary) : { mode, failed: 1, countsUnavailable: true }) });
        save();
        throw error;
      }
      const result = JSON.parse(output.split(/\r?\n/).at(-1));
      receipt.journeys.push({ repetition, ...result });
      console.log(JSON.stringify(result));
      save();
    };
    await wait();
    await journey('default');
    remove('containers', api);
    start(api, receipt.images.api, 'container:' + db, { ...apiEnv,
      AXIOM_BRAND_NAME: 'Fixture Studio <&> {email}', AXIOM_BRAND_TAGLINE: 'Private fixture creator workspace' });
    await wait();
    if (repetition === 1) { await journey('negative-brand'); await journey('negative-cookie'); }
    await journey('configured');
    for (const container of [dashboard, api, runner, db]) remove('containers', container);
    remove('volumes', volume);
    remove('networks', fixture);
  }
  receipt.status = 'passed';
} catch (error) {
  receipt.status = 'failed';
  receipt.error = scrub(error.message);
  console.error(receipt.error);
  process.exitCode = 1;
} finally {
  for (const kind of ['containers', 'volumes', 'networks', 'images']) {
    for (const name of [...owned[kind]].reverse()) {
      try { remove(kind, name); }
      catch { receipt.cleanup.push({ kind, name, removed: false }); receipt.status = 'failed'; process.exitCode = 1; }
    }
  }
  try {
    let empty = true;
    for (const [kind, args] of [['containers', ['ps', '-a']], ['volumes', ['volume', 'ls']], ['networks', ['network', 'ls']]]) {
      if (execute('remaining-' + kind, [...args, '--filter', `label=${label}=${id}`, '--format', kind === 'volumes' ? '{{.Name}}' : '{{.ID}}'])) empty = false;
    }
    receipt.cleanupVerified = empty;
    if (!empty) { receipt.status = 'failed'; process.exitCode = 1; }
  } catch { receipt.cleanupVerified = false; receipt.status = 'failed'; process.exitCode = 1; }
  save();
  console.log('Browser receipt: ' + join(directory, 'receipt.json'));
}
