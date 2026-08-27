#!/usr/bin/env bash
# ============================================================================
# migrate.sh — Apply database migrations in order
#
# Requires a dedicated MIGRATOR_DATABASE_URL and records immutable checksums in
# public.axiom_schema_migrations. The runner owns the transaction: historical
# migration files may contain their old BEGIN/COMMIT wrappers, but those
# top-level wrappers are removed from the stream executed below. Use --baseline
# only for a database whose schema was already restored/applied and independently
# verified.
# ============================================================================
set -eu
if [ -n "${BASH_VERSION:-}" ]; then set -o pipefail; fi

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

MIGRATIONS_DIR="packages/db/migrations"
DRY_RUN=false
BASELINE=false

# Parse arguments
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --baseline) BASELINE=true ;;
    *) echo "Unknown argument: $arg"; exit 1 ;;
  esac
done

# Resolve the owner/migrator URL. Never fall back to the runtime application
# role: doing so encourages granting DDL privileges to the serving process.
if [ "$DRY_RUN" != true ] && [ -z "${MIGRATOR_DATABASE_URL:-}" ]; then
  if [ -r ".env" ]; then
    while IFS='=' read -r key value; do
      if [ "$key" = "MIGRATOR_DATABASE_URL" ]; then
        MIGRATOR_DATABASE_URL="$value"
      fi
    done <<EOF
$(grep -v '^#' .env)
EOF
  fi
fi

if [ "$DRY_RUN" != true ] && [ -z "${MIGRATOR_DATABASE_URL:-}" ]; then
  echo "ERROR: MIGRATOR_DATABASE_URL is required (the runtime DATABASE_URL is never used for DDL)"
  echo "Usage: MIGRATOR_DATABASE_URL=postgresql://... ./scripts/migrate.sh [--baseline]"
  exit 1
fi

if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "ERROR: Migrations directory '$MIGRATIONS_DIR' not found"
  exit 1
fi

echo "=== migrate.sh ==="
if [ "$DRY_RUN" = true ]; then
  echo "  Migrator URL: not required for dry-run"
else
  echo "  Migrator URL: configured (value suppressed)"
fi
echo "  Migrations:   $MIGRATIONS_DIR"
echo "  Dry-run:      $DRY_RUN"
echo "  Baseline:     $BASELINE"
echo ""

# Collect migrations in sorted glob order. These filenames contain no spaces;
# using a shell glob keeps the runner independent of the Windows `find.exe`
# shadowing Git Bash's POSIX find on development workstations.
migrations=""
for f in "$MIGRATIONS_DIR"/*.sql; do
  [ -f "$f" ] || continue
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

# Historical migration files are checksum-addressed and must not be rewritten.
# Strip only standalone transaction-control statements while streaming a
# migration through the runner's single outer transaction. BEGIN/COMMIT inside
# PL/pgSQL DO/function bodies are intentionally preserved.
stream_migration_without_transaction_control() {
  awk '
    /^[[:space:]]*BEGIN[[:space:]]*;[[:space:]]*$/ { next }
    /^[[:space:]]*COMMIT[[:space:]]*;[[:space:]]*$/ { next }
    /^[[:space:]]*ROLLBACK[[:space:]]*;[[:space:]]*$/ { next }
    { print }
  ' "$1"
}

if [ "$DRY_RUN" != true ]; then
  psql -X -v ON_ERROR_STOP=1 "$MIGRATOR_DATABASE_URL" <<'SQL'
CREATE TABLE IF NOT EXISTS public.axiom_schema_migrations (
  migration_name text PRIMARY KEY,
  checksum_sha256 text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON TABLE public.axiom_schema_migrations FROM PUBLIC;
SQL
fi

for f in "$@"; do
  name=$(basename "$f")
  checksum=$(sha256sum "$f" | awk '{print $1}')
  echo ">>> Processing: $name..."
  if [ "$DRY_RUN" = true ]; then
    echo "  [dry-run] checksum=$checksum"
    echo ""
  else
    recorded=$(psql -X -v ON_ERROR_STOP=1 -Atq "$MIGRATOR_DATABASE_URL" \
      -v migration_name="$name" \
      -c "SELECT checksum_sha256 FROM public.axiom_schema_migrations WHERE migration_name = :'migration_name'")
    if [ -n "$recorded" ]; then
      if [ "$recorded" != "$checksum" ]; then
        echo "ERROR: checksum mismatch for previously applied migration $name"
        exit 1
      fi
      echo "  -> already applied"
      continue
    fi
    if [ "$BASELINE" = true ]; then
      psql -X -v ON_ERROR_STOP=1 "$MIGRATOR_DATABASE_URL" \
        -v migration_name="$name" -v checksum="$checksum" \
        -c "INSERT INTO public.axiom_schema_migrations (migration_name, checksum_sha256) VALUES (:'migration_name', :'checksum')"
      echo "  -> baselined"
      continue
    fi
    {
      stream_migration_without_transaction_control "$f"
      printf '%s\n' "INSERT INTO public.axiom_schema_migrations (migration_name, checksum_sha256) VALUES (:'migration_name', :'checksum');"
    } | psql -X --echo-errors -v ON_ERROR_STOP=1 --single-transaction \
      "$MIGRATOR_DATABASE_URL" -v migration_name="$name" -v checksum="$checksum"
    echo "  -> done"
    echo ""
  fi
done

echo "=== migrate.sh: all $num_migrations migration(s) processed ==="
