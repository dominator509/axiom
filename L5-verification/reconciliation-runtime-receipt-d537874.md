# Local matrix receipt: d537874

2026-09-17. Exact source: `d53787420f4b880d911818ca9ed45b3f271c541c`.
The worktree remained clean throughout the executed application tests.

`node scripts/test-isolated-workspace.mjs --isolated-fixture` exited 0.
All 50 migration files applied to disposable fixture
`axiom_workspace_test_47b1c8aa6a4eb987`. Turbo reported 24/24 successful tasks,
five cached, 3m44.405s. The wrapper subsequently confirmed fixture removal.
No deployed database or provider was used or changed.

Observed test totals: API 906, dashboard 695, worker 298, connectors 387,
database 159, gateway 375, auth 28, MCP server 91, mobile 20, relay 272 and
core 21. Five database-readiness tests were skipped by this matrix because
they require the separate readiness fixture mode; they are not counted as
executed here. Dashboard production build and mobile web export completed.
Three existing dashboard test-file lint warnings and synthetic build-auth
configuration warnings appeared; no new warning-free claim is made.

This fixture applies SQL files directly using the existing isolated test runner;
it does not prove the live migration runner, deployment prerequisites, production
ledger atomicity, restored-copy upgrade, or database-aware rollback.

Boot preflight and repository verification printed `preflight: ok` and
`verify: ok`; graph output was ALL_DONE. Those markers do not close the
architectural gaps listed in LUNA_HANDOFF.md.

Hosted CI35285232940 for this exact SHA had test, lint, security, typecheck and
build successful; container was still running at the final observation.
Overall hosted success remains unproven at this receipt checkpoint.

Hermes task codex-d001a-r2-review-20260917 was re-read: still only its
23:00:44Z acknowledgment, not corrected R3 source or the requested callsite
inventory. No installer was executed or integrated. Deployment remains paused.

Next source feature work: recurring-digest status/failure recovery, followed by
verified pattern insights and actual Relay delivery; all broader reconciliation
and deployed/provider/browser requirements remain tracked in LUNA_HANDOFF.md.
