# TEST deployment checkpoint — required before further feature work

Owner direction, 2026-09-17: deploy and test completed work before moving to other
fixes. This checkpoint supersedes the previous source-only milestone cadence.
Local unit tests, static markup and an older green CI run do not close it.

## Current evidence

### M335 recovery/readiness update (supersedes historical live-state claims below)

- Following the server-side rehearsal incidents and recovery, Hermes's correlated
  bridge reply `codex-evidence-correction-20260917-01` (21:33 UTC) reports fresh
  PostgreSQL evidence: 28 ledger rows, newest `0027_asset_origin.sql`;
  `media.generate` and `tos.scan` done, one `relay.card` job ready, and zero
  `relay_card` records. No replay or workspace-setting change is authorized by
  those observations. API/dashboard remain on da09f66; worker and four sidecars
  remain stopped per the recovery handoff. These server facts are Hermes evidence,
  not an independently executed Codex database inspection.
- The installed installer remains prohibited: repeated live-default resolution
  defects reached live services/database during supposed rehearsals. D001 asks
  Hermes for a source repair and propagation tests as reviewable patch text only.
  No installation, live grants/migrations/restores or service changes are part of
  that delegation. Existing source copies and their hashes were delivered through
  the bridge; a repair and independent review are still pending.
- M335 replaces readiness's `SELECT 1` with a catalog/privilege check derived from
  the application's schema. All required public tables and columns must exist and
  be readable by the runtime role. Liveness remains separate; readiness failures
  return the existing generic 503 without database diagnostics.
- Evidence: 69 focused API/DB unit tests, five actual PostgreSQL tests after all
  48 migrations, API/DB typechecks, DB build and DB lint pass (11 existing lint
  warnings). Empty schema, missing table/column and revoked SELECT each fail
  readiness, with transactional rollback and a subsequent positive check.
  Disposable fixture `axiom_workspace_test_275c8b5887eb946f` was removed.
- This check does not prove backup completeness, tenant data integrity, column
  types, constraints, migration checksums, RLS correctness or provider readiness.
  It has not been installed on TEST. Exact-SHA CI, deployment repair, migrations,
  service startup and authenticated browser acceptance remain open.
- Owner has resumed feature reconciliation alongside bounded Hermes server work.
  Continue source work without treating pending deployment as completed acceptance.

### M334 validation update (supersedes earlier pending results below)

- Hosted run `35247803764` completed successfully for exact source
  `120f143ffe25c3ee3fa469736c24ac79c858c45d`: all six jobs, including container
  builds/smoke tests, security, test, typecheck, lint and build.
- The local full matrix now passes with M334's test-only/harness corrections:
  24/24 tasks, all 48 migrations; API 889, dashboard 676, worker 287,
  gateway 375, connectors 364, auth 28, DB 152, MCP server 91, mobile 20,
  core 21, relay 272 and Fanvue MCP 77 tests passed. Fixture
  `axiom_workspace_test_dea65c8028af8068` was removed; recovery was untouched.
  This run used 120f143 plus the three reviewed M334 test/harness files before
  committing the receipt. Do not describe it as a clean-120f143 local pass.
- API and worker typechecks, harness syntax check and repository verify gate pass.
- Failures before that pass remain part of the record: the reply-dispatch scenario
  exceeded its generic 30s budget; worker claim tests consumed API-created jobs
  under a shared seed model; a real Windows login child exceeded the test's 5s
  deadline during concurrent builds. The fixes use a dedicated worker model,
  an explicit 120s budget for the multi-transaction dispatch scenario and an
  active-shift fixture whose expiry is tested explicitly. The local Windows
  harness limits package-level concurrency to two; concurrency/race assertions
  and process-termination deadlines remain unchanged. An initial pnpm forwarding
  typo failed before tests; corrected syntax passed a dry run and the full matrix.
- M334 changes no production application logic. Its successor commit still needs
  publication and exact-SHA CI before the chosen immutable installation.
- No live installation or browser acceptance has occurred. No new bridge handoff
  was found in the server handoff directory at the latest inspection. Continue
  this deployment checkpoint, not new feature work.

- Feature candidate source: `487d531dbe27772d28750fe42069f0115c09a271`.
  **Not installable yet:** its full local matrix failed one chronological fixture
  assertion. The M333 successor corrects that fixture and must receive a fresh
  full-matrix run and exact-SHA CI before installation. Resolve the successor SHA
  from git and freeze it in the installer receipt; never choose a moving tip.
- Existing PR: #14, branch `codex/telegram-webhook-hardening`.
- Hosted CI `35243295341` succeeded for **85ccabb70809da1003c644813640d0276c14e649**,
  not the candidate above. Candidate publication and exact-SHA CI remain required.
- Remote readback confirmed `487d531dbe27772d28750fe42069f0115c09a271`; its CI
  `35247200425` was in progress at last observation, not confirmed green.
- Local full matrix on that source exited 1: 17/20 tasks completed before abort,
  one viral-retrieval assertion expected 20 views but read 10. The fixture mixed
  JS wall time with PostgreSQL transaction-start `now()`. A slow setup reversed
  the intended timestamps. M333 uses the same database clock for both observations;
  no production behavior or assertion was weakened. Seven focused real PostgreSQL
  tests after 48 migrations and worker typecheck pass. Full rerun remains required.
- Read-only SSH on 2026-09-17 reports TEST release
  `/srv/fanthynks/releases/da09f66`, HEAD
  `da09f664cbe801ed45a63a62ad4ad8014c94c795`, dirty=0.
- The installed root-owned `fanthynks-test-op` explicitly has no writes/install/
  migration/restart operation. Codex's only sudo grant is this wrapper.
- Its revision command uses a hardcoded release path. After installation, verify
  actual systemd ExecStart/working directories and process paths as well as git;
  a stale wrapper path is not proof of the running revision.
- There are 21 additional migration files (0027–0047) relative to the deployed
  source. Inspect the live migration ledger; never infer unapplied migrations
  solely from this file diff. No live migrations have been applied in this step.

## Controlled installer handoff (Hermes)

Install the exact validated M333-or-later successor into FanThynks TEST only after it is available
on origin and exact-SHA CI is green. Do not deploy an advancing branch tip.
Read the existing server handoff and preserve credentials, R2 configuration,
model-scoped worker configuration, service ownership and unrelated applications.

1. Capture running revision, units, ports, schema ledger and rollback state.
2. Back up the test database privately; prove restore and migration upgrade on
   an isolated copy with the candidate's migration runner and checksum ledger.
   Do not rewrite historical ledger checksums to force an upgrade through.
3. Build a fresh immutable release using repository-pinned toolchains and frozen
   dependencies. Reconcile any old dist-only patches; never transplant them.
4. Perform controlled TEST migration/cutover only after rehearsal succeeds.
   Preserve scoped media-only execution and disabled social publication. Do not
   send DMs, publish posts, or dispatch paid generations as an install smoke test.
5. Verify actual running paths and exact git SHA; service health and API health;
   migration ledger; app-account readability; sanitized startup errors. On failure
   use the recorded app+database rollback strategy, not blindly an old binary
   against an incompatible schema.
6. Supply a sanitized installation receipt and an updated read-only revision
   operation referencing the actual release. No credentials in receipts.

## Authenticated acceptance — remains open

Test desktop and mobile widths against the installed SHA, using test fixtures.
Record URL, role, action, expected/actual result and console/network errors.

- Login, primary/talent navigation, Safety page (owner and non-owner), recovery
  UI on unavailable status; do not toggle live safety just to inspect the page.
- Member roles, assignments, shift access and session revocation using dedicated
  test users, with cross-tenant and unassigned denial.
- Existing completed vase asset through gallery/preview/review. Caption draft
  editing, posting request and rescan; no social publication. Reuse media rather
  than duplicate paid generation. Confirm real job completion, not queue status.
- Grok/R2 settings access, verification state and protected storage flow without
  exposing credentials. Verify provider access separately from a local file.
- Variants, scraping, clipping, playbooks, team notes/shifts, inbox and analytics:
  validate each installed user-facing workflow against the reconciliation matrix.
  Missing provider configuration must be recorded as unverified, never passed.
- Attachment previews are still under construction: M332 supplies the provider
  resolver only. Deployment does not make that incomplete GUI feature complete.

No new feature batch until this checkpoint is completed or the owner explicitly
changes the sequence. Deployment access/install and authenticated acceptance are
currently open, not silently waived.
