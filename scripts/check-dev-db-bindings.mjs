import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { devNull } from 'node:os';
import { fileURLToPath } from 'node:url';

// Render the real Compose contract without loading developer secrets or
// starting containers. Never print the rendered environment on failure.
const result = spawnSync('docker', [
  'compose', '--env-file', devNull, '-f', 'infra/docker-compose.yml',
  '--profile', 'tools', 'config', '--format', 'json', '--no-interpolate',
], { cwd: fileURLToPath(new URL('../', import.meta.url)), encoding: 'utf8', windowsHide: true });
assert.equal(result.status, 0, 'Docker Compose configuration rendering failed');
const config = JSON.parse(result.stdout);
for (const [name, published, target] of [['postgres', '5432', 5432], ['pgadmin', '5050', 80]]) {
  const service = config.services[name];
  assert.equal(service.ports.length, 1, `${name}: unexpected additional host bindings`);
  const port = service.ports[0];
  assert.equal(port.host_ip, '127.0.0.1', `${name}: development database access must stay on loopback`);
  assert.equal(String(port.published), published, `${name}: preserve the local client port`);
  assert.equal(port.target, target, `${name}: preserve the container port`);
  assert.equal(port.protocol, 'tcp', `${name}: preserve the database protocol`);
  assert.ok(Object.hasOwn(service.networks, 'axiom-net'), `${name}: preserve internal service access`);
}
console.log('development database bindings: loopback-only; local ports and internal network preserved');
