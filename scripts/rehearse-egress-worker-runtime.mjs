import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

// This is deliberately a source-only, network-none fixture. It has no host
// mounts, Docker socket, published ports, provider credentials, or database.
if (process.argv[2] !== '--isolated-fixture') throw new Error('Use --isolated-fixture');
const root = resolve(import.meta.dirname, '..');
const testedSha = process.env.TESTED_SHA
  ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
if (!/^[a-f0-9]{40}$/i.test(testedSha)) throw new Error('TESTED_SHA must identify the exact 40-character tested commit');
const gatewayRequire = createRequire(join(root, 'packages', 'llm-gateway', 'package.json'));
const undiciRoot = dirname(gatewayRequire.resolve('undici'));
if (!undiciRoot.startsWith(`${root}${sep}`)) throw new Error('Resolved undici dependency escaped the workspace');
const undiciVersion = JSON.parse(readFileSync(join(undiciRoot, 'package.json'), 'utf8')).version;
const id = randomUUID();
const name = `axiom-egress-worker-runtime-${id}`;
const image = `axiom-egress-worker-runtime:${id}`;
const label = 'axiom.egress-worker-runtime';
const evidence = join(root, 'var', 'egress-worker-runtime-rehearsal', id);
const receiptPath = join(evidence, 'receipt.json');
mkdirSync(evidence, { recursive: true });
let context = null;

const run = (args, { capture = false, allowFailure = false } = {}) => {
  const result = spawnSync('docker', args, {
    encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit', maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) throw new Error(`docker ${args[0]} failed: ${result.status}`);
  return result;
};
const hashes = {};
const requiredMarkers = [
  'EGRESS_RUNTIME_CANARY_READY', 'ASSERT_UNPRIVILEGED_CAPS PASS', 'ASSERT_UNSHARE_DENIED PASS',
  'ASSERT_NO_DEFAULT_ROUTE PASS', 'ASSERT_HOST_NAMESPACE_REJECT PASS', 'ASSERT_HOST_LOOPBACK_UNREACHABLE PASS',
  'ASSERT_HOST_PROXY_UNREACHABLE PASS', 'ASSERT_NAMESPACE_MATCH PASS', 'ASSERT_MATCHING_RUNNER_FETCH PASS',
  'ASSERT_PROXY_ROUTE_VERIFIED PASS', 'ASSERT_PROXY_FAULT_INJECTED PASS',
  'ASSERT_PROXY_OUTAGE_FAIL_CLOSED PASS', 'ASSERT_NO_DIRECT_FALLBACK PASS',
];
const plannedChecks = 8 + requiredMarkers.length + 1;
const receipt = {
  id, testedSha, environment: { node: process.versions.node, platform: process.platform, arch: process.arch },
  dependencyVersions: { undici: undiciVersion },
  imageId: null, network: 'none', privileged: false, hostMounts: false,
  capabilities: [], exitCode: null, hashes, requiredMarkers, missingMarkers: [],
  assertionCount: plannedChecks,
  assertions: { isolation: null, markers: null, containerExitedZero: null },
  counts: { total: plannedChecks, passed: 0, failed: 0, skipped: plannedChecks },
  testOutputSha256: null,
  productionAcceptance: false,
  scope: 'Docker-only Node namespace caller-boundary rehearsal; verifies no default route or host namespace access, a real Undici ProxyAgent reaches the model canary through its assigned proxy, and stopping that proxy rejects the next request without direct fallback. No target systemd, provider, tunnel, DNS, proxy rotation, or host policy acceptance.',
  status: 'running',
  cleanup: { containerRemoved: false, imageRemoved: false, sourceContextRemoved: false, verified: false },
};
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
  context = mkdtempSync(join(tmpdir(), 'axiom-egress-worker-source-'));
  // The caller must compile these artifacts before invoking this fixture. The
  // relevant TypeScript sources travel alongside them so the receipt binds the
  // Docker execution to both the audited source and exact built output.
  copy('packages/core/package.json');
  copy('packages/core/src');
  copy('packages/core/dist');
  copy('packages/llm-gateway/src/egress.ts');
  copy('packages/llm-gateway/dist/egress.js');
  copy(relative(root, undiciRoot));
  const runtime = join(context, 'runtime-packages');
  mkdirSync(join(runtime, 'core'), { recursive: true });
  mkdirSync(join(runtime, 'llm-gateway'), { recursive: true });
  mkdirSync(runtime, { recursive: true });
  cpSync(join(root, 'packages', 'core', 'package.json'), join(runtime, 'core', 'package.json'));
  cpSync(join(root, 'packages', 'core', 'dist'), join(runtime, 'core', 'dist'), { recursive: true });
  cpSync(join(root, 'packages', 'llm-gateway', 'dist', 'egress.js'), join(runtime, 'llm-gateway', 'egress.js'));
  cpSync(undiciRoot, join(runtime, 'undici'), { recursive: true });
  copy('infra/egress-worker-rehearsal');
  hashTree(context);
  writeFileSync(join(evidence, 'source-manifest.json'), JSON.stringify(hashes, null, 2) + '\n');

  run(['build', '--file', join(context, 'infra', 'egress-worker-rehearsal', 'Dockerfile'), '--tag', image,
    '--label', `${label}=${id}`, context]);
  const builtImage = JSON.parse(run(['image', 'inspect', image], { capture: true }).stdout)[0];
  if (builtImage.Config.Labels?.[label] !== id) throw new Error('worker runtime image ownership mismatch');
  receipt.imageId = builtImage.Id;
  // Namespace creation and deliberate UID/GID demotion require these
  // capabilities only in this fresh, network-none test container. Node probes
  // immediately drop every set and assert that outcome themselves.
  run(['create', '--name', name, '--label', `${label}=${id}`,
    '--network', 'none', '--cap-drop', 'ALL', '--cap-add', 'NET_ADMIN', '--cap-add', 'SYS_ADMIN', '--cap-add', 'SETPCAP', '--cap-add', 'SETUID', '--cap-add', 'SETGID',
    '--security-opt', 'no-new-privileges', '--security-opt', 'apparmor=unconfined',
    '--pids-limit', '128', '--memory', '1g', '--cpus', '1', '--tmpfs', '/run', image]);
  const inspect = JSON.parse(run(['inspect', name], { capture: true }).stdout)[0];
  const caps = inspect.HostConfig.CapAdd ?? [];
  const normalizedCaps = new Set(caps.map(cap => String(cap).replace(/^CAP_/, '').toUpperCase()));
  const isolation = {
    label: inspect.Config.Labels[label] === id,
    imageMatches: inspect.Image === receipt.imageId,
    networkNone: inspect.HostConfig.NetworkMode === 'none',
    notPrivileged: !inspect.HostConfig.Privileged,
    noMounts: inspect.Mounts.length === 0,
    noPublishedPorts: Object.keys(inspect.HostConfig.PortBindings ?? {}).length === 0,
    capDropAll: inspect.HostConfig.CapDrop?.join(',') === 'ALL',
    requiredCaps: ['NET_ADMIN', 'SYS_ADMIN', 'SETPCAP', 'SETUID', 'SETGID'].every(cap => normalizedCaps.has(cap)),
  };
  receipt.assertions.isolation = isolation;
  if (!Object.values(isolation).every(Boolean)) {
    throw new Error(`worker runtime rehearsal isolation mismatch: ${JSON.stringify({ isolation, caps, capDrop: inspect.HostConfig.CapDrop, mounts: inspect.Mounts })}`);
  }
  const output = run(['start', '--attach', name], { capture: true, allowFailure: true });
  const testOutput = output.stdout + output.stderr;
  writeFileSync(join(evidence, 'test-output.txt'), testOutput);
  process.stdout.write(output.stdout);
  process.stderr.write(output.stderr);
  const exitCode = Number(run(['inspect', '--format', '{{.State.ExitCode}}', name], { capture: true }).stdout.trim());
  const missingMarkers = requiredMarkers.filter(marker => !testOutput.includes(marker));
  receipt.testOutputSha256 = createHash('sha256').update(testOutput).digest('hex');
  receipt.assertions.markers = Object.fromEntries(requiredMarkers.map(marker => [marker, !missingMarkers.includes(marker)]));
  receipt.assertions.containerExitedZero = exitCode === 0;
  Object.assign(receipt, {
    capabilities: caps, exitCode, hashes, missingMarkers,
    status: exitCode === 0 && missingMarkers.length === 0 ? 'passed' : 'failed',
  });
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
  console.log(`Evidence: ${evidence}`);
  if (exitCode !== 0 || missingMarkers.length) throw new Error(`worker runtime rehearsal failed: exit=${exitCode}, missing=${missingMarkers.join(',')}`);
} catch (error) {
  receipt.status = 'failed';
  receipt.error = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  const assertionResults = [
    ...(receipt.assertions.isolation ? Object.values(receipt.assertions.isolation) : []),
    ...(receipt.assertions.markers ? Object.values(receipt.assertions.markers) : []),
    ...(receipt.assertions.containerExitedZero === null ? [] : [receipt.assertions.containerExitedZero]),
  ];
  const passed = assertionResults.filter(Boolean).length;
  const failed = assertionResults.length - passed;
  receipt.counts = {
    total: plannedChecks,
    passed,
    failed,
    skipped: plannedChecks - assertionResults.length,
  };
  const cleanupErrors = [];
  try {
    const found = run(['ps', '--all', '--quiet', '--filter', `label=${label}=${id}`], { capture: true });
    for (const containerId of found.stdout.trim().split(/\s+/).filter(Boolean)) {
      const inspect = JSON.parse(run(['inspect', containerId], { capture: true }).stdout)[0];
      if (inspect.Config.Labels?.[label] !== id) throw new Error('refusing to remove a container without this run label');
      run(['rm', '--force', containerId]);
    }
    const remaining = run(['ps', '--all', '--quiet', '--filter', `label=${label}=${id}`], { capture: true });
    if (remaining.stdout.trim()) throw new Error('run-labeled containers remain');
    receipt.cleanup.containerRemoved = true;
  } catch (error) {
    cleanupErrors.push(`container cleanup: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    const found = run(['image', 'ls', '--quiet', '--filter', `label=${label}=${id}`], { capture: true });
    for (const imageId of found.stdout.trim().split(/\s+/).filter(Boolean)) {
      const inspect = JSON.parse(run(['image', 'inspect', imageId], { capture: true }).stdout)[0];
      if (inspect.Config.Labels?.[label] !== id || (receipt.imageId && inspect.Id !== receipt.imageId)) {
        throw new Error('refusing to remove an image not owned by this run');
      }
      run(['image', 'rm', inspect.Id]);
    }
    const remaining = run(['image', 'ls', '--quiet', '--filter', `label=${label}=${id}`], { capture: true });
    if (remaining.stdout.trim()) throw new Error('run-labeled images remain');
    receipt.cleanup.imageRemoved = true;
  } catch (error) {
    cleanupErrors.push(`image cleanup: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    if (context) {
      if (!context.startsWith(join(tmpdir(), 'axiom-egress-worker-source-'))) throw new Error('temporary source context ownership mismatch');
      rmSync(context, { recursive: true, force: true });
      if (existsSync(context)) throw new Error('temporary source context remains');
    }
    receipt.cleanup.sourceContextRemoved = true;
  } catch (error) {
    cleanupErrors.push(`source context cleanup: ${error instanceof Error ? error.message : String(error)}`);
  }
  receipt.cleanup.verified = receipt.cleanup.containerRemoved
    && receipt.cleanup.imageRemoved && receipt.cleanup.sourceContextRemoved;
  receipt.cleanupVerified = receipt.cleanup.verified;
  if (cleanupErrors.length) {
    receipt.status = 'failed';
    receipt.cleanupErrors = cleanupErrors;
    console.error(`Worker runtime cleanup failed: ${cleanupErrors.join('; ')}`);
    process.exitCode = 1;
  }
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
  console.log(`Cleanup: ${JSON.stringify(receipt.cleanup)}`);
}
