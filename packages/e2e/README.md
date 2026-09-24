# AXIOM E2E tests (`@axiom/e2e`)

End-to-end tests for the AXIOM dashboard + Hono API, run with Playwright
against an **ephemeral local stack**. Nothing here touches production data,
the production schema, or `test.fanthynks.com` (except the optional,
read-only, credentials-gated prod smoke project).

## What it spins up

| Piece     | How                                                                                  |
| --------- | ------------------------------------------------------------------------------------ |
| Postgres  | Throwaway database you provision (see below); migrated + seeded by `global-setup.ts` |
| API       | `node packages/api/dist/server.js` (Playwright `webServer`)                          |
| Dashboard | `next dev -p 3002` (Playwright `webServer`), `/api/*` → API                          |

## Run locally

1. Start an ephemeral Postgres 16 with the `timescaledb`, `vector`, and
   `pgcrypto` extensions, e.g.:

   ```bash
   initdb -D /tmp/axiom-e2e-pg -U postgres --auth=trust
   # add: shared_preload_libraries='timescaledb', port=55432
   pg_ctl -D /tmp/axiom-e2e-pg -l /tmp/pg.log start
   psql -h 127.0.0.1 -p 55432 -U postgres -c "CREATE DATABASE axiom_e2e;"
   ```

2. Export the test database URLs (a runtime role + the migrator role):

   ```bash
   export E2E_MIGRATOR_DATABASE_URL="postgresql://postgres@127.0.0.1:55432/axiom_e2e"
   export E2E_DATABASE_URL="postgresql://postgres@127.0.0.1:55432/axiom_e2e"
   ```

   (The migrations grant the least-privilege `axiom_app` role no access to
   the `auth_*` tables, so auth flows 500 under that role — a bug recorded in
   the PR. The suite therefore runs the API as the same role the deployment
   container smoke test uses.)

3. Install + build, then run:

   ```bash
   pnpm install
   pnpm build --filter @axiom/api...        # global-setup does this if dist is missing
   pnpm --filter @axiom/e2e exec playwright install chromium
   pnpm --filter @axiom/e2e test:e2e
   ```

   If the API/dashboard are already running on :3001/:3002 they are reused
   (`reuseExistingServer`); set `CI=1` to force a fresh stack.

## Projects

- `core` — desktop Chromium: signup, login/logout/session, dashboard widgets
  and navigation, talent CRUD, killswitch + org-settings persistence.
- `mobile` — the same critical flows at a 375×667 viewport.
- `prod-smoke` — **read-only** checks against `E2E_PROD_BASE_URL`
  (default `https://test.fanthynks.com`). Skipped unless **both**
  `E2E_PROD_TEST_USER` and `E2E_PROD_TEST_PASS` are set; never creates
  accounts or mutates anything. Run alone with:

  ```bash
  E2E_PROD_ONLY=1 pnpm --filter @axiom/e2e exec playwright test --project=prod-smoke
  ```

## Test-only helpers

- `global-setup.ts` — applies `scripts/migrate.sh`, then runs
  `scripts/seed.sh`, which inserts the `E2E Test Org` org, its
  `org_settings` row, and two fixture talent profiles. It refuses to run
  against anything matching `*fanthynks.com*`.
- `tests/helpers.ts` — `signUpViaApi` (real better-auth endpoint through the
  dashboard rewrite), `attachUserToE2EOrg` (the app assigns no org at sign-up
  by design), `loginAs` (dashboard login form), `apiMutation`/`apiGet`
  (authenticated `/api/v1/*` calls with the required `Idempotency-Key`).

## Notes / known gaps

- The dashboard has no `/signup` page and no edit/delete buttons for talent
  profiles on `main`; signup is covered at the API level and model
  edit/delete through the authenticated API the dashboard itself uses.
- `better-auth` sign-up has no confirm-password field, so there is no
  password-mismatch case to test.
