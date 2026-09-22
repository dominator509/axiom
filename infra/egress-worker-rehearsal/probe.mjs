import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { assertEgressFetchCaller, buildEgressFetch } from '/app/packages/llm-gateway/dist/egress.js';

const mode = process.argv[2];
assert.ok(['matching-runner', 'host-reject'].includes(mode), 'probe mode is required');

const modelId = process.env.WORKER_EGRESS_MODEL_ID;
assert.match(modelId ?? '', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
assert.equal(process.env.AXIOM_EGRESS_RUNNER, '1');
assert.equal(process.env.AXIOM_EGRESS_CONFINEMENT_REQUIRED, '1');
assert.equal(process.getuid?.(), 65534, 'probe must not run as the namespace setup user');

const status = Object.fromEntries(readFileSync('/proc/self/status', 'utf8')
  .split('\n').flatMap(line => {
    const match = /^(CapEff|CapPrm|CapBnd|NoNewPrivs):\s*(.+)$/.exec(line);
    return match ? [[match[1], match[2].trim()]] : [];
  }));
assert.equal(status.CapEff, '0000000000000000');
assert.equal(status.CapPrm, '0000000000000000');
assert.equal(status.CapBnd, '0000000000000000');
assert.equal(status.NoNewPrivs, '1');
console.log('ASSERT_UNPRIVILEGED_CAPS PASS');

const unshare = (() => {
  try {
    execFileSync('unshare', ['--net', 'true'], { stdio: 'pipe' });
    return { succeeded: true };
  } catch (error) {
    return { succeeded: false, stderr: String(error.stderr ?? '') };
  }
})();
assert.equal(unshare.succeeded, false, 'unprivileged probe must not create a network namespace');
console.log('ASSERT_UNSHARE_DENIED PASS');

const expectedNamespace = `/run/netns/egress_${modelId}`;
const sameNamespace = () => {
  const current = statSync('/proc/self/ns/net');
  const expected = statSync(expectedNamespace);
  return current.dev === expected.dev && current.ino === expected.ino;
};
if (mode === 'host-reject') {
  assert.equal(sameNamespace(), false);
  assert.throws(() => buildEgressFetch({ kind: 'direct' }), /not running in its assigned network namespace/);
  console.log('ASSERT_HOST_NAMESPACE_REJECT PASS');

  let reachable = false;
  try {
    const response = await fetch('http://127.0.0.1:18991/permitted', { signal: AbortSignal.timeout(500) });
    reachable = response.ok;
  } catch {
    // A canary bound only inside the model namespace must not be reachable
    // from the container's initial namespace.
  }
  assert.equal(reachable, false, 'host namespace reached model-only loopback canary');
  console.log('ASSERT_HOST_LOOPBACK_UNREACHABLE PASS');
  process.exit(0);
}

assertEgressFetchCaller();
assert.equal(sameNamespace(), true);
console.log('ASSERT_NAMESPACE_MATCH PASS');

const egressFetch = buildEgressFetch({ kind: 'direct' });
let response;
let lastError;
for (let attempt = 0; attempt < 30; attempt += 1) {
  try {
    response = await egressFetch('http://127.0.0.1:18991/permitted', { signal: AbortSignal.timeout(500) });
    break;
  } catch (error) {
    lastError = error;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}
assert.ok(response, `matching runner could not reach model canary: ${lastError}`);
assert.equal(response.status, 200);
assert.equal(await response.text(), 'model-namespace-canary');
console.log('ASSERT_MATCHING_RUNNER_FETCH PASS');
