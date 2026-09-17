# TEST deployment checkpoint — required before further feature work

Owner direction, 2026-09-17: deploy and test completed work before moving to other
fixes. This checkpoint supersedes the previous source-only milestone cadence.
Local unit tests, static markup and an older green CI run do not close it.

## Current evidence

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
