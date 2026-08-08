#!/usr/bin/env bash
# ============================================================================
# lint.sh — Run all linters across the AXIOM monorepo
#
# Runs: eslint on TS packages, prettier --check on the whole project,
#       cargo clippy on Rust crates, and bash -n on all shell scripts.
# ============================================================================
set -eu
if [ -n "${BASH_VERSION:-}" ]; then set -o pipefail; fi

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

echo "=== [lint] Running eslint across all declared packages ==="
pnpm lint

echo ""
echo "=== [lint] Running prettier --check ==="
pnpm exec prettier --check \
  "packages/**/*.{ts,tsx,json}" \
  "scripts/**/*.mjs" \
  "*.{json,mjs,ts,yaml,yml}"

echo ""
echo "=== [lint] Running cargo fmt --check ==="
if command -v cargo >/dev/null 2>&1; then
  cargo fmt --all -- --check
else
  echo "  [skip] cargo not found"
fi

echo ""
echo "=== [lint] Running cargo clippy ==="
if command -v cargo >/dev/null 2>&1; then
  cargo clippy --workspace -- -D warnings
else
  echo "  [skip] cargo not found"
fi

echo ""
echo "=== [lint] Shell syntax check (bash -n) on scripts/ ==="
find scripts/ -type f -name '*.sh' -print | while IFS= read -r script; do
  if bash -n "$script" 2>/dev/null; then
    echo "  OK: $script"
  else
    echo "  FAIL: $script"
    exit 1
  fi
done

echo ""
echo "=== lint.sh: all checks passed ==="
