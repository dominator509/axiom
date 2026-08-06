#!/bin/bash
# Live chain verify with a REAL upstream (host sidecar on :19999, direct).
# Registry allocates from octet 1 -> host veth 10.240.1.1 / netns 10.240.1.2.
set -u
PLANE="${PLANE:-http://127.0.0.1:3000}"
MODEL="deepseek-v4-flash"
echo "== bind $MODEL through host sidecar 10.240.1.1:19999 =="
curl -s --max-time 30 -X POST "$PLANE/egress/bind" -H 'content-type: application/json' \
  -d "{\"model_id\":\"$MODEL\",\"mode\":\"http\",\"proxy_addr\":\"10.240.1.1:19999\"}"
echo
echo "== status =="
curl -s --max-time 10 "$PLANE/egress/status"
echo
