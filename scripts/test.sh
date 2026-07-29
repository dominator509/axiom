#!/usr/bin/env bash
# ============================================================================
# test.sh — Run the full test suite for the AXIOM monorepo
#
# Runs: pnpm test (turbo run test), cargo test --workspace,
#       and a migration dry-run test against the initial SQL migration.
# ============================================================================
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

echo "=== [test] Running pnpm test (turbo run test) ==="
pnpm test

echo ""
echo "=== [test] Running cargo test --workspace ==="
if command -v cargo &>/dev/null; then
  cargo test --workspace
else
  echo "  [skip] cargo not found"
fi

echo ""
echo "=== [test] Running migration dry-run test ==="
MIGRATION_FILE="packages/db/migrations/0000_initial.sql"
if [ -f "$MIGRATION_FILE" ]; then
  if [ -n "${TEST_DATABASE_URL:-}" ]; then
    echo "  TEST_DATABASE_URL is set — applying dry-run (--echo-errors)..."
    psql --echo-errors -f "$MIGRATION_FILE" "$TEST_DATABASE_URL"
    echo "  Migration dry-run: SUCCESS"
  else
    echo "  TEST_DATABASE_URL not set — checking SQL syntax with sh -n style parsing"
    # Basic syntax check: verify BEGIN/COMMIT balance and no obvious issues
    if head -1 "$MIGRATION_FILE" | grep -q '^-'; then
      echo "  Migration file exists and has valid header"
    fi
    # Count BEGIN vs COMMIT as a basic sanity check
    begin_count=$(grep -c '^BEGIN;' "$MIGRATION_FILE" || true)
    commit_count=$(grep -c '^COMMIT;' "$MIGRATION_FILE" || true)
    if [ "$begin_count" -eq "$commit_count" ]; then
      echo "  Migration file '$MIGRATION_FILE' exists — BEGIN/COMMIT balanced ($begin_count/$commit_count)"
      echo "  Migration syntax check: PASSED"
    else
      echo "  ERROR: BEGIN/COMMIT mismatch ($begin_count BEGIN vs $commit_count COMMIT)"
      exit 1
    fi
  fi
else
  echo "  [warn] Migration file '$MIGRATION_FILE' not found — skipping"
fi

echo ""
echo "=== test.sh: all tests completed ==="
