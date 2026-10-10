import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

// Copies source only. No .env, host mounts, Docker socket, credentials,
// published ports, live database or external network are available to tests.
if (process.argv[2] !== '--isolated-fixture') throw new Error('Use --isolated-fixture');
const root = resolve(import.meta.dirname, '..');
const id = randomUUID();
const name = `axiom-egress-rehearsal-${id}`;
const builder = `axiom-egress-builder-${id}`;
const image = `axiom-egress-rehearsal:${id}`;
const label = 'axiom.egress-rehearsal';
const evidence = join(root, 'var', 'egress-rehearsal', id);
const receiptPath = join(evidence, 'receipt.json');
const gitHead = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
const gitStatus = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
if (gitHead.status !== 0 || gitStatus.status !== 0) throw new Error('could not record source revision and worktree state');
const gitSha = gitHead.stdout.trim();
if (!/^[0-9a-f]{40}$/.test(gitSha)) throw new Error('source revision is not a full Git commit SHA');
mkdirSync(evidence, { recursive: true });
const context = mkdtempSync(join(tmpdir(), 'axiom-egress-source-'));
const run = (args, { capture = false, allowFailure = false } = {}) => {
  const r = spawnSync('docker', args, { encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit', maxBuffer: 32 * 1024 * 1024 });
  if (r.error) throw r.error;
  if (r.status !== 0 && !allowFailure) throw new Error(`docker ${args[0]} failed: ${r.status}`);
  return r;
};
const hashes = {};
const requiredTests = [
  'test_socks5_proxy_mode_full_chain', 'test_wireguard_tunnel_mode_full_chain',
  'test_failover_to_approved_alternate_egress', 'test_fail_closed_with_https_echo_and_dead_upstream',
  'https_proxy_requires_verified_tls_without_plaintext_fallback',
  'http_connect_refusal_cannot_masquerade_as_success',
  'socks_auth_failure_cannot_acknowledge_target_connection',
  'dead_direct_target_never_receives_a_successful_socks_ack',
  'test_drain_during_probe_cannot_resurrect_binding',
  'test_org_kill_switch_drains_only_target_and_requires_explicit_release',
  'test_continuous_monitor_detects_failure_without_operator_probe',
  'test_route_loss_fails_closed_without_host_fallback',
  'test_net_admin_alone_cannot_provision_namespaces',
  'signed_lifecycle_creates_inspects_and_releases_a_closed_namespace',
  'signed_unix_socket_lifecycle_creates_inspects_and_releases_namespace',
  'signed_socket_bind_starts_non_root_sidecar_and_releases_exact_resources',
  'sidecar_watchdog_drops_egress_after_the_model_listener_exits',
];
const receipt = {
  id, command: 'rtk node scripts/rehearse-egress.mjs --isolated-fixture', gitSha,
  workingTreeDirty: Boolean(gitStatus.stdout.trim()), nodeVersion: process.version,
  builder, builderCreated: false, imageId: null, sourceManifestSha256: null, logSha256: null, summary: null,
  network: 'none', privileged: false, hostMounts: false,
  capabilities: [], exitCode: null, hashes, requiredTests, missingTests: [],
  productionAcceptance: false, status: 'running',
  cleanup: { builderRemoved: true, builderVerified: true, containerRemoved: false, imageRemoved: false, sourceContextRemoved: false, verified: false },
};
let builderMayExist = false;
const removeBuilder = () => {
  if (!builderMayExist) return;
  receipt.cleanup.builderRemoved = false;
  receipt.cleanup.builderVerified = false;
  const found = run(['buildx', 'inspect', builder], { capture: true, allowFailure: true });
  if (found.status === 0) {
    const inspectedName = found.stdout.match(/^Name:\s*(.+)$/m)?.[1]?.trim();
    if (inspectedName !== builder) {
      throw new Error('refusing to remove a BuildKit builder without the exact run name');
    }
    run(['buildx', 'rm', '--force', builder]);
  }
  const remaining = run(['buildx', 'ls'], { capture: true }).stdout;
  if (remaining.split(/\r?\n/).some(line => line.trim().startsWith(`${builder} `))) {
    throw new Error('run-specific BuildKit builder remains');
  }
  receipt.cleanup.builderRemoved = true;
  receipt.cleanup.builderVerified = true;
  builderMayExist = false;
};
try {
  for (const file of ['Cargo.toml', 'Cargo.lock']) {
    cpSync(join(root, file), join(context, file));
    hashes[file] = createHash('sha256').update(readFileSync(join(root, file))).digest('hex');
  }
  for (const crate of ['egress-plane', 'egress-provisioner', 'media-plane', 'vision-engine', 'scraper']) {
    const dest = join(context, 'crates', crate);
    mkdirSync(dest, { recursive: true });
    cpSync(join(root, 'crates', crate, 'Cargo.toml'), join(dest, 'Cargo.toml'));
    cpSync(join(root, 'crates', crate, 'src'), join(dest, 'src'), { recursive: true });
    if (crate === 'egress-provisioner') {
      cpSync(join(root, 'crates', crate, 'examples'), join(dest, 'examples'), { recursive: true });
    }
  }
  cpSync(join(root, 'crates', 'egress-plane', 'tests'), join(context, 'crates', 'egress-plane', 'tests'), { recursive: true });
  cpSync(join(root, 'crates', 'egress-provisioner', 'tests'), join(context, 'crates', 'egress-provisioner', 'tests'), { recursive: true });
  cpSync(join(root, 'infra', 'egress-rehearsal', 'Dockerfile'), join(context, 'Dockerfile'));
  const hashTree = (dir, prefix = '') => {
    for (const file of readdirSync(dir, { withFileTypes: true })) {
      if (file.isSymbolicLink()) throw new Error('Source context must not contain symlinks');
      const key = prefix + file.name;
      if (file.isDirectory()) hashTree(join(dir, file.name), key + '/');
      else hashes[key] = createHash('sha256').update(readFileSync(join(dir, file.name))).digest('hex');
    }
  };
  hashTree(context);
  hashes['scripts/rehearse-egress.mjs'] = createHash('sha256').update(readFileSync(join(root, 'scripts', 'rehearse-egress.mjs'))).digest('hex');
  const sourceManifest = JSON.stringify(hashes, null, 2) + '\n';
  receipt.sourceManifestSha256 = createHash('sha256').update(sourceManifest).digest('hex');
  writeFileSync(join(evidence, 'source-manifest.json'), sourceManifest);
  const builders = run(['buildx', 'ls'], { capture: true }).stdout;
  if (builders.split(/\r?\n/).some(line => line.trim().startsWith(`${builder} `))) {
    throw new Error('refusing to reuse an existing BuildKit builder name');
  }
  // BuildKit keeps a cache volume. Use a run-unique builder and remove it as
  // soon as the image is loaded, so this rehearsal never prunes shared cache.
  builderMayExist = true;
  run(['buildx', 'create', '--name', builder, '--driver', 'docker-container']);
  receipt.builderCreated = true;
  const build = ['buildx', 'build', '--builder', builder, '--file', join(context, 'Dockerfile'), '--tag', image, '--label', `${label}=${id}`, '--load'];
  if (process.env.EGRESS_TEST_BASE) build.push('--build-arg', `EGRESS_TEST_BASE=${process.env.EGRESS_TEST_BASE}`);
  run([...build, context]);
  removeBuilder();
  const builtImage = JSON.parse(run(['image', 'inspect', image], { capture: true }).stdout)[0];
  if (builtImage.Config.Labels?.[label] !== id) throw new Error('rehearsal image ownership mismatch');
  receipt.imageId = builtImage.Id;
  // SYS_ADMIN is needed by ip netns add/exec (mount + setns). It is granted
  // KILL is needed only to simulate a non-root sidecar crash in the watchdog test.
  // These capabilities exist ONLY inside this disposable container.
  run(['create', '--name', name, '--label', `${label}=${id}`,
    '--network', 'none', '--cap-drop', 'ALL', '--cap-add', 'NET_ADMIN', '--cap-add', 'SYS_ADMIN', '--cap-add', 'SETPCAP',
    '--cap-add', 'SETUID', '--cap-add', 'SETGID', '--cap-add', 'KILL',
    '--security-opt', 'no-new-privileges', '--security-opt', 'apparmor=unconfined',
    '--pids-limit', '256', '--memory', '3g', '--cpus', '2', '--tmpfs', '/run', image]);
  const inspect = JSON.parse(run(['inspect', name], { capture: true }).stdout)[0];
  if (inspect.Config.Labels[label] !== id || inspect.Image !== receipt.imageId || inspect.HostConfig.NetworkMode !== 'none'
    || inspect.HostConfig.Privileged || inspect.Mounts.some(m => m.Type === 'bind')
    || Object.keys(inspect.HostConfig.PortBindings ?? {}).length) throw new Error('rehearsal isolation mismatch');
  const output = run(['start', '--attach', name], { capture: true, allowFailure: true });
  const rawLog = output.stdout + output.stderr;
  writeFileSync(join(evidence, 'test-output.txt'), rawLog);
  receipt.logSha256 = createHash('sha256').update(rawLog).digest('hex');
  process.stdout.write(output.stdout);
  process.stderr.write(output.stderr);
  const exitCode = Number(run(['inspect', '--format', '{{.State.ExitCode}}', name], { capture: true }).stdout.trim());
  const testOutput = output.stdout + output.stderr;
  // Rust prints unit tests using their module-qualified name (for example
  // `tests::signed_lifecycle...`) but integration tests are unqualified.  The
  // receipt must accept either spelling while still requiring a successful
  // result for the exact final test identifier.
  const missingTests = requiredTests.filter(test => !new RegExp(`^test (?:[A-Za-z0-9_:]+::)*${test} \\.{3} ok$`, 'm').test(testOutput));
  const suites = [...testOutput.matchAll(/test result: (ok|FAILED)\. (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out(?=;|\s|$)/g)];
  const summary = suites.reduce((total, suite) => ({
    passed: total.passed + Number(suite[2]),
    failed: total.failed + Number(suite[3]),
    ignored: total.ignored + Number(suite[4]),
    measured: total.measured + Number(suite[5]),
    filteredOut: total.filteredOut + Number(suite[6]),
  }), { passed: 0, failed: 0, ignored: 0, measured: 0, filteredOut: 0 });
  summary.suiteCount = suites.length;
  summary.skipped = summary.ignored + summary.measured + summary.filteredOut;
  summary.assertionsPassed = requiredTests.length - missingTests.length;
  summary.assertionsFailed = missingTests.length;
  Object.assign(receipt, {
    capabilities: inspect.HostConfig.CapAdd, exitCode, hashes, missingTests, summary,
    status: exitCode === 0 && missingTests.length === 0 && summary.suiteCount > 0
      && summary.failed === 0 && summary.skipped === 0 ? 'passed' : 'failed',
  });
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
  console.log(`Evidence: ${evidence}`);
  if (receipt.status !== 'passed') throw new Error(`egress rehearsal failed: exit=${exitCode}, summary=${JSON.stringify(summary)}, missing=${missingTests.join(',')}`);
} catch (error) {
  receipt.status = 'failed';
  receipt.error = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  const cleanupErrors = [];
  try {
    removeBuilder();
  } catch (error) {
    cleanupErrors.push(`BuildKit cleanup: ${error instanceof Error ? error.message : String(error)}`);
  }
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
    if (!context.startsWith(join(tmpdir(), 'axiom-egress-source-'))) throw new Error('temporary source context ownership mismatch');
    rmSync(context, { recursive: true, force: true });
    if (existsSync(context)) throw new Error('temporary source context remains');
    receipt.cleanup.sourceContextRemoved = true;
  } catch (error) {
    cleanupErrors.push(`source context cleanup: ${error instanceof Error ? error.message : String(error)}`);
  }
  receipt.cleanup.verified = receipt.cleanup.builderRemoved && receipt.cleanup.builderVerified
    && receipt.cleanup.containerRemoved
    && receipt.cleanup.imageRemoved && receipt.cleanup.sourceContextRemoved;
  receipt.cleanupVerified = receipt.cleanup.verified;
  if (cleanupErrors.length) {
    receipt.status = 'failed';
    receipt.cleanupErrors = cleanupErrors;
    console.error(`Rehearsal cleanup failed: ${cleanupErrors.join('; ')}`);
    process.exitCode = 1;
  }
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
  console.log(`Cleanup: ${JSON.stringify(receipt.cleanup)}`);
}
