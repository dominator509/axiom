# Hermes Functional Acceptance Matrix

**Status:** canonical source-only delivery gate

**Owner:** Codex reviews, integrates, commits and pushes. Hermes implements in an
isolated source copy and returns evidence. Hermes must not commit, push, deploy,
run the installer, touch the live database, use provider credentials, restart a
service, or change permissions.

**Authority:** the current user instruction, `AGENTS.md`,
`L5-verification/architecture-reconciliation-current.md`,
`L5-verification/feature-reconciliation-execution-plan.md`, and
`L5-verification/L5.0-test-matrix.md`. This matrix makes the acceptance
criteria executable; it does not add capabilities that those documents do not
authorize.

## 1. What “pass” means

A Hermes lane is **SOURCE-PASS** only when every mandatory criterion in its row
below is evidenced. A route existing, a page compiling, a pure TypeScript
contract, a copied baseline, a hash list without tests, or an ACK is not a
pass.

Each DELIVERY must include all of the following, with no secrets:

1. The exact source commit/ref used and the isolated artifact path.
2. Every changed file, its repository-relative path, and independently
   reproducible SHA-256.
3. Exact commands and exit codes for focused tests, typechecks and builds that
   are relevant to the lane.
4. Behavior-level evidence for every mandatory criterion, including negative,
   authorization, tenant/model-scope and idempotency cases where applicable.
5. A changed-file summary proving the implementation is real and not a
   contract-only copy.
6. `LIVE_ACTIONS: NONE` and an explicit statement that no deployment, live
   database, migration execution, provider call, credential, permission,
   network or service action occurred.
7. A unique reply WIRE, exact `IN_REPLY_TO`, `READ_STATUS: READ`, and the exact
   final signature `sincerely, Hermes`.

The source gate and external gate are separate. Missing live provider
credentials, a production OAuth consent, a deployed browser session, a real
R2 bucket, or hosted branch-rule readback may keep an **EXTERNAL-PENDING** gate
open, but must not block a valid source DELIVERY. Hermes must implement local
fixtures, redacted provider responses and deterministic tests instead of
claiming that an unavailable external system is a source defect.

## 2. Finite ACK/NACK control loop

The communication loop is deliberately finite and does not use dates, clocks,
timestamps, TTLs or filesystem mtimes. Use only logical `SEQ`, `WIRE` and
`IN_REPLY_TO`; the transport `sent_at` remains the compatibility sentinel
`1970-01-01T00:00:00Z`.

1. Hermes sends one unique `ACK/ACCEPTED` with a new reply WIRE. Reusing the
   TASK WIRE is invalid and is a NOT-ACK.
2. Hermes sends one `PROGRESS` only after a real evidence delta exists: changed
   source paths, a newly passing behavior test, or a precisely named external
   blocker. “Investigating” is not progress.
3. Hermes then sends exactly one `DELIVERY` or one terminal `NACK/BLOCKED`.
4. Codex audits the complete matrix row once. If correctable source defects
   exist, Codex sends one receipt listing the failed criterion IDs and the
   exact expected evidence. Hermes gets one correction cycle.
5. If the same criterion fails again, or the blocker is external and fully
   evidenced, Hermes must send terminal `NACK/BLOCKED` naming the criterion,
   blocker, attempted command/result and the smallest owner action needed. No
   third retry, repeated ACK, or repeated unchanged PROGRESS is allowed.
6. Codex records one of `ACCEPTED`, `REJECTED-ONE-CORRECTION`,
   `BLOCKED-HERMES`, or `EXTERNAL-PENDING`, then advances to the next
   independent lane. One lane cannot freeze the entire program.

Hermes must not broaden a lane because another gap is visible. If a requested
criterion conflicts with the current architecture, return `NACK/BLOCKED` with
the exact conflict; do not invent a parallel model, route, provider capability
or migration.

## 3. Lane acceptance criteria

### F-89 — Localization and language switching

**Canonical contract:** `en`, `es`, `ja`, `it`, `pt-BR`, `de`; UI language is
separate from creator/model content language.

Mandatory pass criteria:

- The shared locale catalog contains all six locales and has a completeness
  test that fails on missing keys, raw UI keys, or fallback-only translations.
- BCP-47 normalization is canonical and deterministic (`pt`, `pt-BR`, case and
  separator variants included); unsupported values fail closed to `en`.
- Resolution is tested in the required order: user preference, organization
  default, browser `Accept-Language`, then `en`. User/org writes are tenant,
  user and role scoped and use the existing bounded, authenticated,
  idempotent/audited preference contract.
- Dashboard and mobile have real reachable selectors that load persisted state,
  save through the authenticated mutation, show loading/success/error/retry,
  and remain correct after reload. A callback that is optional or reports
  success without a durable response is a failure.
- The actual dashboard layout/settings route and actual mobile dashboard screen
  render the selector; an isolated unused component does not pass. Document
  language metadata changes and formatting use the selected locale.
- Focused API/core, dashboard reachable-surface, mobile screen/endpoint,
  typecheck and production-build commands pass. Live translation-provider and
  deployed browser acceptance remain external gates.

### F-90 — FanThynks platform referral/affiliate program

This lane is only for partners referring creators to the FanThynks SaaS. It is
not a tenant-owned affiliate builder, creator resale control, provider referral
feature, or white-label licensing plane.

Mandatory pass criteria:

- The model is platform-scoped and separates program, partner, campaign/link,
  click, identity stitch, referred creator/customer conversion, commission,
  reversal/refund, payout export, fraud hold, disclosure/consent, audit and
  idempotency events. Provider earnings `referrals` must not be reused.
- Attribution and commission facts are immutable, replay-safe and
  recomputable. Reversal, duplicate click/conversion, fraud hold and
  disclosure-not-accepted cases have behavior tests.
- Owner-only operations are enforced in API and UI; partner views expose only
  their own permitted aggregates. RLS/org/platform scope and audit records are
  tested, including cross-partner denial.
- Dashboard controls are real: partner onboarding/revocation, disclosure-gated
  activation, campaign/link creation, reporting, hold resolution and payout
  export. No page-only controls or fabricated totals.
- Any imported affiliate stack must first pass the documented license/security
  gate: source available for audit, license permits modification and
  redistribution/resale as required, dependencies are reviewable, no hidden
  telemetry or credential exfiltration, active maintenance evidence, and a
  reproducible SBOM/security review. If it fails any item, do not import it;
  continue with the native PostgreSQL/RLS/API/worker/dashboard implementation.
- Authored migrations may be delivered as source, but no migration may be
  executed by Hermes. Focused API/schema/dashboard tests and build/typecheck
  evidence are required.

### F-91 — Patreon creator/community integration

Patreon is a read/sync/event integration. Do not claim Patreon publishing,
DMs, payouts, member mutation or unsupported analytics.

Mandatory pass criteria:

- Model-scoped OAuth/PKCE start, callback, revoke and status routes use the
  existing encrypted credential, state/nonce, egress, RLS and audit patterns;
  minimum provider scopes are explicit and no secret appears in a response,
  log, fixture or receipt.
- The provider adapter reads campaign identity, memberships, tiers and posts
  using explicit fields/includes and cursor pagination. Null/hidden member
  identities are safe and no email/address is requested by default.
- Sync persists a checkpoint, is idempotent, is replay-safe, handles cursor
  continuation and records a reconciliation result. Duplicate and partial
  provider responses have tests using redacted fixtures.
- Webhook verification uses bounded request bodies, the official signature
  header, constant-time HMAC comparison, event idempotency and replay
  rejection. No webhook path performs an unsupported provider write.
- Dashboard and mobile expose connection status, last sync, manual sync,
  loading/error/empty states, reconciliation receipt and truthful manual-assist
  or unsupported-publish status. A backend-only connector does not pass.
- Focused route, provider-fixture, pagination, OAuth isolation, signature,
  replay/idempotency, dashboard/mobile, typecheck and build tests pass. Live
  Patreon consent and provider acceptance remain external-pending.

### Variant/A-B workflows

- Existing `asset_variant` and publication/evidence models are extended rather
  than replaced. API/UI can create a bounded experiment, assign variants,
  record eligible outcomes, freeze evidence, select/promote a winner and
  replay safely.
- Winner promotion requires the architecture’s attribution, audit, ToS and
  approval interlocks; self-reported or incomplete outcomes cannot enter
  learning. Duplicate outcome and cross-model access tests pass.
- Dashboard controls show experiment status, variants, evidence and terminal
  outcome/error states. Route existence without a reachable control fails.

### Media gallery and lifecycle

- Uploaded source, generated asset, transformed output, image/video kind,
  lineage, preview descriptor, processing status, ToS/approval status and
  failure/retry state are persisted through the existing asset model.
- One authenticated, paginated gallery can filter source/generated and image/
  video without losing filters across cursors; it displays real preview/view
  controls for upload, image, video and generated outputs and handles missing
  or failed media without exposing unsafe URLs.
- Upload/source selection, generation result, transform result and gallery
  navigation are wired end-to-end in dashboard and mobile tests. No second
  parallel storage model is allowed.

### Scraper orchestration and result quality

- Dispatch uses the authenticated Rust scraper and model-bound egress resolver;
  there is no direct-network fallback. Run history, cursors, provider/source
  attribution, partial results, per-source failures and terminal status are
  persisted.
- Empty, partial, mixed-success and all-failed runs are distinguished; result
  quality is not inferred from HTTP 200 alone. Retry is bounded and idempotent.
- Dashboard exposes start/status/history/results/error/retry with real
  pagination and no fake success. Rust, worker, API and UI behavior tests pass.

### Team, shifts and Chatter

- Existing RBAC/RLS, assigned shift/model checks and terminal shift lifecycle
  are enforced in every route and UI mutation, including assignment revocation,
  expiry, handoff, post-note ownership and bounded history pagination.
- Chatter supports either an assigned human or an approved LLM actor. LLM
  actors require model-scoped permission and an active assigned shift.
- Roleplay state has durable conversation cursor, bounded ordered memory,
  revisioned `soul.md`/persona content, suggested-personality selection and
  manual authoring. Reload/handoff preserves state without leaking across
  org/model/actor boundaries.
- Grok roleplay dispatch uses the existing provider transport and produces a
  redacted provider receipt; unavailable providers show a truthful queued or
  manual-assist state. Dashboard/mobile controls are reachable and tested.

### Playbooks and guideline management

- Playbooks/guidelines have model/org scope, revision history, optimistic
  concurrency, audit and owner/editor authorization. Reads return the selected
  revision deterministically.
- Every claimed consumer named by the architecture (generation/revision,
  captions, Chatter roleplay, scraper/analytics where specified) is wired to
  the same scoped reader. Tests prove a selected guideline changes the actual
  prompt/decision input and that another tenant/model cannot read it.
- UI supports create/edit/revise/select/restore or explicit archive, with
  loading/error/empty states. A CRUD page with no consumer evidence fails.

### Clipping and adaptation controls

- Dashboard/mobile controls send bounded clip/resize/transcode/adaptation
  options to the existing media-plane operation contract; options, source
  lineage, output asset, status, progress/error and retry are persisted.
- Invalid dimensions/durations/codecs, unauthorized source access, duplicate
  requests and failed operations are rejected or replay-safe. Result previews
  and download/view controls are real and scoped.

### External provider contracts and OAuth/publishing

- Every provider capability is represented by an explicit adapter contract with
  auth, scopes, rate limits, request/response fixtures, redaction, retry and
  capability matrix. Unsupported operations are represented as `none` or
  manual-assist, never silently emulated.
- OAuth state/PKCE, encrypted credentials, model/org scope, revoke, connection
  status, idempotency and audit are wired to real routes and UI. Publishing
  requires approval/ToS/kill-switch/egress controls and has no implicit
  fallback path.
- Source tests cover valid/invalid signatures or callbacks, token failure,
  rate limit, duplicate publish, revoke and cross-tenant denial. Live provider
  calls are external-pending, not a reason to invent fixtures as production
  proof.

### R2 media storage

- R2 configuration is represented by a secret-free status/configuration
  contract, scoped credentials and bucket/key policy. Media descriptors use
  bounded signed access, content type/size checks, retention and deletion
  semantics.
- Upload, generated output, preview and failed-upload paths can resolve the
  same descriptor contract and are covered by local storage fixtures. No
  credential or bucket mutation may occur in Hermes’ source lane.

### VPN/egress isolation

- Every provider-bound operation resolves an explicit model/account egress
  binding; missing, unhealthy, mismatched or kill-switched bindings fail closed.
- Tests prove no direct-network fallback, no cross-model/profile route,
  loopback/private-target rejection as required, redacted health evidence and
  deterministic retry behavior. The source lane must not modify host firewall,
  WireGuard, VPS, DNS or live network state.

### Browser/mobile acceptance

- For each implemented feature, the actual authenticated desktop and mobile
  surfaces are reachable from primary navigation or a clearly labeled settings
  location. No dead tab, unlinked page, question-mark link or orphan route is
  accepted.
- Each surface has uniform responsive controls, accessible labels, keyboard/
  touch targets, loading/empty/error/success/retry states, safe spacing and no
  horizontal overflow at the repository’s desktop and mobile breakpoints.
- Source-level browser/component tests may close the source gate; real deployed
  multi-user desktop/mobile browser runs remain a separate external gate.

### Live migrations and release rehearsal

- Hermes may author migrations and deterministic restore/rehearsal tests only.
  It may not execute live migrations, restore live databases, switch releases,
  restart services or run the installer.
- Source gates require explicit target context, no live-default helper, bounded
  destructive operations, checksum/ledger validation, ownership/RLS checks,
  backup-before-migrate, failure injection and database-aware rollback tests.
- Live rehearsal, operator approval and immutable TEST activation are external
  gates owned by Codex/operator procedures.

### Observability

- Claimed workflows emit structured correlation IDs, state transitions,
  duration/error counters and audit events at the API/worker/media/provider
  boundaries. Logs and metrics redact credentials, tokens, signed URLs and
  member PII.
- Dashboards/health surfaces distinguish dependency health from workflow
  success and expose stuck, failed, retrying and recovered states. A 200 health
  endpoint alone is not observability evidence.
- Source tests cover redaction, correlation, failure emission and recovery
  aggregation. Controlled live failure/recovery is external-pending.

### CI and branch-protection enforcement

- Repository workflows pin the required Node/pnpm/Rust/tool versions and run
  lint, typecheck, focused/full tests, build, migration checks, provider
  contract tests, security and container checks for the exact candidate SHA.
- A source DELIVERY must include workflow/config diffs and local validation
  output. Hosted CI success and GitHub branch/ruleset readback are external
  gates; do not claim them from a YAML file or local run.
- No force-push, branch-rule weakening, dependency upgrade or generated build
  artifact is accepted as a substitute for source changes.

## 4. Codex review decision table

| Result | Meaning | Next action |
|---|---|---|
| `ACCEPTED` | Every mandatory source criterion in the lane row passed | Codex audits diff, integrates, commits and pushes; external gates stay listed separately |
| `REJECTED-ONE-CORRECTION` | One or more named source criteria failed, but are locally correctable | Hermes gets one exact correction list; no broad rewrite |
| `BLOCKED-HERMES` | Same criterion failed after correction, or artifact/correlation/evidence is still absent | Hermes sends terminal blocker; Codex advances to another lane and records the blocker |
| `EXTERNAL-PENDING` | Source criteria pass; only provider, live DB, browser, deployment or operator evidence is unavailable | Do not rewrite source to chase it; schedule the external gate separately |

This matrix is the passage contract for all future Hermes tasks. A task message
may narrow a row, but it may not weaken these criteria or convert an external
gate into a source claim.
