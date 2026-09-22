import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

// Copies source only. No .env, host mounts, Docker socket, credentials,
// published ports, live database or external network are available to tests.
if (process.argv[2] !== '--isolated-fixture') throw new Error('Use --isolated-fixture');
const root = resolve(import.meta.dirname, '..');
const id = randomUUID();
const name = `axiom-egress-rehearsal-${id}`;
const image = `axiom-egress-rehearsal:${id}`;
const context = mkdtempSync(join(tmpdir(), 'axiom-egress-source-'));
const evidence = join(root, 'var', 'egress-rehearsal', id);
mkdirSync(evidence, { recursive: true });
const run = (args, { capture = false, allowFailure = false } = {}) => {
  const r = spawnSync('docker', args, { encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit', maxBuffer: 32 * 1024 * 1024 });
  if (r.error) throw r.error;
  if (r.status !== 0 && !allowFailure) throw new Error(`docker ${args[0]} failed: ${r.status}`);
  return r;
};
const hashes = {};
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
  writeFileSync(join(evidence, 'source-manifest.json'), JSON.stringify(hashes, null, 2) + '\n');
  const build = ['build', '--file', join(context, 'Dockerfile'), '--tag', image];
  if (process.env.EGRESS_TEST_BASE) build.push('--build-arg', `EGRESS_TEST_BASE=${process.env.EGRESS_TEST_BASE}`);
  run([...build, context]);
  // SYS_ADMIN is needed by ip netns add/exec (mount + setns). It is granted
  // ONLY inside this disposable container, never to a host-network service.
  run(['create', '--name', name, '--label', `axiom.egress-rehearsal=${id}`,
    '--network', 'none', '--cap-drop', 'ALL', '--cap-add', 'NET_ADMIN', '--cap-add', 'SYS_ADMIN', '--cap-add', 'SETPCAP',
    '--security-opt', 'no-new-privileges', '--security-opt', 'apparmor=unconfined',
    '--pids-limit', '256', '--memory', '3g', '--cpus', '2', '--tmpfs', '/run', image]);
  const inspect = JSON.parse(run(['inspect', name], { capture: true }).stdout)[0];
  if (inspect.Config.Labels['axiom.egress-rehearsal'] !== id || inspect.HostConfig.NetworkMode !== 'none'
    || inspect.HostConfig.Privileged || inspect.Mounts.some(m => m.Type === 'bind')
    || Object.keys(inspect.HostConfig.PortBindings ?? {}).length) throw new Error('rehearsal isolation mismatch');
  const output = run(['start', '--attach', name], { capture: true, allowFailure: true });
  writeFileSync(join(evidence, 'test-output.txt'), output.stdout + output.stderr);
  process.stdout.write(output.stdout);
  process.stderr.write(output.stderr);
  const exitCode = Number(run(['inspect', '--format', '{{.State.ExitCode}}', name], { capture: true }).stdout.trim());
  const requiredTests = [
    'test_socks5_proxy_mode_full_chain', 'test_wireguard_tunnel_mode_full_chain',
    'test_failover_to_approved_alternate_egress', 'test_fail_closed_with_https_echo_and_dead_upstream',
    'https_proxy_requires_verified_tls_without_plaintext_fallback',
    'http_connect_refusal_cannot_masquerade_as_success',
    'socks_auth_failure_cannot_acknowledge_target_connection',
    'dead_direct_target_never_receives_a_successful_socks_ack',
    'test_drain_during_probe_cannot_resurrect_binding',
    'test_continuous_monitor_detects_failure_without_operator_probe',
    'test_net_admin_alone_cannot_provision_namespaces',
    'signed_lifecycle_creates_inspects_and_releases_a_closed_namespace',
    'signed_unix_socket_lifecycle_creates_inspects_and_releases_namespace',
  ];
  const testOutput = output.stdout + output.stderr;
  // Rust prints unit tests using their module-qualified name (for example
  // `tests::signed_lifecycle...`) but integration tests are unqualified.  The
  // receipt must accept either spelling while still requiring a successful
  // result for the exact final test identifier.
  const missingTests = requiredTests.filter(test => !new RegExp(`^test (?:[A-Za-z0-9_:]+::)*${test} \\.{3} ok$`, 'm').test(testOutput));
  writeFileSync(join(evidence, 'receipt.json'), JSON.stringify({
    id, imageId: inspect.Image, network: 'none', privileged: false, hostMounts: false,
    capabilities: inspect.HostConfig.CapAdd, exitCode, hashes, requiredTests, missingTests,
    productionAcceptance: false,
  }, null, 2) + '\n');
  console.log(`Evidence: ${evidence}`);
  if (exitCode !== 0 || missingTests.length) throw new Error(`egress rehearsal failed: exit=${exitCode}, missing=${missingTests.join(',')}`);
} finally {
  const found = run(['inspect', name], { capture: true, allowFailure: true });
  if (found.status === 0 && JSON.parse(found.stdout)[0]?.Config?.Labels?.['axiom.egress-rehearsal'] === id) {
    run(['rm', '--force', name], { allowFailure: true });
  }
  // Only this newly-created temporary source context is removed.
  if (context.startsWith(join(tmpdir(), 'axiom-egress-source-'))) rmSync(context, { recursive: true, force: true });
}
