# Local matrix receipt: f1378c4

2026-09-17. Source: `f1378c4ba750ecb7c896ab4a80a4c944e70d1d6a`.
Clean worktree remained unchanged throughout the run.

`node scripts/test-isolated-workspace.mjs --isolated-fixture` exited 0:
24/24 Turbo tasks successful, four cached, 5m4.879s. All 49 migrations applied
to disposable fixture `axiom_workspace_test_a1ec351ccb325aab`, which was removed.
The recovered deployment database was not used or modified.

Observed package results include dashboard 694, worker 292, connectors 387,
gateway 375, auth 28, MCP server 91, mobile 20, and DB 159 passing tests.
Five DB-readiness tests are intentionally separate from this matrix (previous
focused readiness receipt); do not count the skipped tests as executed here.
Dashboard production build and mobile web export completed.

Hosted run 35281902829 passed all six jobs for the preceding `30cd883` commit.
Published `f1378c4` was verified by remote branch readback; its hosted run
35283023039 was still running at receipt time. No deployment was performed.

The next audit found digest reporting gaps: fractional engagement mislabeled as
a percentage; manual/mismatched/non-published metrics could enter aggregates;
cumulative snapshots were described without distinguishing lifetime totals from
weekly gains. These are addressed separately after this immutable matrix run,
not covered by its passing status.

Hermes's deployment-context corrections remain unintegrated. Its claimed author
directory restriction was removed from the task by permitting source delivery
in its own disposable scratch directory or as message text. Neither a promise
nor the original inadequate 30-test suite establishes a corrected installer.

Still open: remaining architecture features, corrected deployment machinery,
live migration/sidecar/worker acceptance, authenticated desktop/mobile coverage,
provider OAuth/publication/storage/network receipts, and deployment observability.
