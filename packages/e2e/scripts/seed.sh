#!/usr/bin/env bash
# ============================================================================
# seed.sh — Seed the ephemeral E2E database with fixture data.
#
# Runs ONLY against the database named by E2E_MIGRATOR_DATABASE_URL. This
# script must never point at a production or shared database; the CI E2E job
# and local runs use a throwaway database created for the test run.
# Idempotent: safe to re-run.
# ============================================================================
set -euo pipefail

if [ -z "${E2E_MIGRATOR_DATABASE_URL:-}" ]; then
  echo "ERROR: E2E_MIGRATOR_DATABASE_URL is required" >&2
  exit 1
fi

case "$E2E_MIGRATOR_DATABASE_URL" in
  *test.fanthynks.com*|*fanthynks.com*)
    echo "ERROR: refusing to seed a fanthynks.com database" >&2
    exit 1
    ;;
esac

psql -X -v ON_ERROR_STOP=1 "$E2E_MIGRATOR_DATABASE_URL" <<'SQL'
-- Fixture org used by every E2E test. Tests create their own users via the
-- real sign-up endpoint and attach them to this org with a test-only SQL
-- UPDATE (the app intentionally assigns no org at sign-up time).
INSERT INTO org (id, name, slug)
VALUES ('22222222-2222-4222-8222-222222222222', 'E2E Test Org', 'e2e-test-org')
ON CONFLICT (id) DO NOTHING;

-- org_settings row must exist for the killswitch / org-settings flows.
INSERT INTO org_settings (org_id, publishing_enabled, viral_sharing)
VALUES ('22222222-2222-4222-8222-222222222222', true, false)
ON CONFLICT (org_id) DO NOTHING;

-- Two seeded talent profiles so list/table rendering tests have rows even
-- when run in isolation from the CRUD spec.
INSERT INTO model_profile (id, org_id, display_name, handle, bio, is_active)
VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '22222222-2222-4222-8222-222222222222',
   'Seeded Star', 'seeded.star', 'Seeded fixture profile', true),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222',
   'Fixture Muse', 'fixture.muse', 'Second seeded fixture profile', true)
ON CONFLICT (id) DO NOTHING;
SQL

echo "seed.sh: fixtures applied"
