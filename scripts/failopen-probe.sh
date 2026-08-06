#!/bin/bash
# Fail-open probe: bind with a dead upstream; expect healthy:false (fail-closed).
# If the plane reports healthy:true through a dead proxy, that is a fail-open bug.
set -u
PLANE="${PLANE:-http://127.0.0.1:3000}"
echo "== bind with DEAD upstream (127.0.0.1:1) =="
curl -s --max-time 25 -X POST "$PLANE/egress/bind" -H 'content-type: application/json' \
  -d '{"model_id":"failopen_probe","mode":"http","proxy_addr":"127.0.0.1:1"}'
echo
echo "== status =="
curl -s --max-time 10 "$PLANE/egress/status"
echo
echo "== unbind (cleanup) =="
curl -s --max-time 10 -X POST "$PLANE/egress/unbind" -H 'content-type: application/json' \
  -d '{"model_id":"failopen_probe"}'
echo
