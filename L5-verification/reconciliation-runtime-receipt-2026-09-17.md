# Local reconciliation integration receipt

Tested source: `926fcb214e9c5579ebd80bcdae2344ee40925eba`.
Date: 2026-09-17. Environment: Windows host, isolated PostgreSQL 16 Docker fixture.

## Completed

- `node scripts/test-isolated-workspace.mjs --isolated-fixture`: exit 0.
- Turbo: 24 successful tasks out of 24; three cached prerequisite tasks.
- All 36 migration files through `0035_transformed_assets.sql` applied to a fresh disposable database.
- Dashboard production build compiled, generated pages and completed build traces. Mobile web export completed.
- Database: 152 tests passed, including live RLS, idempotency concurrency and character-lock concurrency checks.
- Worker: 229 tests passed, including 12 real-PostgreSQL media/lease/scan-handoff tests.
- API: 700 tests passed. Dashboard: 445 tests passed. Mobile: 20 tests passed.
- LLM gateway: 370 tests passed, including the previously failing subscription process-tree lifecycle tests.
- Connectors: 294 deterministic tests passed. These are not live provider acceptance.
- Harness confirmed removal of `axiom_workspace_test_68957496c506acb8` and exited 0.
- `node scripts/rehearse-migration-atomicity.mjs --isolated-fixture`: exit 0. Migration-body and ledger-write faults rolled back DDL; exact checksums, successful application, rerun skip and drift rejection passed.
- `sh scripts/verify.sh`: exit 0, `preflight: ok`, `verify: ok`. This checks repository control-plane markers, not deployed functionality.

## Boundaries and remaining work

- The new fixture is `axiom-ci-local-6cefdc1`, label `axiom.purpose=isolated-ci-validation`, published only on `127.0.0.1:55432`. Its database storage is ephemeral tmpfs. The existing application database was not modified. The empty fixture remains available for further integration checks.
- The full-workspace harness applies migrations with its own transaction wrapper. The separate fault-injection harness exercises the real migration runner against synthetic fault migrations. Neither is an upgrade/backup-restore rehearsal of the Contabo database.
- Three non-fatal explicit-any lint warnings were reported in the new dashboard behavior test. No production type or build error was reported.
- Better Auth reported weak synthetic build-fixture configuration warnings. This is not evidence about deployed secret strength.
- No dependency update, deployment, real OAuth, paid generation, R2 object mutation or social publication occurred in this run.
- Live feature acceptance, deployed migration, provider contracts, tenant egress isolation, observability and GitHub enforcement remain open. Green automated tests do not establish that every architectural feature is implemented.
