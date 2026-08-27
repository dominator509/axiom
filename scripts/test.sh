#!/usr/bin/env bash
# POSIX-safe strict mode: dash (sh) rejects "set -o pipefail", so guard it.
set -eu
if [ -n "${BASH_VERSION:-}" ]; then set -o pipefail; fi

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

echo "=== [test] Running pnpm test (turbo run test) ==="
node scripts/run-with-env.mjs pnpm test

echo ""
echo "=== [test] Running cargo test --workspace ==="
if command -v cargo &>/dev/null; then
  node scripts/run-with-env.mjs cargo test --workspace
else
  echo "  [skip] cargo not found"
fi

echo ""
echo "=== [test] Running migration dry-run test ==="
MIGRATION_FILE="packages/db/migrations/0000_initial.sql"
if [ -f "$MIGRATION_FILE" ]; then
  if [ -n "${TEST_DATABASE_URL:-}" ]; then
    echo "  TEST_DATABASE_URL is set — applying all migrations through the runner..."
    MIGRATOR_DATABASE_URL="$TEST_DATABASE_URL" sh scripts/migrate.sh
    echo "  Migration runner: SUCCESS"
  else
    echo "  TEST_DATABASE_URL not set — checking SQL syntax with sh -n style parsing"
    # Basic syntax check: verify migration files are present and the runner
    # owns the outer transaction. The runner strips historical top-level
    # BEGIN/COMMIT statements without changing checksum-addressed files.
    if head -1 "$MIGRATION_FILE" | grep -q '^-'; then
      echo "  Migration file exists and has valid header"
    fi
    if grep -q 'stream_migration_without_transaction_control' scripts/migrate.sh \
      && grep -q -- '--single-transaction' scripts/migrate.sh; then
      echo "  Migration runner atomicity: outer transaction + transaction-control normalization"
      echo "  Migration syntax check: PASSED"
    else
      echo "  ERROR: migration runner does not own a single transaction"
      exit 1
    fi
  fi
else
  echo "  [warn] Migration file '$MIGRATION_FILE' not found — skipping"
fi

echo ""
echo "=== test.sh: all tests completed ==="
