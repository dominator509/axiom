#!/usr/bin/env bash
# ============================================================================
# setup-dev.sh — Bootstrap a local development environment for AXIOM
#
# Steps:
#   1. Check for .env, copy .env.example if missing
#   2. Run pnpm install
#   3. If docker is available, start postgres via docker compose
#   4. Wait for postgres readiness
#   5. Run database migrations
#   6. Run pnpm build
# ============================================================================
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

echo "=== setup-dev.sh: AXIOM Development Environment Setup ==="
echo ""

# ------------------------------------------------------------------
# Step 1: Environment file
# ------------------------------------------------------------------
echo "--- Step 1: Checking .env ---"
if [ -f ".env" ]; then
  echo "  .env already exists — keeping existing"
else
  if [ -f ".env.example" ]; then
    cp .env.example .env
    echo "  Copied .env.example → .env"
    echo "  [info] Edit .env to set your DATABASE_URL and secrets"
  else
    echo "  [warn] No .env.example found — creating minimal .env"
    cat > .env <<-'EOF'
# AXIOM — Local Development Environment
DATABASE_URL=postgresql://axiom:changeme@localhost:5432/axiom
TEST_DATABASE_URL=postgresql://axiom:changeme@localhost:5432/axiom_test
EOF
    echo "  Created minimal .env"
  fi
fi
echo ""

# ------------------------------------------------------------------
# Step 2: Install dependencies
# ------------------------------------------------------------------
echo "--- Step 2: Installing pnpm dependencies ---"
pnpm install
echo ""

# ------------------------------------------------------------------
# Step 3: Docker / PostgreSQL
# ------------------------------------------------------------------
echo "--- Step 3: Starting PostgreSQL with Docker ---"
if command -v docker &>/dev/null; then
  if [ -f "infra/docker-compose.yml" ]; then
    echo "  Starting postgres in background..."
    docker compose -f infra/docker-compose.yml up -d postgres
  else
    echo "  [warn] infra/docker-compose.yml not found — skipping docker compose"
  fi
else
  echo "  [skip] docker not found — assuming postgres is running locally"
fi
echo ""

# ------------------------------------------------------------------
# Step 4: Wait for PostgreSQL readiness
# ------------------------------------------------------------------
echo "--- Step 4: Waiting for PostgreSQL to be ready ---"
WAIT_MAX=30
WAIT_COUNT=0
# Source DATABASE_URL from .env if not already set
if [ -z "${DATABASE_URL:-}" ] && [ -f ".env" ]; then
  # shellcheck disable=SC2046
  export $(grep -v '^#' .env | grep '^DATABASE_URL=' | xargs)
fi

if [ -n "${DATABASE_URL:-}" ]; then
  # Extract host and port from DATABASE_URL
  DB_HOST=$(echo "$DATABASE_URL" | sed -n 's|.*@\([^:]*\).*|\1|p')
  DB_HOST="${DB_HOST:-localhost}"
  DB_PORT=$(echo "$DATABASE_URL" | sed -n 's|.*:\([0-9]*\)/.*|\1|p')
  DB_PORT="${DB_PORT:-5432}"

  echo "  Waiting for postgres at $DB_HOST:$DB_PORT (up to ${WAIT_MAX}s)..."
  until pg_isready -h "$DB_HOST" -p "$DB_PORT" -q 2>/dev/null; do
    WAIT_COUNT=$((WAIT_COUNT + 1))
    if [ "$WAIT_COUNT" -ge "$WAIT_MAX" ]; then
      echo "  [warn] PostgreSQL did not become ready within ${WAIT_MAX}s — continuing anyway"
      break
    fi
    sleep 1
  done
  if [ "$WAIT_COUNT" -lt "$WAIT_MAX" ]; then
    echo "  PostgreSQL is ready"
  fi
else
  echo "  [skip] DATABASE_URL not set — cannot check postgres readiness"
fi
echo ""

# ------------------------------------------------------------------
# Step 5: Run database migrations
# ------------------------------------------------------------------
echo "--- Step 5: Running database migrations ---"
if [ -f "scripts/migrate.sh" ]; then
  bash scripts/migrate.sh
else
  echo "  [warn] scripts/migrate.sh not found — skipping migrations"
fi
echo ""

# ------------------------------------------------------------------
# Step 6: Build all packages and crates
# ------------------------------------------------------------------
echo "--- Step 6: Building the project ---"
pnpm build
echo ""

# ------------------------------------------------------------------
# Done
# ------------------------------------------------------------------
echo "=========================================="
echo "  AXIOM development environment is ready!"
echo "=========================================="
echo "  Run 'pnpm dev' to start the dev server."
echo "  Run 'pnpm test' to run tests."
echo "=========================================="
