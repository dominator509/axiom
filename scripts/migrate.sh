#!/usr/bin/env bash
# ============================================================================
# migrate.sh — Apply database migrations in order
#
# Reads DATABASE_URL from .env or environment and runs all .sql files
# found in packages/db/migrations/ in alphabetical order.
# Supports --dry-run to show what would run without executing.
# ============================================================================
set -eu
if [ -n "${BASH_VERSION:-}" ]; then set -o pipefail; fi

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

MIGRATIONS_DIR="packages/db/migrations"
DRY_RUN=false

# Parse arguments
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    *) echo "Unknown argument: $arg"; exit 1 ;;
  esac
done

# Resolve DATABASE_URL
if [ -z "${DATABASE_URL:-}" ]; then
  if [ -f ".env" ]; then
    while IFS='=' read -r key value; do
      if [ "$key" = "DATABASE_URL" ]; then
        DATABASE_URL="$value"
      fi
    done <<EOF
$(grep -v '^#' .env)
EOF
  fi
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is not set and not found in .env"
  echo "Usage: DATABASE_URL=postgresql://user:***@host/db ./scripts/migrate.sh [--dry-run]"
  exit 1
fi

if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "ERROR: Migrations directory '$MIGRATIONS_DIR' not found"
  exit 1
fi

echo "=== migrate.sh ==="
# Mask password in URL for display (POSIX-safe: strip to ://user:***@host)
MASKED_URL=$(printf '%s' "$DATABASE_URL" | sed -E 's#(://[^:]+:)[^@]+@#\1****@#')
echo "  DATABASE_URL: $MASKED_URL"
echo "  Migrations:   $MIGRATIONS_DIR"
echo "  Dry-run:      $DRY_RUN"
echo ""

# Collect migrations in sorted order (POSIX-compatible; filenames contain no spaces)
migrations=""
for f in $(find "$MIGRATIONS_DIR" -name '*.sql' -type f | sort); do
  migrations="$migrations $f"
done

# Convert to array
set -- $migrations
num_migrations=$#

if [ "$num_migrations" -eq 0 ]; then
  echo "No migration files found in $MIGRATIONS_DIR"
  exit 0
fi

echo "Found $num_migrations migration(s) to apply:"
for f in "$@"; do
  echo "  - $(basename "$f")"
done
echo ""

for f in "$@"; do
  echo ">>> Applying: $(basename "$f")..."
  if [ "$DRY_RUN" = true ]; then
    echo "  [dry-run] psql -f \"$f\" \"$DATABASE_URL\""
    echo "  --- SQL preview ---"
    head -20 "$f"
    echo "  ... (truncated)"
    echo ""
  else
    psql --echo-errors -f "$f" "$DATABASE_URL"
    echo "  -> done"
    echo ""
  fi
done

echo "=== migrate.sh: all $num_migrations migration(s) processed ==="
