#!/usr/bin/env bash
# POSIX-safe strict mode: dash (sh) rejects "set -o pipefail", so guard it.
set -eu
if [ -n "${BASH_VERSION:-}" ]; then set -o pipefail; fi

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

echo "=== [test-unit] Running pnpm unit tests (--filter='*' test) ==="
pnpm --filter='*' test

echo ""
echo "=== [test-unit] Running cargo lib tests ==="
if command -v cargo &>/dev/null; then
  cargo test --lib --workspace
else
  echo "  [skip] cargo not found"
fi

echo ""
echo "=== test-unit.sh: all unit tests completed ==="
