import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

// This is deliberately a source-only, network-none fixture. It has no host
// mounts, Docker socket, published ports, provider credentials, or database.
if (process.argv[2] !== '--isolated-fixture') throw new Error('Use --isolated-fixture');
const root = resolve(import.meta.dirname, '..');
const id = randomUUID();
const name = `axiom-egress-worker-runtime-${id}`;
const image = `axiom-egress-worker-runtime:${id}`;
const context = mkdtempSync(join(tmpdir(), 'axiom-egress-worker-source-'));
const evidence = join(root, 'var', 'egress-worker-runtime-rehearsal', id);
mkdirSync(evidence, { recursive: true });

const run = (args, { capture = false, allowFailure = false } = {}) => {
  const result = spawnSync('docker', args, {
    encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit', maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) throw new Error(`docker ${args[0]} failed: ${result.status}`);
  return result;
};
const hashes = {};
const copy = relative => {
  const source = join(root, relative);
  const destination = join(context, relative);
  mkdirSync(resolve(destination, '..'), { recursive: true });
  cpSync(source, destination, { recursive: true });
};
const hashTree = (directory, prefix = '') => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Source context must not contain symlinks');
    const key = prefix + entry.name;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) hashTree(path, `${key}/`);
    else hashes[key] = createHash('sha256').update(readFileSync(path)).digest('hex');
  }
};

try {
  // The caller must compile these artifacts before invoking this fixture. The
  // relevant TypeScript sources travel alongside them so the receipt binds the
  // Docker execution to both the audited source and exact built output.
  copy('packages/core/package.json');
  copy('packages/core/src');
  copy('packages/core/dist');
  copy('packages/llm-gateway/src/egress.ts');
  copy('packages/llm-gateway/dist/egress.js');
  copy('node_modules/.pnpm/undici@8.10.0/node_modules/undici');
  const runtime = join(context, 'runtime-packages');
  mkdirSync(join(runtime, 'core'), { recursive: true });
  mkdirSync(join(runtime, 'llm-gateway'), { recursive: true });
  mkdirSync(runtime, { recursive: true });
  cpSync(join(root, 'packages', 'core', 'package.json'), join(runtime, 'core', 'package.json'));
  cpSync(join(root, 'packages', 'core', 'dist'), join(runtime, 'core', 'dist'), { recursive: true });
  cpSync(join(root, 'packages', 'llm-gateway', 'dist', 'egress.js'), join(runtime, 'llm-gateway', 'egress.js'));
  cpSync(join(root, 'node_modules', '.pnpm', 'undici@8.10.0', 'node_modules', 'undici'), join(runtime, 'undici'), { recursive: true });
  copy('infra/egress-worker-rehearsal');
  hashTree(context);
  writeFileSync(join(evidence, 'source-manifest.json'), JSON.stringify(hashes, null, 2) + '\n');

  run(['build', '--file', join(context, 'infra', 'egress-worker-rehearsal', 'Dockerfile'), '--tag', image, context]);
  // Namespace creation and deliberate UID/GID demotion require these
  // capabilities only in this fresh, network-none test container. Node probes
  // immediately drop every set and assert that outcome themselves.
  run(['create', '--name', name, '--label', `axiom.egress-worker-runtime=${id}`,
    '--network', 'none', '--cap-drop', 'ALL', '--cap-add', 'NET_ADMIN', '--cap-add', 'SYS_ADMIN', '--cap-add', 'SETPCAP', '--cap-add', 'SETUID', '--cap-add', 'SETGID',
    '--security-opt', 'no-new-privileges', '--security-opt', 'apparmor=unconfined',
    '--pids-limit', '128', '--memory', '1g', '--cpus', '1', '--tmpfs', '/run', image]);
  const inspect = JSON.parse(run(['inspect', name], { capture: true }).stdout)[0];
  const caps = inspect.HostConfig.CapAdd ?? [];
  const isolation = {
    label: inspect.Config.Labels['axiom.egress-worker-runtime'] === id,
    networkNone: inspect.HostConfig.NetworkMode === 'none',
    notPrivileged: !inspect.HostConfig.Privileged,
    noMounts: inspect.Mounts.length === 0,
    noPublishedPorts: Object.keys(inspect.HostConfig.PortBindings ?? {}).length === 0,
    capDropAll: inspect.HostConfig.CapDrop?.join(',') === 'ALL',
    requiredCaps: ['CAP_NET_ADMIN', 'CAP_SYS_ADMIN', 'CAP_SETPCAP', 'CAP_SETUID', 'CAP_SETGID'].every(cap => caps.includes(cap)),
  };
  if (!Object.values(isolation).every(Boolean)) {
    throw new Error(`worker runtime rehearsal isolation mismatch: ${JSON.stringify({ isolation, caps, capDrop: inspect.HostConfig.CapDrop, mounts: inspect.Mounts })}`);
  }
  const output = run(['start', '--attach', name], { capture: true, allowFailure: true });
  const testOutput = output.stdout + output.stderr;
  writeFileSync(join(evidence, 'test-output.txt'), testOutput);
  process.stdout.write(output.stdout);
  process.stderr.write(output.stderr);
  const exitCode = Number(run(['inspect', '--format', '{{.State.ExitCode}}', name], { capture: true }).stdout.trim());
  const requiredMarkers = [
    'EGRESS_RUNTIME_CANARY_READY', 'ASSERT_UNPRIVILEGED_CAPS PASS', 'ASSERT_UNSHARE_DENIED PASS',
    'ASSERT_HOST_NAMESPACE_REJECT PASS', 'ASSERT_HOST_LOOPBACK_UNREACHABLE PASS',
    'ASSERT_NAMESPACE_MATCH PASS', 'ASSERT_MATCHING_RUNNER_FETCH PASS',
  ];
  const missingMarkers = requiredMarkers.filter(marker => !testOutput.includes(marker));
  writeFileSync(join(evidence, 'receipt.json'), JSON.stringify({
    id, imageId: inspect.Image, network: 'none', privileged: false, hostMounts: false,
    capabilities: caps, exitCode, hashes, requiredMarkers, missingMarkers,
    productionAcceptance: false,
    scope: 'Docker-only Node namespace caller-boundary rehearsal; no target systemd, provider, tunnel, DNS, proxy rotation, or host policy acceptance.',
  }, null, 2) + '\n');
  console.log(`Evidence: ${evidence}`);
  if (exitCode !== 0 || missingMarkers.length) throw new Error(`worker runtime rehearsal failed: exit=${exitCode}, missing=${missingMarkers.join(',')}`);
} finally {
  const found = run(['inspect', name], { capture: true, allowFailure: true });
  if (found.status === 0 && JSON.parse(found.stdout)[0]?.Config?.Labels?.['axiom.egress-worker-runtime'] === id) {
    run(['rm', '--force', name], { allowFailure: true });
  }
  if (context.startsWith(join(tmpdir(), 'axiom-egress-worker-source-'))) rmSync(context, { recursive: true, force: true });
}
