# FanThynks Feature Reconciliation and Production Execution Plan

Date: 2026-09-16
Repository: `dominator509/axiom`
Working branch: `codex/telegram-webhook-hardening`

## Purpose

Reconcile the documented FanThynks architecture with the actual backend, worker, database, dashboard, mobile, provider, and deployment surfaces. Implement missing user-facing functionality in the existing architecture, and keep external/runtime gates explicitly separate from source-only evidence.

## Evidence rule

Each workstream is complete only when all applicable levels are recorded:

1. **Source:** schema, API/worker/runtime path, UI path, and authorization exist.
2. **Automated:** focused tests, package typechecks, and production-like build pass.
3. **Runtime:** deployed service, migration, sidecar, storage, network, or browser evidence exists.
4. **Provider/operator:** live OAuth, provider contract, account, DNS, secret, or human approval evidence exists.

Source and automated evidence never substitutes for a missing runtime or provider gate.

## Ordered execution queue

### 0. Baseline and control plane — source gates complete; release gates open

- [x] Read `AGENTS.md`, `COMMANDS.md`, ledger, preflight, graph, and ship gate.
- [x] Confirm `preflight: ok` and `verify: ok` on the current source state.
- [x] Preserve the existing dirty worktree; do not reset unrelated work.
- [ ] Re-run the final full test/build matrix in the hosted/deployment environment after publication.

### 1. Variant and A/B workflows — partial implementation; source and runtime gates open

- Inspect and extend the existing `asset_variant` model rather than creating parallel media state.
- Add an org/model-scoped experiment lifecycle: draft, running, paused, completed; candidate assignment; exposure accounting; winner promotion.
- Enforce consent, asset ownership, platform capability, and idempotency at every mutation.
- Add dashboard controls that show candidates, exposure, metrics, and the promoted winner; no direct publication from experiment controls.
- [ ] Full architecture gate: L1 F-15 caption/teaser variants and F-16 automatic winner promotion now have source paths, including published-post attribution, creation-fixed automatic evaluation, frozen evidence, audit, and replay-safe winner reward integration (M242–M264). These are not yet deployed/browser-accepted. Manual self-reported outcomes remain excluded from verified learning. Selected-guidance attribution and richer hook/timing behavior remain incomplete; keep this gate open until runtime acceptance and remaining requirements are satisfied.
- Current slice: candidate picker/preview, lifecycle, paginated assignment history, stable allocation and observed-outcome controls, confirmed manual winner, frozen completion, and idempotency on nested mutations. Allocations are not counted as proven views. Focused tests/typechecks pass; database concurrency, browser acceptance and deployed workflow remain open.
- Caption/teaser candidates now flow through owned review bundles, assignment-bound publication attribution, immutable publication snapshots, automatic evaluation and winner rewards (M243–M264). Remaining work includes selected-guidance attribution, richer hook/timing behavior and deployed acceptance; candidate creation alone is not the completion criterion.

### 2. Scraper orchestration — model egress corrected; provider/deployment gate open

- Reuse the authenticated Rust scraper sidecar and egress resolver.
- M265 corrects a discovered bypass: worker includes the persisted model ID; Rust resolves `EGRESS_PLANE_URL` using `EGRESS_PLANE_TOKEN`, requires exact healthy binding plus inactive kill switch, and uses the bound HTTP proxy with no direct fallback. Deployment must provide both egress settings to the scraper, not only to the worker/API. Sixteen Rust tests include a real local CONNECT-proxy rejection test; live VPN/provider and result-quality acceptance remain open.
- Add durable scrape-run state, model/org ownership, bounded request validation, worker dispatch, status/error reporting, and dashboard controls.
- M266–M267 preserve missing counts as unavailable, reject all-failed observations, display structured partial results, run at most ten concurrent proxy-bound lookups within the worker timeout budget, and refresh active research runs in the dashboard. Provider parsing and deployed isolation/browser acceptance remain open.
- Persist only provider responses that pass the existing data-retention and tenant checks; do not report an empty result as success.
- [x] Gate: worker/API contract tests pass; deployed sidecar rehearsal remains open.

### 3. Team collaboration and shift management — source and runtime gaps remain

- Add tenant-scoped team membership/role visibility, shift lifecycle, handoff notes, and bounded queue assignment using existing RBAC and RLS conventions.
- Expose the human workflow in a dedicated team/operations surface; keep infrastructure and secret controls out of content-team roles.
- M274 adds row-locked shift lifecycle transitions and explicit completion handoff notes; terminal shifts cannot be reopened/rewritten. Existing generic workspace operational roles do not yet satisfy the L1.0 Chatter persona restricted to assigned shifts/models. F-25 post-specific note ownership/UI and historical list pagination also remain open. Do not label the team feature complete from generic CRUD or navigation tests.
- M275 adds F-25 post-note ownership checks and the calendar read/write/pagination panel, with actual team mutation idempotency registrations. Focused route/UI checks pass; live multi-user acceptance and dedicated PostgreSQL post-note isolation evidence remain open. Chatter permissions and general team-list pagination remain incomplete.
- [x] Gate: authorization/RLS and dashboard navigation tests pass; multi-user browser acceptance remains open.

### 4. Clipping and adaptation controls — source slice complete; deployment gate open

- Wire dashboard clip/resize/transcode controls to the existing media-plane operations.
- Persist operation intent/status and support platform adaptation of captions and formats without bypassing ToS, consent, approval, or idempotency.
- Keep adaptation separate from publication; failed or pending transforms must be visible and retry-safe.
- [x] Gate: route/worker/media-plane contract tests pass; deployed image and video rehearsal remains open.

### 5. Playbook and guideline management — source slice complete; acceptance gate open

- Extend the existing playbook store into model/org-scoped editable guidelines with revision history and audit records.
- M272 found that the prior revision counter/audit retained no old values. Migration0044 and atomic route snapshots now retain values, with tenant/platform-scoped cursor history and no app-role overwrite permission. Database concurrency/isolation rehearsal passed; history GUI, stale-editor conflicts and live upgrade acceptance remain open. Missing past values are not reconstructed.
- M273 adds paginated history and explicit restore-as-draft in the editor, with mandatory expectedRevision conflict checks and receipt validation. Concurrent stale edits return one success and one409 in real PostgreSQL. A failed score no longer hides guidelines; failed guideline reads never offer editable defaults. History GUI/browser and live migration acceptance still require deployment.
- Connect guideline reads to scheduling, generation, caption adaptation, and analytics surfaces without silently overriding explicit user input.
- M269 wires F-55 into the calendar: current UTC-week pending/published counts versus saved per-platform targets, shortfall flags, explicit unknown state and guideline navigation. No schedule mutation. F-56 still has a confirmed gap in synchronous API caption enrichment; worker generation/revision already reads model guidelines. Browser acceptance and broader analytics integration remain open.
- M270 closes that synchronous caption gap with the same scoped guideline reader used by queued generation/revision. Each selected destination gets its own caption prompt and optional provider call, disclosed in the form. Real PostgreSQL verifies tenant/model/platform separation. This does not establish playbook coverage for every other AI path or live acceptance; continue the consumer audit.
- [x] Gate: CRUD/authorization, prompt integration, typecheck, and dashboard tests pass; scheduler/browser acceptance remains open.

### 6. External provider contracts — static contracts complete; live probes open

- Create versioned provider contract fixtures/tests for auth, upload, publish, status, metrics, and revoke.
- Correct capability declarations and connector behavior for the provider contracts that are actually supported; unsupported operations remain visibly unavailable.
- Use official provider documentation/SDK artifacts as the source for unstable contracts and record the version/date in the audit artifact.
- [x] Gate: deterministic connector contract tests pass locally; live sandbox/account probes remain open.

### 7. Live OAuth and publishing

- Verify callback, state/PKCE, credential storage, account display, refresh/revoke, and disconnect paths for each enabled connector.
- Prove publication only with an explicitly approved test account and a single approved asset; retain the receipt and disable publication afterward unless the owner explicitly changes that state.
- Keep social publication disabled while media-generation and approval tests run.
- Gate: live OAuth and one end-to-end publish receipt; source tests alone are insufficient.

### 8. R2 media storage — source verification complete; live bucket gate open

- Verify the configured bucket binding/endpoint and secret names using protected runtime configuration; never put credentials in source, logs, or this plan.
- Exercise write, read, metadata, checksum, retention, and deletion of one non-sensitive test object through the application storage abstraction.
- Add a fail-closed health/status surface and document cleanup/rollback.
- [x] Gate: application verification action and round-trip tests exist; live R2 round trip and deployment evidence remain open.

### 9. VPN/egress isolation

- Hosted SaaS requirement: customers supply their own compatible VPN subscriptions or WireGuard servers; AWS rehearsal gateways are temporary fixtures. Customer configuration must remain organization/model scoped.
- Added browser-local WireGuard configuration import into existing encrypted credential form. Validates single-peer IPv4 full-tunnel settings, rejects duplicate settings and unsupported hooks/DNS rather than silently discarding them. Twelve focused tests and dashboard typecheck pass. Focused ESLint invocation unavailable because eslint executable is missing from the installed package environment.
- Keepalive now flows from provider config import/manual form as a numeric value through the existing API, persistence and Rust tunnel command. Omitted values reset to zero instead of retaining a previous provider interval. Twenty-one focused tests, dashboard typecheck and diff check pass; importer also rejects inherited property names.
- Still open: provider DNS, MTU and dual-stack configuration support; hosted tenant isolation through the deployed egress service; browser import acceptance. Current import intentionally rejects configurations with those unsupported settings and is not evidence of universal VPN compatibility.

- Reconcile model-to-egress configuration, WireGuard/netns or SOCKS routing, kill-switch state, DNS behavior, and sidecar authentication.
- Prove no-egress behavior when the tunnel or allowed route is unavailable, and prove tenant/model isolation with safe endpoint checks.
- Do not enable unrestricted egress or alter the server firewall without a reversible, recorded change.
- Gate: privileged deployed network rehearsal; static configuration is not acceptance.

### 10. Browser and mobile acceptance

- Walk the authenticated desktop and responsive/mobile flows: sign-in, model selection, upload/gallery, generation, ToS, approval, scheduling, accounts, storage, team, playbook, reports, relay, and settings.
- Verify every visible navigation target resolves, every empty/error/loading state is understandable, and desktop/mobile controls are usable without accidental duplicate submissions.
- Use an existing authenticated session where possible; never paste credentials into automation or commit them.
- Gate: saved route-by-route acceptance evidence on the deployed test release.

### 11. Live migration rehearsal and execution — dry-run complete; live gate open

- Make the migration runner’s transaction ownership unambiguous and add a failure-injection rehearsal for migration plus ledger atomicity.
- Run a backup/restore rehearsal, apply migrations to the test deployment, verify RLS/privileges/indexes, and record rollback evidence.
- [x] Migration dry-run through 0034 passes. Production migration remains a separately approved operator action after the isolated fixture rehearsal passes.

### 12. Observability deployment

- M335 closes the empty-schema readiness false positive in source: required
  schema tables/columns and runtime SELECT access are checked against PostgreSQL
  catalogs. Five real database failure/positive cases and 69 API/unit tests pass.
  Liveness remains distinct. This is not a full schema/data integrity check and
  still needs deployment; TEST recovery and installer repair are tracked in the
  deployment checkpoint. Hermes supplies a source-only installer patch while
  Codex owns application reconciliation and integration review.

- Reconcile structured logs, request/job correlation, metrics, health/readiness, incident records, and provider/media audit events.
- Add deployment configuration checks for the selected telemetry backend, redaction, retention, and alert thresholds.
- Verify dashboards/alerts against a controlled failed job and recovery; do not treat a health endpoint as observability acceptance.

### 13. CI and branch-protection enforcement — protection verified; new release CI gate open

- Pin Node and pnpm to repository versions and require typecheck, tests, lint, build, migration checks, provider-contract tests, and security audit in CI.
- Make zero-test success impossible for production packages.
- [x] Classic branch protection API readback on 2026-09-17 confirms strict six required checks (typecheck, lint, test, build, security, container), one approving review, stale-review dismissal, admin enforcement, no force pushes and no deletions. This proves current enforcement, not permanent configuration or CI success on subsequent commits.
- Gate: hosted CI success for the audited commit and branch/ruleset readback. If GitHub credentials are unavailable, leave a precise operator command and mark the external gate open.

## Completion definition

### Inbox delivery checkpoint — 2026-09-17, M311

- Implemented pending reply preparation and conversation-scoped intent history. The authenticated actor owns a stable intent key; changed-content reuse conflicts, identical replay returns the original record, and creation writes one transactional audit without message text.
- Chatter preparation requires the exact assigned model and an active shift. Model access is read-only. Other write routes remain denied by the central role allowlist. The production route requires the shared Idempotency-Key middleware in addition to durable intent uniqueness.
- Evidence: 34 disposable PostgreSQL tests after 47 migrations, 11 policy tests, 58 application tests, 80 middleware registration tests, and API typecheck passed. No live provider message or deployment occurred.
- M312 adds the conversation-bound preparation composer and paginated status GUI, history-first recovery after reload, immutable retry keys/text and exact receipt validation. Model users see history without preparation controls. 25 behavior/page tests, typecheck and lint passed (three existing warnings). Text is not persisted in browser storage; no automatic provider calls or sends.
- M313 implements the durable dispatch claim and terminal-receipt service: fresh stored role, exact actor-owned intent, assignment/shift, active model/account, workspace safety and valid consent. Concurrent claims have one winner; dispatching/rejected/uncertain/sent records cannot be reclaimed. Late receipts can be persisted after shift expiry. 35 real PostgreSQL tests and API typecheck pass. This service is not yet wired to an HTTP send action or the provider.
- Architecture clarification: L2.5 requires forced-SFW prompts for public funnel agents. Human-written private Fanvue replies are a different path; do not silently replace their contract with public-agent restrictions. Agentic drafting/public-agent compliance remains separate unfinished work.
- M314 wires the provider service through model egress and encrypted credentials, with a mandatory awaited adapter callback after refresh. That callback commits a fresh access/safety/consent fence and rejects credentials rotated during setup. A captured transport plus real PostgreSQL proves one attempt under concurrency and uncertain outcomes without resend; 23 connector tests and 35 database tests pass. Connector/worker builds and API typecheck pass. No real provider was contacted.
- M315 mounts authenticated `POST /models/:modelId/inbox/replies/:replyId/send` requiring `{confirm:true}` and an Idempotency-Key. The inbox displays two-step send confirmation only for the preparing actor, stops duplicate clicks and transport retries, and requires refreshed history after unconfirmed delivery. Current role/shift/account/consent/safety remain server-enforced. 110 API/policy/registration tests, 28 GUI tests and 35 real PostgreSQL tests pass; API/dashboard typechecks pass and lint retains three existing warnings. No live message or deployment occurred.
- M317 adds actor-owned pending cancellation with explicit confirmation, a durable cancelled state and one audit event across retries. It works with publishing halted or the model inactive, makes no provider call and races atomically with dispatch. 35 real PostgreSQL tests, 114 API/policy/registration tests, 11 GUI behavior tests and both typechecks pass; lint retains three existing warnings.
- M318 adds migration 0047 for append-only operator review evidence on dispatching/uncertain attempts, with tenant/model/actor foreign keys, RLS, intent-key uniqueness and explicit operator attribution. An observed-send report must identify a provider message; an unresolved report cannot claim one. Neither changes the original delivery state nor re-enables dispatch. Twenty migration tests and 35 real PostgreSQL tests after 48 migrations pass; DB build and API typecheck pass. Review API/GUI wiring remains next. This is manual evidence, not automated verification of a provider receipt.
- M319 exposes scoped review creation/history with transactional audit, exact intent-key replay and conversation-independent reply-ID pagination. Exact retries survive a late provider receipt; new reviews require unresolved attempts. Current writer role, assignment and shift are checked; Model access is read-only. 35 real PostgreSQL tests after 48 migrations, 97 policy/registration tests and API typecheck pass. No provider call or live migration occurred.
- M320 adds per-reply operator review history and recording controls, including pagination, explicit human-evidence labels, a required provider UUID for observed-send testimony, stable retries and recovery from history. Original attempt state remains unchanged and reviews never authorize a resend. Model viewers have no recording controls. 35 focused GUI tests, dashboard typecheck and lint pass (three existing warnings). Hosted run 35235992820 passed all six checks on the earlier published 8a2ae2e; this does not establish hosted or live acceptance of these newer review commits.
- Still required: attachment handling, agentic drafting, role activation and authenticated deployed acceptance. Operator review evidence is implemented; it is not automatic proof of delivery or permission to resend. Pending intent creation is not message delivery.
- M336 wires message-bound attachment metadata through the existing model-egress
  connector, scoped inbox API and an explicit dashboard load action. Model/shift
  and account access are checked before and after provider reads. Signed URLs,
  provider filenames/owners and raw errors are omitted; missing media is reported
  unavailable, not fabricated. Listed price and amount paid remain separate.
  Forty-five connector/worker/API tests and 22 dashboard/page tests pass, along
  with worker build, API/dashboard typechecks and dashboard lint (three existing
  warnings). This is metadata only: authorized byte proxy, image/video playback,
  attachment sending and authenticated provider/browser acceptance remain open.
- Hermes D001 installer patch was inspected and rejected: it inferred live mode
  on missing rehearsal context, retained live Docker/admin access, omitted actual
  callsite propagation and contained non-executing test assertions. No patch was
  applied. Correlated review request `codex-d001-review-20260917` was acknowledged;
  complete source replacements and real helper tests are pending, not verified.

The requested feature-completion goal is achieved only when the full architectural requirements and their source, automated, runtime and provider/operator gates are evidenced on the deployed immutable release. Recording a blocker documents incomplete work; it does not complete the goal. Progress reports must contain commit SHA, test/build receipts, runtime URLs, migration receipt, provider receipts and unresolved gates as applicable; they must not label the product production-ready while any required gate is open.
