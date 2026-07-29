#!/usr/bin/env bash
# ============================================================================
# test-unit.sh — Run only unit tests (fast subset of test.sh)
#
# Runs: pnpm --filter='*' test and cargo test --lib --workspace.
# Skips integration/e2e tests and migration dry-runs.
# ============================================================================
set -euo pipefail

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
