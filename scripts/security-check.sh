#!/usr/bin/env bash
# ============================================================================
# security-check.sh — Security scanning for the AXIOM monorepo
#
# Scans for:
#   - Hardcoded secrets/API keys in git-tracked files
#   - World-writable files
#   - pnpm audit results (if pnpm is available)
#   - cargo audit results (if cargo-audit is installed)
#   - .env presence in .gitignore
# Exits with non-zero if any issues are found.
# ============================================================================
set -eu
if [ -n "${BASH_VERSION:-}" ]; then set -o pipefail; fi

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

EXIT_CODE=0

echo "=== security-check.sh: AXIOM Security Scan ==="
echo ""

# ------------------------------------------------------------------
# 1. Check for hardcoded secrets in git-tracked files
# ------------------------------------------------------------------
echo "--- Check 1: Hardcoded secrets scan (git-tracked files) ---"
SECRET_PATTERNS='(SECRET|API_KEY|PASSWORD|PRIVATE_KEY|TOKEN|CREDENTIALS)[[:space:]]*[:=][[:space:]]*['"'"'"]?[A-Za-z0-9_/-]{16,}'

# Only run if git is available and there are tracked files
if command -v git &>/dev/null && git rev-parse --git-dir &>/dev/null; then
  MATCHES=$(git grep -InE "$SECRET_PATTERNS" -- ':!.env' ':!.env.*' ':!*.test.*' ':!*test*' 2>/dev/null || true)
  if [ -n "$MATCHES" ]; then
    echo "  [FAIL] Potential secrets detected in tracked files:"
    echo "$MATCHES" | while IFS= read -r line; do
      echo "    $line"
    done
    EXIT_CODE=1
  else
    echo "  [PASS] No hardcoded secrets found in git-tracked files"
  fi
else
  echo "  [skip] Not a git repository or git not available"
fi
echo ""

# ------------------------------------------------------------------
# 2. Check file permissions — no world-writable files
# ------------------------------------------------------------------
echo "--- Check 2: File permissions (no world-writable files) ---"
WORLD_WRITABLE=$(find . -perm -o+w -not -path './node_modules/*' -not -path './.git/*' -not -path './target/*' -not -path './.turbo/*' -type f 2>/dev/null || true)
if [ -n "$WORLD_WRITABLE" ]; then
  echo "  [FAIL] World-writable files found:"
  echo "$WORLD_WRITABLE" | while IFS= read -r f; do
    echo "    $f"
  done
  EXIT_CODE=1
else
  echo "  [PASS] No world-writable files found"
fi
echo ""

# ------------------------------------------------------------------
# 3. Check pnpm audit
# ------------------------------------------------------------------
echo "--- Check 3: pnpm audit ---"
if command -v pnpm &>/dev/null; then
  echo "  Running pnpm audit..."
  # pnpm audit exits non-zero on vulnerabilities; we capture that
  if pnpm audit --audit-level=high 2>&1; then
    echo "  [PASS] No high-severity vulnerabilities found"
  else
    echo "  [FAIL] High-severity vulnerabilities detected (see above)"
    EXIT_CODE=1
  fi
else
  echo "  [skip] pnpm not found"
fi
echo ""

# ------------------------------------------------------------------
# 4. Check cargo audit
# ------------------------------------------------------------------
echo "--- Check 4: cargo audit ---"
if command -v cargo-audit &>/dev/null; then
  if [ -f "Cargo.lock" ] || [ -f "Cargo.toml" ]; then
    cargo audit 2>&1 || {
      echo "  [FAIL] cargo audit found issues"
      EXIT_CODE=1
    }
  else
    echo "  [skip] No Cargo.lock or Cargo.toml found"
  fi
else
  echo "  [warn] cargo-audit not installed — skipping Rust audit (install with 'cargo install cargo-audit')"
fi
echo ""

# ------------------------------------------------------------------
# 5. Check .env is in .gitignore
# ------------------------------------------------------------------
echo "--- Check 5: .env is gitignored ---"
if [ -f ".gitignore" ]; then
  if grep -q '^\.env$' .gitignore || grep -q '^\.env\b' .gitignore; then
    echo "  [PASS] .env is listed in .gitignore"
  else
    echo "  [FAIL] .env is NOT listed in .gitignore — secrets could be committed!"
    EXIT_CODE=1
  fi
else
  echo "  [FAIL] No .gitignore file found"
  EXIT_CODE=1
fi
echo ""

# ------------------------------------------------------------------
# Summary
# ------------------------------------------------------------------
if [ "$EXIT_CODE" -eq 0 ]; then
  echo "=== security-check.sh: ALL CHECKS PASSED ==="
else
  echo "=== security-check.sh: SOME CHECKS FAILED (exit code $EXIT_CODE) ==="
fi

exit "$EXIT_CODE"
