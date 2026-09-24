import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const unit = (name) =>
  readFileSync(resolve(root, 'infra', 'egress-runtime', name), 'utf8').replace(/\r\n/g, '\n');
const requireLine = (source, line, label) =>
  assert.ok(source.split('\n').includes(line), `${label}: expected '${line}'`);
const reject = (source, pattern, label) =>
  assert.doesNotMatch(source, pattern, `${label}: forbidden privilege widening`);

const socket = unit('axiom-egress-provisioner.socket');
requireLine(socket, 'ListenStream=/run/axiom/egress/provisioner.sock', 'provisioner socket');
requireLine(socket, 'SocketGroup=axiom-egress-control', 'provisioner socket');
requireLine(socket, 'SocketMode=0660', 'provisioner socket');
reject(socket, /^ListenStream=(?:0\.0\.0\.0|\[::\]|[^/])/m, 'provisioner socket');

const provisioner = unit('axiom-egress-provisioner.service');
requireLine(provisioner, 'User=root', 'provisioner');
requireLine(
  provisioner,
  'CapabilityBoundingSet=CAP_NET_ADMIN CAP_SYS_ADMIN CAP_SETPCAP',
  'provisioner',
);
requireLine(
  provisioner,
  'AmbientCapabilities=CAP_NET_ADMIN CAP_SYS_ADMIN CAP_SETPCAP',
  'provisioner',
);
requireLine(provisioner, 'ReadWritePaths=/run/axiom/egress /run/netns', 'provisioner');
requireLine(provisioner, 'RestrictAddressFamilies=AF_UNIX AF_NETLINK', 'provisioner');
reject(provisioner, /(?:--privileged|CapabilityBoundingSet=~|CAP_SYS_ADMIN\s+CAP_NET_RAW)/, 'provisioner');

const plane = unit('axiom-egress-plane.service');
requireLine(plane, 'User=axiom-egress', 'plane');
requireLine(plane, 'NoNewPrivileges=yes', 'plane');
requireLine(plane, 'CapabilityBoundingSet=', 'plane');
requireLine(plane, 'AmbientCapabilities=', 'plane');
requireLine(plane, 'Environment=EGRESS_PROVISIONER_SOCKET=/run/axiom/egress/provisioner.sock', 'plane');
reject(plane, /(?:CAP_NET_ADMIN|CAP_SYS_ADMIN|--privileged|User=root)/, 'plane');

const runner = unit('axiom-egress-runner@.service');
requireLine(runner, 'User=axiom-egress-runner', 'runner');
requireLine(runner, 'NetworkNamespacePath=/run/netns/egress_%i', 'runner');
requireLine(runner, 'ConditionPathExists=/run/netns/egress_%i', 'runner');
requireLine(runner, 'Environment=AXIOM_EGRESS_RUNNER=1', 'runner');
requireLine(runner, 'Environment=AXIOM_EGRESS_CONFINEMENT_REQUIRED=1', 'runner');
requireLine(runner, 'Environment=WORKER_EGRESS_MODEL_ID=%i', 'runner');
requireLine(runner, 'ExecStart=/usr/bin/node /srv/axiom/packages/worker/dist/runner.js', 'runner');
requireLine(runner, 'NoNewPrivileges=yes', 'runner');
requireLine(runner, 'CapabilityBoundingSet=', 'runner');
requireLine(runner, 'AmbientCapabilities=', 'runner');
reject(runner, /(?:CAP_NET_ADMIN|CAP_SYS_ADMIN|--privileged|User=root)/, 'runner');

console.log(JSON.stringify({
  status: 'ok',
  checked: ['local-uds', 'narrow-provisioner-capabilities', 'capability-free-plane', 'model-netns-runner'],
  deploymentAcceptance: false,
}));
