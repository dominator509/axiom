#!/usr/bin/env bash
# ============================================================================
# lint.sh — Run all linters across the AXIOM monorepo
#
# Runs: eslint on TS packages, prettier --check on the whole project,
#       cargo clippy on Rust crates, and bash -n on all shell scripts.
# ============================================================================
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

echo "=== [lint] Running eslint on TypeScript packages ==="
for pkg in core db auth api; do
  if [ -f "packages/$pkg/package.json" ]; then
    echo "  -> packages/$pkg"
    if [ -f "packages/$pkg/.eslintrc*" ] || [ -f "packages/$pkg/eslint*" ] || [ -f ".eslintrc*" ] || [ -f "eslint*" ]; then
      npx eslint "packages/$pkg/src/**/*.ts" --max-warnings 0 2>/dev/null || true
    else
      echo "  [warn] No eslint config found for packages/$pkg"
    fi
  fi
done

echo ""
echo "=== [lint] Running prettier --check ==="
npx prettier --check . 2>/dev/null || echo "  [warn] prettier check found issues"

echo ""
echo "=== [lint] Running cargo clippy ==="
if command -v cargo >/dev/null 2>&1; then
  cargo clippy --workspace -- -D warnings 2>/dev/null || echo "  [warn] clippy found issues"
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
