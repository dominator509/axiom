#!/usr/bin/env sh
# Fail closed if a deployment Dockerfile introduces a floating base image.
set -eu

PROJECT_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

status=0
for dockerfile in infra/Dockerfile.hono infra/Dockerfile.next infra/Dockerfile.rust infra/Dockerfile.worker; do
  if [ ! -f "$dockerfile" ]; then
    echo "container-base-pins: missing $dockerfile"
    status=1
    continue
  fi

  if awk '
    /^[[:space:]]*FROM[[:space:]]/ && $0 !~ /@sha256:[0-9a-f]{64}/ {
      print FILENAME ":" FNR ": " $0
      bad = 1
    }
    END { exit bad }
  ' "$dockerfile"; then
    echo "container-base-pins: $dockerfile ok"
  else
    status=1
  fi
done

if [ "$status" -ne 0 ]; then
  echo "container-base-pins: floating or invalid base image reference detected"
  exit 1
fi

echo "container-base-pins: ok"
