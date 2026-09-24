# Model assignment and staged role batch — local acceptance

Date: 2026-09-17. Application revision: `d37405ce1e4edf83ccb1cfb28e963a94115f8ac2`.
Worktree was clean at dispatch and application source was unchanged during the run.

Command: `node scripts/test-isolated-workspace.mjs --isolated-fixture`.

- 46 migrations applied to a fresh disposable PostgreSQL database.
- 24/24 Turbo tasks passed, none cached; process exit code 0.
- API: 801 tests; dashboard: 509; worker: 275; mobile: 20; auth: 28.
- Dashboard production build and mobile web export completed.
- Fixture `axiom_workspace_test_0910cfe7871ab4cd` removed; recovered database untouched.
- Existing non-fatal explicit-any test lint warnings and synthetic build-auth
  secret-strength warnings remain; this run did not change dependencies or secrets.

The batch covers tenant-bound assignments, owner grant/revoke GUI/API, staged
model/shift read policy, owned media byte/range access, saved fan CRM isolation,
Creator preparation/staging, and creation-time requested scheduling. PostgreSQL
tests exercise actual persistence and queue rows without running job workers.

## Boundaries still open

This is local build/test evidence, not production readiness. New human roles
remain rejected by normal API authentication pending complete policy/navigation
and account-management implementation. Existing schedule-request editing, live
DM orchestration, restricted-role browser/mobile acceptance, live migration
upgrade/restore, provider contracts/OAuth/publication, storage/egress and deployed
observability evidence remain within the overarching reconciliation goal.

No deployment, social publication, live-user media access or paid provider call
was performed in this batch. The receipt commit changes documentation only;
hosted CI must independently validate its pushed SHA.
