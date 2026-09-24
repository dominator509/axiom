# Local reconciliation receipt — 2026-09-17

Tested application revision: `64b35baa904f0a00a7cf75b9b115366a782b6f80`.

Command: `node scripts/test-isolated-workspace.mjs --isolated-fixture`.
Exit code: **0**. Turbo: **24 successful / 24 tasks**, five cached.
All 44 migration files applied to a fresh disposable PostgreSQL database.
Cleanup receipt confirmed removal of `axiom_workspace_test_7dd0ac0f55dd2e6e`;
recovery and deployed databases were untouched.

Selected package totals: API 744, worker 274, dashboard 477, mobile 20,
LLM gateway 370, connectors 294, database 152 tests passed. Dashboard production
build and mobile web export passed. This is the TypeScript workspace matrix,
not the complete Rust workspace or live-provider acceptance.
The scraper's separate locked Rust suite passed 18 tests at this revision.

Non-fatal build warnings remain: three explicit-any warnings in the media bundle
behavior test and synthetic build authentication-secret warnings. No production
credential was loaded for this fixture.

GitHub main branch protection readback: six required strict checks (typecheck,
lint, test, build, security, container), one approving review, stale-review
dismissal, admin enforcement, force pushes disabled, deletions disabled.
This is configuration evidence, not new-revision hosted CI evidence.

Live TEST remains `da09f664cbe801ed45a63a62ad4ad8014c94c795` per restricted
read-only server check. This receipt does not establish deployment, authenticated
browser acceptance, live migration upgrades, R2, VPN isolation or provider acceptance.
No paid generation or social publication was performed.
