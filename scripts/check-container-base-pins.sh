#!/usr/bin/env sh
# Fail closed if a deployment Dockerfile introduces a floating base image.
set -eu

PROJECT_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

status=0
for dockerfile in infra/Dockerfile.hono infra/Dockerfile.next infra/Dockerfile.rust infra/Dockerfile.vision infra/Dockerfile.scraper infra/Dockerfile.worker; do
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

compose_file="infra/docker-compose.yml"
if [ ! -f "$compose_file" ]; then
  echo "container-base-pins: missing $compose_file"
  status=1
elif awk '
  /^[[:space:]]*image:[[:space:]]/ && $0 !~ /@sha256:[0-9a-f]{64}/ {
    print FILENAME ":" FNR ": " $0
    bad = 1
  }
  END { exit bad }
' "$compose_file"; then
  echo "container-base-pins: $compose_file ok"
else
  status=1
fi

if [ "$status" -ne 0 ]; then
  echo "container-base-pins: floating or invalid base image reference detected"
  exit 1
fi

echo "container-base-pins: ok"
