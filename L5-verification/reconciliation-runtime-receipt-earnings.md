# Earnings and role reconciliation matrix — 2026-09-17

Source: `985f471bd1ea81f93f8dabfb99830cfbe98977ca` plus the two subscription
termination files committed alongside this receipt. No application edits during
the successful matrix. No deployment, production DB write, paid generation, or
social/DM dispatch.

## Executed evidence

- `node scripts/test-isolated-workspace.mjs --isolated-fixture`: first run exit 1.
  One real Windows login-wrapper cancellation test exceeded the two-second
  confirmation budget and returned an unconfirmed-termination error. No unsafe
  success was reported. Disposable DB `axiom_workspace_test_86e305a2bd2378fc` removed.
- Added a ten-second Windows native-tree confirmation budget (POSIX and no-PID
  paths retain two seconds), still requiring successful taskkill and wrapper close.
  Deterministic tests cover delayed taskkill confirmation after wrapper close and
  a missing confirmation that must fail closed at the new bound.
- Standalone process tests under the restricted sandbox fail because process-tree
  control is unavailable; those runs are not passes. With host process-control
  permission, all 49 subscription tests pass. Gateway typecheck passes.
- Full isolated matrix rerun: terminal exit 0, **24/24 tasks**, 6 cached build
  tasks, 46 migrations. API 829, dashboard 593, worker 275, gateway 373,
  connectors 306 tests pass. Dashboard production build includes Earnings/My shifts;
  mobile web export passes. No tests skipped to obtain this result.
- Disposable DB `axiom_workspace_test_77242aaa579f1cc8` removed after terminal
  success; recovered database untouched.
- `sh scripts/verify.sh`: `verify: ok`. This is the historical graph gate, not
  proof that reconciliation, deployment or production acceptance is complete.
- Existing three dashboard test lint warnings remain. API OpenAPI generation
  prints the fixture-auth warning; this is not live secret verification.

## Still open

Authenticated desktop/mobile acceptance, exact-revision hosted CI and deployment,
real Fanvue earnings OAuth/network verification, new human-role activation,
account-role management, live inbox/message delivery, and the remaining runtime
gates are unproven. L2.10 also requires scheduled Fanvue analytics ingestion and
top-spender tagging; the new read-through earnings page does not implement that
sync. MCP InboxTool still reads saved inbound touchpoints and rejects replies.
The full objective is not complete.
