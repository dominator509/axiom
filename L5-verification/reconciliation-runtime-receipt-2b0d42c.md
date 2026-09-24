# Isolated workspace acceptance — 2026-09-17

Tested immutable source: `2b0d42cac2f192cde6a7e3ffbdaa700df3a2434a`.

Command: `node scripts/test-isolated-workspace.mjs --isolated-fixture`.

- Exit 0; Turbo 24/24 successful (5 cached).
- All 40 migrations applied to disposable database `axiom_workspace_test_00fefdacf02d4d6d`.
- API 744 tests, dashboard 461 tests passed, including five actual PostgreSQL variant-performance/locking tests and eight Safety-page tests.
- Worker 247 tests passed, including actual PostgreSQL/media processing.
- Dashboard build and mobile web export completed as part of the matrix.
- Harness confirmed disposable database removal and recovery database untouched.

This is not authenticated browser, native mobile, live provider, or production migration-upgrade acceptance. Test server still reports revision `da09f664cbe801ed45a63a62ad4ad8014c94c795` from the read-only deployment wrapper. Newer source is not installed there. Subsequent source edits are not covered by this exact-SHA receipt.
