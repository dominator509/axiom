#!/bin/sh
set -eu
expected_node="v22.23.3"
actual_node="$(node --version)"
if [ "$actual_node" != "$expected_node" ]; then
  echo "egress fixture Node mismatch: expected $expected_node, received $actual_node" >&2
  exit 1
fi

MODEL_ID='11111111-1111-4111-8111-111111111111'
NETNS="egress_${MODEL_ID}"
CANARY_PID=''

cleanup() {
  if [ -n "$CANARY_PID" ]; then kill "$CANARY_PID" 2>/dev/null || true; fi
  ip netns del "$NETNS" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

ip netns add "$NETNS"
ip -n "$NETNS" link set lo up
if [ -n "$(ip -n "$NETNS" route show default)" ]; then
  echo "ASSERT_NO_DEFAULT_ROUTE FAIL" >&2
  exit 1
fi
echo "ASSERT_NO_DEFAULT_ROUTE PASS"

# Root exists only to create/delete the disposable namespace.  Both Node
# probes execute as nobody with all capability sets empty and no_new_privs.
ip netns exec "$NETNS" setpriv --reuid 65534 --regid 65534 --clear-groups \
  --bounding-set=-all --inh-caps=-all --ambient-caps=-all --no-new-privs \
  env -i PATH="$PATH" HOME=/tmp node /app/infra/egress-worker-rehearsal/canary.mjs &
CANARY_PID=$!

COMMON_ENV="AXIOM_EGRESS_RUNNER=1 AXIOM_EGRESS_CONFINEMENT_REQUIRED=1 WORKER_EGRESS_MODEL_ID=${MODEL_ID}"
run_namespace_probe() {
  mode="$1"
  ip netns exec "$NETNS" env -i PATH="$PATH" HOME=/tmp $COMMON_ENV \
    setpriv --reuid 65534 --regid 65534 --clear-groups --bounding-set=-all --inh-caps=-all --ambient-caps=-all --no-new-privs \
    node /app/infra/egress-worker-rehearsal/probe.mjs "$mode"
}

# The initial container namespace has no path to the canary and must be
# rejected by the shared helper before a configured egress fetch is returned.
env -i PATH="$PATH" HOME=/tmp $COMMON_ENV \
  setpriv --reuid 65534 --regid 65534 --clear-groups --bounding-set=-all --inh-caps=-all --ambient-caps=-all --no-new-privs \
  node /app/infra/egress-worker-rehearsal/probe.mjs host-reject

# The matching namespace is the only one permitted through the helper, and it
# can reach its own loopback canary through explicit direct and proxy bindings.
# Stopping the model proxy is the controlled network fault: the real Undici
# ProxyAgent must fail without reaching the target directly.
run_namespace_probe matching-runner
run_namespace_probe binding-mismatch
run_namespace_probe proxy-positive
run_namespace_probe proxy-disable
run_namespace_probe proxy-outage
