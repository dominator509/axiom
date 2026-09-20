# FanThynks Feature Reconciliation and Production Execution Plan

Date: 2026-09-18 (reconciled against L1/L2/L3 and the current static audit)
Repository: `dominator509/axiom`
Working branch: `codex/telegram-webhook-hardening`

**Agent continuation entry point:** `../LUNA_HANDOFF.md` contains the current
SHA/CI checkpoint, ordered next actions, gap list and Hermes review status. Keep
it synchronized with this cumulative plan and `.agent/state/LEDGER.md`.

The current source-grounded reconciliation is recorded in
`L5-verification/architecture-reconciliation-current.md`. It is the factual
status companion to this execution plan; it does not waive runtime/provider
gates or convert planned architecture into implemented functionality.

## Purpose

Reconcile the documented FanThynks architecture with the actual backend, worker, database, dashboard, mobile, provider, and deployment surfaces. Implement missing user-facing functionality in the existing architecture, and keep external/runtime gates explicitly separate from source-only evidence.

## Evidence rule

Each workstream is complete only when all applicable levels are recorded:

1. **Source:** schema, API/worker/runtime path, UI path, and authorization exist.
2. **Automated:** focused tests, package typechecks, and production-like build pass.
3. **Runtime:** deployed service, migration, sidecar, storage, network, or browser evidence exists.
4. **Provider/operator:** live OAuth, provider contract, account, DNS, secret, or human approval evidence exists.

Source and automated evidence never substitutes for a missing runtime or provider gate.

## Active execution sequence — M354 onward

Codex leads the integration loop and Hermes performs one bounded source-coding
batch at a time. Hermes may not invoke the installed deployment helper or touch
live state. Codex audits the delivered source and tests, integrates only after
review, runs the owning checks, commits and pushes, then advances the queue.

1. **Active target-context repair (M354):** eliminate ambient live DB/service/
   rollback target resolution in the installer and bridge; add positive and
   negative tests for the three prior incident classes and verify exact source
   hashes before integration.
2. **Next product-contract nodes (not numbered until committed):** close only
   the open L1/L2/L5 rows: variant/A-B evidence, scraper result quality,
   team/shift/post-note restrictions, clipping/adaptation, playbook consumers,
   F-81/F-84/F-85 recipe/reward/insight gaps, and Relay delivery/reconciliation.
3. **Media/storage node:** the static audit says the persistent uploaded/
   generated image/video gallery is incomplete. Complete it using existing
   asset/media-operation/storage contracts, then prove playback, transforms,
   approval/retry visibility and the configured R2 application round-trip.
   The existing sanitizer is file-level only and explicitly reports
   `externalProvenanceErased: false`; C2PA/external provenance/fingerprint
   removal is not an established feature and must not be claimed.
4. **Provider/network nodes:** preserve L2.4's boundary: Native link-in-bio
   is production-enabled; Fanlynks/Linktree/Beacons are optional planned
   adapters, not required or enabled by a database row. Verify only explicitly
   enabled provider contracts/OAuth/publish receipts, and finish customer
   BYOVPN/WireGuard per-model fail-closed egress. AWS is rehearsal evidence.
5. **UX acceptance node:** reconcile all backend capabilities to the
   signed-in desktop/mobile navigation, error/loading/empty states, dead-link
   repairs, retry flows, gallery controls and responsive visual QA.
6. **Release gates (numbered only when committed):** isolated migration/
   rollback and immutable TEST
   deployment, worker/media/data-path readiness, observability/alerts,
   exact-SHA CI, branch protection and final operator/provider acceptance.

Every numbered item stays open until source, automated, runtime and
provider/operator evidence are individually recorded. Passing local tests or
health endpoints alone never closes a gate.

### Architecture fidelity constraints

- L1.1 is the feature catalog; L2 documents the intended boundaries; L3
  defines contracts; the L5 static audit records what is actually wired. A
  navigation label, table, unit test, or health endpoint is not feature or
  runtime acceptance by itself.
- L2.4 explicitly keeps external link-in-bio adapters optional and hidden until
  their provisioning/OAuth/revocation/synchronization/analytics lifecycle is
  implemented. The Native provider is the current default.
- L2.9 explicitly distinguishes the repository's internal crash sink from the
  external GlitchTip/Sentry, Loki, Prometheus/Grafana and OpenTelemetry runtime
  integrations. Those integrations remain deployment evidence, not current
  bundled capability.
- `packages/worker/src/media-sanitizer.ts` and its scripts are source evidence
  for bounded file/container sanitization only. They do not establish removal
  of external provenance or byte-level identity, and the current CLI reports
  that limitation.

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
- M338 implements generation-time caption-guidance receipts (migration0048):
  selected arm, selection context, exemplar identities and SHA256 of actual output.
  Synchronous enrichment and queued generation/revision persist the receipt only
  for a successful caption result; fallback/manual/legacy captions have no invented
  receipt. Queued generation/revision uses a matching existing publish intent's
  time context when available. First-dispatch snapshots retain guidance only when
  the final staged caption still matches; subsequent learning uses the immutable
  snapshot rather than mutable bundle captions. Observed structure remains separate
  from selected guidance: selection is not evidence of compliance or causality.
- M338 evidence: 81 focused generation/publication/learning/API tests and seven real
  PostgreSQL retrieval/learning tests pass after all 49 migrations. Fixture
  `axiom_workspace_test_390b0d754029ea54` was removed; recovered/live data untouched.
  DB/worker builds and API typecheck pass; worker lint has existing warnings, with
  the newly exposed unused catch binding removed. No live migration or deployment.
  Wider hook/format/timing arms, guidance insight presentation and live acceptance
  remain incomplete; the full F-84 gate is not closed by receipt persistence.

### 2. Scraper orchestration — model egress corrected; provider/deployment gate open

- Reuse the authenticated Rust scraper sidecar and egress resolver.
- M265 corrects a discovered bypass: worker includes the persisted model ID; Rust resolves `EGRESS_PLANE_URL` using `EGRESS_PLANE_TOKEN`, requires exact healthy binding plus inactive kill switch, and uses the bound HTTP proxy with no direct fallback. Deployment must provide both egress settings to the scraper, not only to the worker/API. Sixteen Rust tests include a real local CONNECT-proxy rejection test; live VPN/provider and result-quality acceptance remain open.
- Add durable scrape-run state, model/org ownership, bounded request validation, worker dispatch, status/error reporting, and dashboard controls.
- M266–M267 preserve missing counts as unavailable, reject all-failed observations, display structured partial results, run at most ten concurrent proxy-bound lookups within the worker timeout budget, and refresh active research runs in the dashboard. Provider parsing and deployed isolation/browser acceptance remain open.
- Persist only provider responses that pass the existing data-retention and tenant checks; do not report an empty result as success.
- [x] Gate: worker/API contract tests pass; deployed sidecar rehearsal remains open.

#### M577 — durable partial scraper state

The earlier result-quality projection correctly rendered mixed competitor
evidence as `partial`, but the durable implementation still had three gaps:
the `scrape_run` check rejected `partial`, the public row projection coerced it
to `failed`, and the worker persisted every validated response as `completed`.
M577 adds one shared `@axiom/core` classifier, expands the existing schema
state contract through authored migration 0057, persists the classified worker
state, and adds authenticated API, worker, core and migration behavior tests.
Source commit `6c5dc48ae9a377bd486d1839dc80d128d78e08b7`; focused tests and all
owning typechecks/builds/linters pass. Migration 0057 is not applied. Deployed
sidecar/provider isolation, benchmark-history exposure, browser/mobile and
deployment evidence remain open.

### 3. Team collaboration and shift management — source and runtime gaps remain

- Add tenant-scoped team membership/role visibility, shift lifecycle, handoff notes, and bounded queue assignment using existing RBAC and RLS conventions.
- Expose the human workflow in a dedicated team/operations surface; keep infrastructure and secret controls out of content-team roles.
- M274 adds row-locked shift lifecycle transitions and explicit completion handoff notes; terminal shifts cannot be reopened/rewritten. Existing generic workspace operational roles do not yet satisfy the L1.0 Chatter persona restricted to assigned shifts/models. F-25 post-specific note ownership/UI and historical list pagination also remain open. Do not label the team feature complete from generic CRUD or navigation tests.
- M275 adds F-25 post-note ownership checks and the calendar read/write/pagination panel, with actual team mutation idempotency registrations. Focused route/UI checks pass; live multi-user acceptance and dedicated PostgreSQL post-note isolation evidence remain open. Chatter permissions and general team-list pagination remain incomplete at this historical checkpoint; see M515 for the current source state.
- [x] Gate: authorization/RLS and dashboard navigation tests pass; multi-user browser acceptance remains open.

### 4. Clipping and adaptation controls — source slice complete; deployment gate open

- Wire dashboard clip/resize/transcode controls to the existing media-plane operations.
- Persist operation intent/status and support platform adaptation of captions and formats without bypassing ToS, consent, approval, or idempotency.
- Keep adaptation separate from publication; failed or pending transforms must be visible and retry-safe.
- M417 makes the media-operation lifecycle explicit in the dashboard: queued, running,
  failed, completed, and unknown states have bounded user-facing explanations; status
  can be reconciled through the existing authenticated GET contract; failed operations
  can retry their original validated options with a fresh idempotency key; raw provider
  errors are not rendered. Four focused control tests, ten media-page tests, dashboard
  typecheck, lint, and diff-check pass. This closes the transform-status UI gap only;
  it does not claim a unified persistent gallery for every uploaded/generated asset.
- M418 adds the existing upload workflow directly to the model media library. A
  confirmed upload refreshes the authoritative asset list; uncertain uploads keep
  the original idempotency key, and read-only roles receive no upload control.
  This removes the navigation gap between the gallery and source ingestion without
  adding a second upload contract. The broader all-state gallery and deployed media
  acceptance remain open.
- M419 adds source and kind filters to the existing model-scoped media listing.
  Invalid filters fail closed in the API; the dashboard exposes accessible source
  and image/video selectors, preserves filters across cursor pagination, and offers
  an explicit clear action. API filter/error tests, media-page tests, dashboard
  typecheck, lint, and diff-check pass. This improves lifecycle discoverability but
  does not claim that storage, worker playback, or deployed media acceptance is
  complete.
- M513 closes the source-level gallery lifecycle gap without introducing a second
  media store. The existing model-scoped media listing now projects the latest
  media-operation status, operation identity, source/result asset relationships,
  and an explicit `unknown` state for stored assets with no attached operation.
  The dashboard renders saved/queued/processing/failed/completed/unavailable
  states, authenticated previews, same-page source/result navigation, and the
  existing transform/retry controls. Operation errors and storage/provider
  details remain server-side. API gallery projection tests (15/15), dashboard
  media tests (11/11), and API/dashboard typechecks pass. R2 round-trip,
  deployed worker/media playback, browser/mobile interaction, and approval/
  publication acceptance remain open.
- [x] Gate: route/worker/media-plane contract tests pass; deployed image and video rehearsal remains open.

### 5. Playbook and guideline management — source slice complete; acceptance gate open

- Extend the existing playbook store into model/org-scoped editable guidelines with revision history and audit records.
- M272 found that the prior revision counter/audit retained no old values. Migration0044 and atomic route snapshots now retain values, with tenant/platform-scoped cursor history and no app-role overwrite permission. Database concurrency/isolation rehearsal passed; history GUI, stale-editor conflicts and live upgrade acceptance remain open. Missing past values are not reconstructed.
- M273 adds paginated history and explicit restore-as-draft in the editor, with mandatory expectedRevision conflict checks and receipt validation. Concurrent stale edits return one success and one409 in real PostgreSQL. A failed score no longer hides guidelines; failed guideline reads never offer editable defaults. History GUI/browser and live migration acceptance still require deployment.
- Connect guideline reads to scheduling, generation, caption adaptation, and analytics surfaces without silently overriding explicit user input. M454 now renders the saved model/platform guideline revision, cadence, posting-time and upsell context on analytics as read-only advisory data; it does not alter metric calculations or scheduling. Browser and deployed acceptance remain open.
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

### 14. Localization and language switching — new owner extension; source slice in progress

- Define the shared F-89 locale contract for `en`, `es`, `ja`, `it`, `pt-BR` and `de`; normalize BCP-47 tags and keep UI locale separate from creator/model content locale. The source slice now consumes that contract in the dashboard shell/navigation/settings, authenticated login hero/form/error/session copy, server-rendered assigned-shift access/empty/error/pagination/handoff copy with `Intl` UTC formatting, reusable team-shift controls and TeamOperationsManager labels/errors/roles/notes with locale-aware UTC timestamps, and mobile dashboard/selector; the authenticated dashboard shell also localizes workspace, home, role, pending-access, footer and system-health copy. Remaining dashboard/email/operator surfaces and browser/deployed evidence stay open.
- Add persisted user preference plus organization default with explicit user choice taking precedence over browser detection; preserve the setting across dashboard, native mobile, auth, email and operator surfaces.
- Create a typed shared message-catalog package with English fallback, ICU plural/select messages, `Intl` number/currency/date/time-zone formatting, accessible `lang` metadata and a missing-key test that fails closed.
- Replace inline user-facing strings and hard-coded `en-US` formatting only in touched surfaces; do not translate user/provider/generated content implicitly. Translation actions must be explicit, bounded and audited.
- Acceptance gate: catalog completeness for all six launch locales, locale switch persistence after reload/sign-in, server/client parity, mobile parity, language-tag accessibility checks, fallback/error-state tests and browser coverage at desktop and narrow mobile widths.

### 15. FanThynks platform affiliate/referral stack — source slice implemented; acceptance gates open

- The native F-90 source slice now defines the platform-acquisition contract in the existing authorization/API/dashboard architecture: FanThynks program, partner identity, campaign/link, click, identity stitch, referred-creator SaaS conversion, commission, reversal/refund, payout export, fraud hold, disclosure/consent, audit and idempotency. It does not create an organization-scoped affiliate builder or reuse provider earnings `referrals`.
- Evaluate OpenPartner from a pinned commit in an isolated source-only copy. Verify MIT license obligations, all dependency licenses, SBOM/vulnerability state, authentication/session boundaries, tenant isolation, signed webhooks, replay/idempotency, refund/chargeback handling, payout controls, export/deletion and operational tests. Do not import from README claims alone.
- Keep Refferq as a secondary MIT comparison. Reject RefKit's AGPL application as the default unless the product explicitly accepts network-copyleft/source-disclosure obligations; its MIT SDK pieces do not make the application AGPL-free.
- The native implementation is the selected path: immutable platform attribution events, derived commission ledger, review/hold states, a non-transfer payout export boundary, owner partner/campaign portal and audit-safe reconciliation are source-wired. Migration, billing/reconciliation, license/security/legal, browser and payout/operator gates remain open. Never reuse provider earnings `referrals` as affiliate state.
- Acceptance gate: source/license/dependency review receipt, partner authorization and creator-data isolation tests, signed webhook/replay tests, SaaS conversion idempotency under retries, reversal/refund and payout-hold tests, disclosure/consent tests, export/deletion tests, desktop/mobile browser coverage, and an explicit human/legal review of the selected licensing model. No live payouts are claimed by source tests.

### 16. Patreon creator/community integration — source slice implemented; v2-only, read/sync-first

- Add F-91 to the existing model-scoped connection/capability architecture without treating Patreon as an eleventh automated publisher. Reuse OAuth state/PKCE, encrypted credentials, model egress, RLS, worker queue, audit and idempotency; do not create a parallel account or permission system.
- Implement a Patreon API v2 contract adapter for `identity`, `campaigns`, `identity.memberships`, `campaigns.members` and `campaigns.posts`, with explicit `fields`/`include` requests, cursor pagination, null-safe/identity-masked fields, and least-privilege scope disclosure in the GUI. Do not request member email/address scopes by default.
- The source slice now adds migration 0055 and tenant/model-scoped campaign, membership, post, sync-state and webhook-event records with explicit RLS; OAuth/PKCE callback persistence through the model egress boundary; bounded data and manual sync routes; durable cursor/replay guards; signed webhook verification and event persistence; and a dashboard status/sync/normalized-record/manual-assist surface. The campaign identity normalizer fails closed rather than treating a campaign ID as a creator ID.
- Native mobile parity is now source-wired: assigned model selection, redacted Patreon status/read views, bounded cursor-aware sync controls for workspace operators, truthful empty/error/retry states and a browser OAuth handoff are covered by the same model-scoped API contract. Keep Patreon out of automated `publish.target` execution until an official write contract exists; no DM, payout, member mutation or unverified analytics controls.
- Use redacted v2 fixtures and signature/pagination vectors because Patreon documents no public sandbox. The provider gate requires an owner-approved creator account, OAuth/refresh/revoke/disconnect receipt, one webhook delivery, sync reconciliation, cleanup and desktop/mobile acceptance. API v1 retirement on 2026-10-07 is a hard constraint.
- Acceptance gate: source adapter and CommunityConnector contract tests, schema/migration/RLS review, OAuth/account persistence tests, cursor/idempotency/replay tests, webhook signature tests, dashboard/mobile visibility and truthful unsupported-state tests, then separately approved live provider OAuth/refresh/revoke, webhook, sync reconciliation and cleanup receipts. Authored source does not claim applied migrations or authorize live Patreon activity.

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
- M337 adds explicit image/video/audio preview controls and a same-origin byte
  proxy through the existing model-egress connector. Every request re-resolves
  exact message membership and rechecks model/shift/account access after bounded
  buffering. Only HTTPS `media.fanvue.com` (official response-example host) is
  accepted; no redirects, cookies or bearer headers are sent to the media host.
  Safe media MIME types, 16 MiB full responses, 8 MiB range chunks, actual byte
  counts and Content-Range consistency are enforced. Browser responses prohibit
  caching/transformation and active document execution. No signed URL is exposed.
- M337 evidence: 73 connector/worker/API and 26 dashboard/page tests pass;
  connector/worker builds, API/dashboard typechecks and dashboard lint pass
  (three existing warnings). Tests cover Safari two-byte range probes, malformed
  or mismatched ranges, oversized streamed bodies, redirect/host/MIME denial,
  revoked scope, explicit show/hide and failed playback retry. These are not
  authenticated browser/provider receipts. Live CDN compatibility, seek/playback
  on mobile/desktop, attachment sending and deployment remain open. Unsupported
  hosts/formats and large non-range responses fail visibly rather than bypassing
  bounds; no claim of universal provider-format support is made.

- M339 exposes saved caption-guidance receipts in the real Approvals page, with
  readable structure and scheduled-time context, exemplar counts, and explicit
  missing/invalid/edited-caption states. Hashes and exemplar identifiers are not
  rendered. Eleven component/page tests, dashboard typecheck and lint pass
  (three existing warnings). Agents retain read-only review without loading
  publication accounts; unsupported roles cannot load review data. This is not
  a performance prediction, causal attribution, or deployed browser acceptance.
- Exact-SHA CI 35279630194 passed all six jobs for `686f5b5`; it does not cover
  the newer guidance commits. Hermes delivered the isolated target-context
  parser, but review found direct-constructor validation bypass, acceptance of
  actual live database `fanthynks_test`, unchecked live service prefix and
  inadequate path/namespace validation. Corrections are assigned in
  `codex-d001a-review-20260917`. No installer integration or live execution is
  approved by this source review. Deployment remains unverified and paused.

- M340 implements recency-decayed reward contributions with a 30-day publication
  half-life, shared by normal outcomes and automatic A/B winner evidence. Both
  positive and negative evidence decay toward the neutral prior. Selection
  derives current sufficient statistics rather than trusting stale cache values;
  fatigue uses actual publication time rather than recipe creation. Fifteen
  focused tests and eight real PostgreSQL tests after 49 migrations pass, plus
  worker typecheck. Tests cover exact half-lives, excluded missing/future dates,
  repeated polls, stale-cache rejection, winner decay and manual-outcome exclusion.
  An initial fixture incorrectly referenced a nonexistent recipe updated_at
  column; that test-only error was corrected before the successful run. Fixture
  `6e767ceef7164a23` was removed; no deployed database or provider was touched.
  Richer hook/format/time arms, query load measurement and live acceptance remain
  open; this does not close F-84 or the full reconciliation.

- M341 corrects digest reporting: only matching published provider observations
  enter totals/top-platform selection, future observations are excluded, tied
  timestamps have deterministic IDs, and label counts require verified evidence.
  Display converts fractional engagement to percent and explicitly calls totals
  cumulative, not weekly gains. Two card-content tests and nine real PostgreSQL
  integration tests pass after 49 migrations; worker typecheck passes. Initial
  new fixture omitted a required embedding; fixed before the successful run.
  Fixture `564dd2416d4997a6` was removed. Full matrix for preceding immutable
  `f1378c4` passed 24/24 tasks; see its dedicated receipt. No live changes.
  Periodic scheduling, external Relay delivery and richer pattern insights remain
  separate F-85 requirements: a stored digest card is not proof of those paths.

- M342 adds opt-in Monday 00:00 UTC digest scheduling through workspace settings
  and the existing durable queue (migration0049, 50 migrations total). A nullable
  schedule identity fences old automatic jobs after disable/re-enable. Settings
  and first enqueue share one transaction; execution locks the same row, writes
  the card and enqueues the next occurrence atomically. Dedupe is per schedule
  identity/week. Missed weeks do not create a catch-up storm. Worker/Safety gates
  remain effective; this does not enable social publication or external delivery.
- M342 evidence: 16 worker/API tests, three settings GUI/page tests, and nine real
  PostgreSQL tests after 50 migrations pass. Database tests cover queue dedupe,
  persisted run time, disabled/replaced identity suppression, and recurrence.
  DB/worker builds, API/dashboard typechecks and dashboard lint pass (three old
  warnings). Fixture `d80faaeb16e411e6` removed. No live schedule enabled.
  Terminal job failure still needs operator intervention; schedule/job health
  presentation and live recurring execution remain acceptance work. External
  Relay delivery and richer insight patterns remain open F-85 requirements.
- M456 exposes the publication-bound recipe dimensions that already exist in
  verified exemplar evidence: media format, ToS verdict at publication and the
  actual publication-hour bucket, alongside the existing caption arm and
  scheduled-time context. The API groups only tenant/model-scoped exemplars
  backed by published provider observations; the dashboard labels the fields as
  observational and does not infer recommendations, causality, thumbnail
  quality or conversion lift. Focused API and dashboard tests plus both
  package typechecks pass. Thumbnail/shoot metadata, conversion attribution,
  broader contextual arms, scheduled Relay delivery and runtime acceptance
  remain open.
- M459 persists the exact bounded photoshoot controls already accepted by the
  prompt engine (style, outfit, location, mood, lighting and aspect ratio) on
  the content bundle, carries them into the first immutable publication
  snapshot, and records them in viral recipe evidence. Historical bundles stay
  explicitly null; no prompt or caption is reverse-engineered. DB schema and
  migration tests pass 128/128, worker recipe/publication tests pass 21/21,
  API generation tests pass 49/49, and DB/worker/API typechecks pass. Trusted
  thumbnail descriptors, conversion attribution, broader arms, Relay delivery
  and runtime acceptance remain open.
- Hermes R2 parser source was actually delivered and reviewed. It fixes direct
  construction and fingerprinting but still does not enforce the requested
  rehearsal allowlist, rejects the legitimate rehearsal prefix/replica role,
  and admits a trailing newline in directly constructed SHAs. Precise fixes
  and a database-callsite inventory were delegated in
`codex-d001a-r2-review-20260917`; no installed script was changed or executed.

### Explicit owner extension — human-or-LLM Chatter roleplayer

The owner has requested that Chatter support either a real human actor or an
approved model-scoped LLM actor, with Grok as the first roleplayer provider
and Venice left behind the existing provider abstraction for later work. This
is a new reconciliation requirement; it is not currently complete.

The implementation lane must compose the existing human shift/assignment
policy, model-scoped `agent_permission`, persona/playbook prompt context,
Grok subscription transport and audited reply-intent contracts rather than
creating a second inbox or permission system. Human Chatter behavior must
remain unchanged. LLM actors require server-side assignment and revocation
checks, actor attribution, bounded draft/reply intents and the same consent,
safety, approval, idempotency and uncertain-delivery gates.

The handoff contract must be usable by both humans and LLMs and explicitly
carry actor type/reference, org/model, active shift, conversation cursor,
queue, last safe summary, pending intent, memory policy, persona source and
persona revision. Roleplay needs bounded tenant/model-scoped conversation
memory with explicit retention/truncation and audit semantics, plus an
optional versioned `soul.md`/persona source loaded only from an approved
persisted tenant/model-scoped source. It must be size-bounded, sanitized,
revisioned, audited, traversal-safe and treated as instruction data below
system safety, ToS, consent, approval and publication rules. If the existing
storage/dispatch contracts cannot support this safely, the implementation
must return a concrete blocker rather than inventing unsafe semantics.

M427 adds the first source contract slice in
`packages/llm-gateway/src/roleplay-context.ts`: actor-agnostic handoff
formatting, bounded tail memory, revisioned persona metadata and safe
`soul.md`-style source references. Eight focused tests pass; gateway
typecheck and lint pass with the existing 16 warnings. This is not durable
memory, assignment persistence, an API route, a dashboard workflow, or Grok
provider evidence; those gates remain open.

M429 extends the same contract without creating a second storage or permission
system: `serializeRoleplayHandoff`/`parseRoleplayHandoff` provide a versioned
JSON envelope, `formatRoleplayPromptContext` combines the handoff with bounded
memory/persona guidance, and `loadRoleplaySoulSnapshot` accepts only an
approved tenant/model-scoped reader. Twelve focused tests pass; gateway
typecheck and lint pass with the existing 16 warnings. This is still source
evidence only. Hermes's pending lane must provide the durable DB/API/dashboard
assignment and memory/persona persistence wiring, then Codex must audit it for
overlap before integration.

M431 implements that missing durable source slice locally after no Hermes
delivery artifact became available. The DB schema/migration adds dual-actor
shift columns plus tenant-scoped roleplay persona revisions, bounded memory
turns and resumable handoffs. API routes enforce active-shift assignment,
model-scoped editable LLM permission, optimistic revisions, audit writes and
bounded/traversal-safe content. The dashboard makes the workflow visible and
can read a local `soul.md`/persona file as browser text for review before
saving a revision. DB tests pass 151/151; the targeted API route, middleware
registration and mounted-index suite passes 160/160; dashboard navigation
tests pass 40/40; roleplay gateway tests pass 12/12. This is source and
automated evidence, not a migrated database, provider dispatch, browser
acceptance or deployed readiness receipt. Grok remains the first intended
roleplayer provider and Venice remains future-compatible, but neither has a
live roleplay receipt here.

The requested feature-completion goal is achieved only when the full architectural requirements and their source, automated, runtime and provider/operator gates are evidenced on the deployed immutable release. Recording a blocker documents incomplete work; it does not complete the goal. Progress reports must contain commit SHA, test/build receipts, runtime URLs, migration receipt, provider receipts and unresolved gates as applicable; they must not label the product production-ready while any required gate is open.

### M519 — F-91 Patreon source wiring and production-readiness reconciliation

The owner-extension audit was corrected against the current checkout. F-90 is
not absent: the native platform-level affiliate stack has authored migration
0054, Drizzle schema, owner-gated API routes, `/affiliate` dashboard controls,
idempotent/audited attribution and commission state, fraud holds and a
non-transfer payout CSV boundary. It remains open for migration application,
billing/reconciliation, license/security/legal, browser and payout/operator
acceptance.

F-91 is source-wired but not complete. Migration 0055, the matching schema,
encrypted OAuth persistence, bounded normalized sync/data routes, durable cursor
replay guards, signed webhook event persistence and the model dashboard are in
the checkout. Mobile parity, migration/RLS deployment, provider/browser and
operational receipts remain open. No third-party affiliate repository or live
provider action was introduced.

Evidence: 26 Patreon connector tests; 3 Patreon route tests; 11 social route
tests; 128 DB schema/migration tests; API, worker and dashboard typechecks;
dashboard navigation tests; API build; and elevated dashboard production build
all pass. A separate roleplay page session-field defect found by the production
build was corrected to use the typed session email field.

### M515 — Team history pagination and Chatter roleplay access correction

The model-scoped `team-operations` read now validates optional UUID cursors and
uses stable keyset pagination for shifts ordered by `(startsAt,id)` and notes
ordered by `(createdAt,id)`. Responses are bounded to 100 rows with explicit
`next_cursor` metadata, and the dashboard exposes separate Load older controls
for each history stream while preserving current rows and reporting failures.
The model-access condition is applied before pagination, and malformed or
foreign cursors fail closed.

The Chatter roleplay page no longer calls the administrative team-operations
endpoint, which is intentionally outside the scoped-role allowlist. Chatter
roleplay now consumes the existing authorized `/my-shifts` roster and exposes
only the current user's active human assignment; owner/manager/operator
roleplay continues to discover active human or editable assigned-LLM actors
through team operations. This keeps the dual-actor architecture without
expanding team roster visibility.

Evidence: API team-operation tests 11/11, API model-access/roleplay/team tests
32/32, dashboard roleplay page tests 2/2, dashboard team-page tests 6/6, API
build, API/dashboard typechecks and diff-check pass. The PostgreSQL integration
file was collected but all 40 tests were skipped because no approved disposable
`TEST_DATABASE_URL` was available. No migration, runtime, provider, database,
browser or deployment action occurred. Source commit
`3ecb3eae397f31331d99aa27352d4a242eb70f83` is pushed; Hermes remains paused.

### M521 — Full isolated matrix regression closure

The final disposable workspace run passed 24/24 tasks after correcting four
source-level regressions: Patreon is linked from the talent tabs, Chatter
prefers the authenticated display name with a typed session contract, the DB
relation-count invariant includes roleplay relations, and the mobile locale
selector uses the existing panel token. API 1,117/1,117, dashboard 728/728,
DB 165 plus 5 skipped, connectors 413/413, relay 272/272, worker 301/301
plus real PostgreSQL integration, MCP 91/91, LLM gateway 387/387, core 61/61,
auth 28/28 and mobile 23/23 passed; dashboard production build and mobile
web export passed. The disposable fixture was removed. No live, provider,
migration, database, permission, service, browser or deployment action
occurred; external and operational acceptance gates remain open.

### M550 — F-85 state contract and F-89 authenticated localization correction

Hermes F-85 R3 was reviewed as terminal `BLOCKED`, not accepted delivery: its
source correction introduced a persisted `stored` Relay-card state without a
shared type/schema/migration contract. Codex implemented the missing contract
locally. Relay-card states are now closed and fail-closed; authored migration
0056 validates existing values and constrains future rows; digest creation
records durable `stored` evidence with `externalDelivery: not-attempted`; API,
dashboard and mobile surfaces distinguish storage from attempted external
delivery. No migration was executed and no provider was contacted.

The same correction extends F-89 localization into the actual login page/form,
including hero copy, labels, placeholders, account actions, session advice and
errors, using the existing six-locale catalog. Focused state/auth/layout/digest
tests passed, dashboard typecheck passed, and the elevated production build
passed. Remaining catalog adoption, formatting, browser/mobile, migration/RLS,
provider, runtime and deployment gates remain open.

### M560 — F-89 digest and Relay catalog adoption

Hermes' scoped R3 delivery was accepted only after individual retrieval and
SHA-256 verification of its 12 declared changed source paths. Codex merged the
digest page, digest generation/schedule/recovery controls, Relay page and
cursor-paginated Relay-card history into the current branch while preserving
the already accepted TeamShiftCard and TeamOperationsManager locale keys.
The archive SHA-256 was
`de033fae7281a2ae93b91b31946bc24dfbd3bd75694a0e294a7b31b85140fbbd` and the
source commit is `789edae3ba0c357e9e5a8ffb67329281c1076a65`.

Core tests passed 65/65, the focused digest/Relay suite passed 19/19, the full
dashboard suite passed 739/739 and dashboard typecheck passed. The Hermes
delivery had no live actions and its response signature was duplicated, so the
artifact—not the transport acknowledgment—was the acceptance subject. Worker,
external Relay, provider, migration, browser/mobile and deployment evidence
remain open.

### M562 — authenticated workspace-settings localization

The owner settings page and `OrgSettingsForm` now use the shared six-locale
catalog for all visible settings headings, descriptions, accessible labels,
load/save/error/retry states and controls. Existing idempotency, response
confirmation and retry behavior remains covered by the original settings tests;
the new locale tests prove English and Spanish rendering plus persisted checked
state. Core tests passed 65/65, the focused settings/localization suite passed
6/6, the full dashboard suite passed 741/741 and dashboard typecheck passed.
This closes one source/UI slice of F-89 only; remaining dashboard/email/operator
adoption, formatting, browser/mobile, provider, migration/RLS, runtime and
deployment evidence stay open.

### M564 — analytics surface localization and formatting

The analytics page now uses the shared six-locale catalog for access, report,
metric, playbook, viral and empty/error copy. Count and engagement-percentage
formatting uses `Intl.NumberFormat` for the selected UI locale while provider
and authored content remain unmodified. Spanish rendering and locale-aware
grouping are covered by a focused regression test. Core tests passed 65/65, the
analytics/settings focused dashboard slice passed 10/10, the full dashboard
suite passed 742/742 and dashboard typecheck passed. This is a source/UI slice;
provider, browser/PDF, mobile, migration/RLS, runtime and deployment evidence
remain open.

### M566 — incidents and crash-recovery localization reconciliation

The crash-report ingestion/list/resolve contracts were already real in the API
and the Incidents page, but the detailed coverage audit still marked the
dashboard workflow absent. Codex reconciled that stale row and localized the
actual incident/recovery surface through the existing six-locale catalog. Crash
status tabs, empty/error states, resolve/retry messages, recovery headings,
table labels and replay/reconciliation copy now use the selected locale; crash
and job timestamps use explicit UTC `Intl.DateTimeFormat` output. The existing
role gate, independent cursors, idempotency and provider-uncertain replay
guard are unchanged.

Evidence: core 65/65, dashboard 743/743, dashboard typecheck, elevated
dashboard production build, and `git diff --check` pass. This is source/UI
evidence only; deployed crash sinks/paging, browser/mobile acceptance,
runtime/RLS and deployment gates remain open.

### M567 — publishing-safety UI localization and coverage reconciliation

The owner-only publishing-safety surface was real but still contained English
copy and the detailed coverage audit incorrectly classified the route as only
partial. The Safety page, emergency control, and global safety banner now use
the shared six-locale catalog. The page loads the persisted interface locale,
keeps the owner denial path separate from the restricted status API, fails
closed when the status is invalid/unavailable, and formats the recorded start
time with explicit UTC locale-aware formatting. The audit now records the
actual Fanvue/Threads/Patreon account OAuth-entry and disconnect UI, the Relay
history/deep-link surface, and RelayBindingManager rather than claiming those
surfaces are absent. Source status is not promoted to provider, browser,
runtime, migration/RLS, or deployed acceptance.

Evidence: core 65/65, focused Safety/banner tests 17/17, full dashboard suite
744/744, dashboard typecheck, elevated dashboard production build, and
`git diff --check` pass. No runtime/provider/database/migration/permission/
deployment action is included.

### M568 — subscription-provider lifecycle surface

The gateway already exposed authenticated status, streamed login and disconnect
operations for the official OpenAI, Anthropic and Grok subscription transports,
but the dashboard only exposed Grok's resumable login and could not disconnect a
saved Grok subscription. The API model-access classifier now admits only the
authenticated user's OpenAI/Anthropic status/login/disconnect paths alongside the
existing Grok lifecycle. The connections surface now renders localized OpenAI and
Anthropic status, bounded SSE login instructions, explicit disconnect confirmation
and retry/unconfirmed states; Grok now has an explicit disconnect control that
requires the gateway's `{ provider, connected: false }` response. No credential,
token, password, provider payload or entitlement is rendered or accepted.

Evidence: core 65/65, API model-access 13/13, dashboard focused provider/Grok
tests 27/27, full dashboard suite 750/750, API typecheck/build and dashboard
typecheck pass. This is source/UI evidence only; provider CLI/OAuth, browser,
mobile, runtime, migration/RLS, bucket and deployment acceptance remain open.

### M569 — platform affiliate workflow localization

The FanThynks SaaS referral workflow was already owner-gated and source-wired,
but its owner page still emitted English-only copy and fixed `en-US` money/date
formatting. The affiliate page now resolves the persisted interface locale for
owner-denial and program-load errors, while `PlatformAffiliateManager` consumes
the shared six-locale catalog for onboarding, campaign, report, hold and action
copy. Currency, commission percentages and hold dates use the selected locale;
dynamic partner/campaign/hold statuses are translated through bounded catalog
keys. The direct-invocation test fallback remains English-only and does not
change runtime provider behavior.

Evidence: core 65/65, affiliate-focused dashboard 5/5, full dashboard 753/753,
dashboard typecheck/lint and elevated production build with non-secret
`API_ORIGIN=http://127.0.0.1:3302` pass; lint retains only three pre-existing
`no-explicit-any` warnings in `MediaBundleCreate.behavior.test.tsx`. No billing,
payout, provider, database, migration, runtime, permission or deployment action
is included. Browser, legal/license, billing/reconciliation, migration/RLS and
deployed acceptance remain open.

### M570 — model earnings localization and formatting

The model earnings page now consumes the shared six-locale catalog for access,
loading, empty, retry, summary, period, source and timeline copy. Its existing
read-only financial boundary is unchanged: account selection remains explicit,
foreign/malformed selections are rejected, and the page does not invent provider
totals or perform mutations. USD amounts, month-over-month percentages and
observed/period dates now use the selected interface locale; percentages retain
one decimal place so zero and non-zero changes have a stable visible contract.

Evidence: core 65/65, focused earnings dashboard 15/15, full dashboard 754/754,
dashboard typecheck and lint pass; lint retains only three pre-existing
`no-explicit-any` warnings in `MediaBundleCreate.behavior.test.tsx`. No provider,
database, migration, runtime, permission or deployment action is included.
Browser/mobile, provider-backed earnings, email/operator adoption, migration/RLS
and deployed acceptance remain open.

### M571 — bounded R2 media descriptor wiring

The source-only R2 contract is now wired through the existing media lifecycle
without introducing a schema, provider, retention policy or runtime action.
`packages/llm-gateway/src/grok-r2-storage.ts` owns the shared tenant/model
object-key validator and MIME/size bounds; its public export is consumed by
generated-asset storage, media transforms, authenticated upload/preview routes,
and bundle preview paths. Asset keys must remain under the authenticated
`generated/{orgId}/{modelId}/...` scope; operation keys are UUID-derived
media-plane outputs. Invalid scope, traversal, URL-like keys, unsupported media
types and out-of-bounds sizes fail closed.

Evidence: API full suite 1,069 passed with 50 explicit integration skips;
worker full suite 269 passed with 32 explicit integration skips; LLM gateway
full suite 388/388; focused R2 helper 9/9, worker storage/transform 18/18 and
API upload/preview/bundle 121/121. API, worker and LLM builds passed, package
lint exited 0 with only existing warnings, and `git diff --check` passed.
Source commit `8e5695f7605c9be57d0840ff1e58dd3090c048b7` is pushed. Live R2
configuration, bucket round-trip, retention/deletion, deployed media and
browser/mobile acceptance remain open.

### M578 — verified variant guidance provenance

The existing bounded `CaptionGuidanceReceipt` is now reachable from the real
variant/A-B workflow without adding a parallel model or migration. Candidate
creation accepts only a selected existing guidance bundle whose org, model,
asset/source relation, supported platform, stored receipt and exact caption
hash are rechecked server-side. Review-bundle creation repeats those checks so
stale or edited source captions fail closed. Candidate and published-
performance responses project only bounded safe guidance summaries; hashes,
exemplar identities, storage keys, prompts and provider payloads are not
exposed. The dashboard can select an eligible source, populate its exact
caption, clear attribution on manual edits and render verified metadata or
truthful unavailable evidence.

Source commit: `ce2f15bf73fb0855b97fc6dddd173a1f3e4827c3` (pushed to the working
branch). Focused API route/index/provenance tests passed 193/193, dashboard
variant tests passed 7/7, API/dashboard/DB typechecks passed, and API/dashboard
lint exited 0 with only existing warnings. No migration was authored because
the bounded JSONB extension is backward compatible; no runtime, provider,
database, deployment or live action occurred.

This closes the selected-guidance source/UI slice only. Statistical evaluation,
browser/mobile interaction, worker/provider execution, migration/RLS and
deployed acceptance remain open. Hermes' gallery R10 lane remains source-only:
its progress reply proves archive verification but not implementation delivery;
the separate gallery R11 helper-only delivery is not accepted as route/UI
work.

### M579 — assigned-LLM Chatter inbox drafting dispatched

The architecture still has one concrete inbox gap after the existing text
reply, durable dispatch, uncertain-delivery review, actor-aware shift,
`soul.md` persona and bounded-memory slices: an assigned LLM must be able to
propose a bounded private reply that becomes a reviewable pending intent
without sending it. Hermes was assigned `INBOX-AGENTIC-DRAFTING-R1` against
exact source `85bf2f6502b4016d20bc5145087afd0f48b4d5b6` in an isolated copy.

Passage requires a real authenticated API and reachable inbox/roleplay UI
composition using the existing roleplay gateway, handoff/persona/memory,
inboxReplyIntent and dispatch fences; exact tenant/model/connection/
counterpart/active-shift/agent-permission checks; bounded provider output;
immutable pending persistence; duplicate-intent protection; and explicit
human confirmation before the existing text-only Fanvue send. Rejected or
uncertain LLM outcomes must not create a sendable reply. Behavior tests must
exercise authorization, persistence, replay, provider failure and UI
loading/error/recovery states. No provider, migration, deployment or live
action is allowed. Hermes delivery is not yet accepted; Codex will hash,
review and test any artifact before integration.

### M580 — F-89 operator formatting lane dispatched

The current source audit found a separate remaining F-89 slice in actual
mounted dashboard/operator surfaces: Audit, Approvals, Playbook history,
AgentPermissionManager and TriggerRuleManager still contain raw visible
English and/or host-locale date/count/percentage formatting. Hermes was given
`F89-DASHBOARD-OPERATOR-FORMATTING-R1` against exact pushed source
`7bdd125d80c4facbd790ac148ce67e9cc62a7511`. It must reuse the existing
six-locale catalog and formatting helpers, preserve authorization, idempotency
and safety behavior, add reachable-surface and catalog-completeness tests, and
return one hash-verifiable DELIVERY or one terminal BLOCKED result. A
helper-only change, unused catalog key, or route-only claim is not accepted.
The envelope was protocol-validated locally and remote checksum readback
matched `ed83c13067a93e6c15e49ea341ddefdf085385612e2b86b9dde6cd4ee3bc77a3`.
No provider, database, migration, runtime, permission, network, installer or
deployment action occurred; browser/mobile/deployed evidence remains separate.

### M581 — F-89 mobile Relay lane dispatched

The source audit found a separate mobile localization gap in the real
`DashboardScreen` and `RelayScreen`: the persisted selector existed, but the
screens still emitted raw language/delivery labels and host-locale date/count
formatting. Hermes was assigned `F89-MOBILE-RELAY-FORMATTING-R1` against exact
source `7bdd125d80c4facbd790ac148ce67e9cc62a7511`. It must reuse the existing
six-locale catalog and persisted preference, keep creator/provider-authored
content unchanged, add mounted-screen tests for non-English rendering,
truthful delivery states and locale-aware UTC dates, and return one
hash-verifiable DELIVERY or one terminal BLOCKED result. No provider,
database, migration, runtime, permission, network, installer or deployment
action occurred; native/browser/deployed evidence remains separate.
The envelope was protocol-validated locally and remote checksum readback
matched `fa95b7614329326d1f048c770dd3b7ba780c84c6a2cf88284912a3f9104b8bd1`.

### M582 — strict ACK correlation correction

Hermes' desktop operator-formatting reply reused the task WIRE as both its
reply WIRE and `IN_REPLY_TO`, so it cannot advance the lane under the strict
ACK-NACK contract. Codex sent the terminal correction receipt
`CODEX-F89-DASHBOARD-OPERATOR-FORMATTING-R1-RECEIPT-003`, requiring Hermes to
reissue a unique correlated ACK before implementation is counted. The local
envelope passed protocol validation and remote checksum readback matched
`f481b3159b80f3991ea1f069c2b369b5529e2802b206ddea720bb9599b78801b`.
This rejects the envelope only; it does not change the five-surface scope.
No runtime, provider, database, migration, permission, installer or
deployment action occurred.

### M584 — operator ACK state correction

Hermes corrected the desktop operator-formatting WIRE collision but returned
`STATE: OPEN`, which is invalid for an ACK under `ACK-NACK-1`. Codex sent a
strict `RECEIPT/REJECTED` correction with a unique correlated WIRE,
`CODEX-F89-DASHBOARD-OPERATOR-FORMATTING-R1-RECEIPT-005`; local validation
passed and the remote checksum is
`288a5433ab6ba1889a9dc3e13bcd8e6507f75ddf07023a18b6f0725c8b507a4f`.
The lane remains open and unaccepted until Hermes returns `ACK` with
`STATE: ACCEPTED` or `STATE: READ`; no source delivery is counted from the
invalid envelope.

### M585 — F81/F84 exact-source transport

Hermes' terminal BLOCKED response identified a real source transport gap: the
exact current commit was absent from its local object store. Codex supplied a
tracked-source archive generated from `ac7961b9444fea4ec538e84c5980afca84e69ea6`
and verified the bridge copy at SHA-256
`92fffb7bf4d02352420ba3d7ece86411e41afa2bc590234c7f7577df18e92e11`.
The resume task was protocol-validated and transferred with remote SHA-256
`a9a099c041bb4429f6389f47aab4e925499ef34d6d6246ce6bb0e85bdb0ba1b9`, using a
writable isolated Hermes copy root. This reopens source work only; it is not
implementation or deployment evidence.

### M586 — F89 mobile Relay localization integrated

The readable Hermes mobile delivery was independently audited and integrated
into the current source. `DashboardScreen` and `RelayScreen` now consume the
shared six-locale catalog for mounted navigation/language/delivery/status,
empty/error/retry copy, and locale-aware date/count formatting. Core catalog
coverage and mounted-screen behavior tests were added. During review Codex
corrected the delivered Vitest root/env boundary so tests cannot load the root
deployment environment, and removed contradictory empty-state copy from Relay
error rendering.

Evidence: mobile tests 19/19, core tests 74/74, dashboard tests 753/753,
mobile/core typechecks and linters, and the mobile TypeScript plus Expo web
export build all passed. Commit
`94416816354926e2e0282420e360defa1a9655dd` is pushed and read back. This
closes only the source gate for this mobile slice; native/browser, deployed,
migration/RLS, runtime and provider acceptance remain open.

### M583 — current-source F81/F84 trusted-vision lane

The current Rust vision response exposes ToS classification and bounded image
analysis, but the worker deliberately leaves `thumbnail_features` absent from
publication recipe evidence. Hermes was assigned a current-source, source-only
lane to wire a versioned trusted local-vision receipt through the existing
publication snapshot and viral recipe/exemplar paths. The lane must reject
overrides, heuristic fallback, asset-identity mismatch and malformed data, and
must not fabricate Fanvue conversion attribution. The envelope was validated
locally and remote checksum readback matched
`4426322a6c413f3adf7ffe6c928b560c02c4f7f9ab3f33a227c3319554936fae`.
No runtime, provider, database, migration, permission, installer or
deployment action occurred.

### M593 — trusted vision recipe evidence integrated

Codex integrated the source-only F81/F84 slice at commit
`81ef2069aae36256bed673c093ec5fbe16212cd6`. The Rust nsfw-detect response now
normalizes bounded dimensions, brightness, variance, aspect ratio and
confidence; `ToSEngine` emits a versioned `vision-analysis-v1` receipt only for
an un-overridden `rust_engine` result. The worker requires consistent receipts
across caption-group scans, binds the result to the existing asset ID and
32-byte SHA-256, and persists it without changing the ToS verdict. Publication
snapshot construction and recipe evidence accept only validator-approved
receipts, so fallback, override, malformed, divergent and wrong-asset data
becomes unknown. No conversion, revenue or provider attribution was invented.

Evidence: Fanvue MCP 80/80 tests, worker full suite green including the new
publication assertion, DB 155 passed with 17 integration tests skipped by the
local environment, all three package typechecks and builds passed, and the
owning lints exited 0 with only pre-existing warnings. No migration, runtime,
provider, permission, installer or deployment action occurred.

### M599 — Audit operator surface localization

The mounted `/audit` page now uses the shared six-locale catalog for trust and
activity copy, chain verification states, table headings, empty state and
localized failure copy. Its timestamps use the server-locale UTC formatter and
raw backend error text is not exposed to operators. Core catalog tests passed
74/74; the dashboard suite, typecheck and lint passed with only existing
warnings. This closes only the Audit slice of F-89. Approvals, playbook,
agent-access and automation-rule surfaces remain the next finite source/UI
localization node; browser/native, provider, migration/RLS and deployment gates
remain open.

### M601 — remaining mounted operator-page localization

The approvals/review, playbook, agent-access and automation-rule pages now
consume the six launch catalogs. Review state labels, access boundaries,
empty/unavailable/no-state-change copy and playbook score/history labels are
localized; review and score-history timestamps use explicit UTC formatting.
The existing approval and playbook behavior suites plus the full dashboard
suite, dashboard typecheck and lint pass with only pre-existing warnings. This
closes those mounted page slices of F-89, not every child-component label or
browser/native acceptance gate. No provider, database, migration, runtime or
deployment action occurred.

### M603 — reusable agent-permission localization

The `AgentPermissionManager` child surface is now wired to the six launch
catalogs. Capability explanations, tier labels, publishing/edit scopes,
token lifecycle controls, confirmations, validation and owner-only messaging
are localized while agent references, tokens and timestamps remain untouched
data. Mounted-render coverage proves non-English output for editable and
read-only states.

Core 74/74, focused component 2/2, full dashboard 755/755, core build/lint
and dashboard typecheck pass; dashboard lint retains only three pre-existing
warnings. Source commit `f920eb07bfe09fabb2ecdd96fe862f862df09d7c` is the
reviewed milestone. Remaining child surfaces, browser/native, provider,
migration/RLS, runtime and deployment acceptance remain open.

### M607 — reusable trigger-rule localization

The `TriggerRuleManager` child surface is now wired to the six launch
catalogs. Rule descriptions, metrics, action choices, validation,
confirmation, retry, mutation status, empty state and owner-only messaging are
localized; authored rule names, provider identifiers, thresholds and styles
remain untouched data. Last-fired timestamps use the selected locale.

Core 74/74, focused component 2/2, full dashboard 757/757, core build/lint,
dashboard typecheck and `git diff --check` pass. Dashboard lint retains only
the three pre-existing warnings in `MediaBundleCreate.behavior.test.tsx`.
Source commit `ea3ad70c33399edb8a8fc37dd76e04b9856ec661` is the reviewed
milestone. Browser/native, provider, migration/RLS, runtime and deployment
acceptance remain open.

### M609 — reusable playbook-guideline localization

The `PlaybookGuidelineManager` child surface is now wired to the six launch
catalogs. Editor labels, revision state, placeholders, save/retry/error
feedback, owner-only messaging and restored-draft status are localized while
platform identifiers and authored upsell strategy text remain data.

Core 74/74, focused component 2/2, full dashboard 759/759, core build/lint,
dashboard typecheck and `git diff --check` pass. Dashboard lint retains only
the three pre-existing warnings in `MediaBundleCreate.behavior.test.tsx`.
Source commit `ee4fceedabeb8308055cd7af260584e25f8d214b` is the reviewed
milestone. Browser/native, provider, migration/RLS, runtime and deployment
acceptance remain open.

### M667 — assigned-LLM private inbox drafting implemented locally

The stale Hermes implementation lane was quarantined after source/protocol
divergence; no Hermes artifact is counted. Codex implemented the F-31 gap in
the existing architecture. `roleplay-runtime.ts` now provides one injectable
Grok roleplayer gateway for both Chatter turns and inbox drafting. The new
assigned-LLM draft path composes the exact tenant/model access boundary, active
team shift, `agent_permission.can_edit`, active Fanvue connection, roleplay
handoff actor, latest `soul.md` revision and bounded conversation memory.

Migration 0058 extends `inbox_reply_intent` with draft provenance, roleplay
turn identity and human approval fields. Drafts are persisted pending and
unapproved; intent/turn replay is idempotent, scope mismatches are conflicts,
provider failures become rejected/uncertain and never become sendable text,
and the database transition trigger keeps draft identity/body/turn immutable.
The existing text-only Fanvue dispatch path now requires the approving human
for an LLM draft, while the dashboard exposes private generation, review,
approval and the existing separate send confirmation. No automatic send or
publication path was added.

Evidence: API focused drafting/inbox route suite 28/28, dashboard drafting
suite 12/12, full API suite 1,097 passed and 50 skipped, DB suite 155 passed
and 17 skipped, worker/API/dashboard package typechecks pass, and the complete
12-package production build passes with `API_ORIGIN` set to a non-secret test
origin. Source commit `7ff39ea66cc601c1c2e0659d5e2f36cdb942f3d5` is pushed to
`origin/codex/telegram-webhook-hardening`. The Windows build required elevated symlink capability for Next.js
standalone tracing; the code build itself is clean. Migration 0058 is authored
but unapplied; provider, browser/mobile, live migration/RLS, runtime and
deployment acceptance remain open. No provider, credential, database,
permission, network, installer or live service action occurred.

### M669 — F-89 Calendar localization source slice

The authenticated model Calendar page and its client surfaces now consume the
shared six-locale catalog instead of embedding English labels. Month/week
navigation, invalid-query messages, creator scheduling guidance, empty/error
states, post details and state labels are localized. The visual board derives
weekday and day labels from the selected locale, while drag/date movement,
locked-target guidance, guarded mutation feedback and UTC wording remain
unchanged. The schedule form localizes confirmation/retry/error states, and
advisory optimal-time windows use localized catalog labels plus locale-aware
numeric formatting. The media-library link remains a normal navigable route.

The six locale catalogs now contain the Calendar key family (English,
Spanish, Japanese, Italian, Brazilian Portuguese and German). Evidence:
Calendar page/board/schedule/optimal-time tests 20/20, core tests 80/80,
core build, dashboard typecheck and `git diff --check` pass. This is source
and automated evidence only; remaining dashboard catalog adoption,
browser/mobile acceptance, provider, migration/RLS, runtime and deployment
gates remain open.

### M759 — F-89 TriggerRuleManager UTC formatting

TriggerRuleManager now renders last-fired values through the shared locale
formatter with an explicit UTC zone instead of host-dependent date formatting.
Focused AgentPermissionManager, PlaybookHistory and TriggerRuleManager tests
pass 9/9; dashboard typecheck, lint and diff checks pass. This closes only the
TriggerRuleManager timestamp-formatting criterion. Audit and Approvals
operator surfaces, remaining catalog adoption and all browser/native,
provider, migration/RLS, runtime and deployment gates remain open.

### M761 — F-89 ApproveButtons localization and recovery controls

The mounted `ApproveButtons` review control now consumes the shared six-locale
catalog for scheduling guidance, destination/account selection, unresolved
intent recovery, ToS blocking, caption-revision instructions and action labels.
Existing idempotency, unchanged-request recovery, response confirmation and
publication safety behavior are preserved. The focused approval destination,
localization and intent suites pass 32/32; together with the existing
AgentPermissionManager, PlaybookHistory and TriggerRuleManager checks the
operator slice passes 41/41. Core build/tests, dashboard typecheck and lint
pass, with only the three pre-existing dashboard warnings; `git diff --check`
passes. This closes the ApproveButtons source/UI criterion only. Audit and
remaining mounted operator/email catalog adoption, browser/native, provider,
migration/RLS, runtime and deployment gates remain open.

### M763 — F-89 MediaBundleCreate approval localization

The mounted `MediaBundleCreate` control now consumes the shared six-locale
catalog for media-to-review entry, destination/caption fields, optional local
schedule guidance, MP4 conversion requirements, idempotent retry messaging and
the post-save approvals link. Its existing payload, requested-schedule UTC
conversion, response identity checks and no-publication wording are unchanged.
The focused component/behavior suite passes 3/3; the combined approval and
operator suite passes 47/47; core build/tests, dashboard typecheck and lint
pass with only the three pre-existing dashboard warnings, and diff-check
passes. This closes the MediaBundleCreate source/UI criterion only. Other
approval children, remaining catalog adoption, browser/native, provider,
migration/RLS, runtime and deployment gates remain open.

### M757 — F-89 AgentPermissionManager UTC formatting

The AgentPermissionManager operator surface now uses the shared locale-aware
UTC formatter for one-time agent-token expiry values. The token ID, agent
reference, capability tier and non-secret metadata remain data and are not
translated. Focused AgentPermissionManager, PlaybookHistory and
TriggerRuleManager tests pass 8/8; core rebuild, dashboard typecheck, lint and
diff checks pass. This closes the AgentPermissionManager formatting criterion
only. Audit, Approvals and the remaining TriggerRuleManager criteria,
browser/native acceptance, provider, migration/RLS, runtime and deployment
gates remain open.

### M787 — F-89 scraper route shell localization

The authenticated scraper route now resolves the persisted interface locale
through the shared server-locale helper. Its route-level title and load-failure
state use typed catalog keys; the existing `ScrapeRunManager` continues to
localize the mounted controls, result states, pagination and UTC timestamps.
The source gate is intentionally limited to route-shell copy and does not
claim provider, sidecar, migration, browser or mobile acceptance.

Evidence: focused scraper route tests 3/3, core locale tests 28/28, core and
dashboard typechecks pass, focused ESLint for changed core/dashboard files
passes, and `git diff --check` passes. Source commit
`ec7af18f83d9acc17250bff770d6dda2f99364d5` is pushed and read back from
`origin/codex/telegram-webhook-hardening`. Full dashboard lint was not counted
because the package-wide process hung in this environment and was stopped;
focused changed-file lint is the accepted lint evidence for this slice.

### M789 — F-89 workspace-members route shell localization

The owner-gated workspace-members route now resolves its persisted interface
locale through the shared server-locale helper. Title, owner-only access copy,
scope description and workspace return link use typed catalog keys in English,
Spanish, Japanese, Italian, Brazilian Portuguese and German. Existing owner
authorization, discoverability and `WorkspaceMembers` behavior are unchanged;
this gate covers the route shell only.

Evidence: focused members route tests 9/9, core locale tests 28/28, core and
dashboard typechecks pass, core build passes, focused ESLint for the changed
dashboard files passes, and `git diff --check` passes. Source commit
`1b640fa677393536b09c824f9a563e2c4b2da3ce` is pushed and read back from
`origin/codex/telegram-webhook-hardening`. Package-wide dashboard lint was not
counted for this slice because it previously hung in this environment.

### M791 — F-89 Grok connection route shell localization

The authenticated Grok connection/storage route now resolves the persisted
interface locale through the shared server-locale helper. Role-denial copy,
Grok account title/description, workspace return link and private-storage
boundary use typed catalog keys in all six launch locales. Existing role-scoped
account, subscription and storage components are unchanged; this gate covers
the route shell only and does not claim OAuth, R2 or provider runtime proof.

Evidence: focused Grok route tests 10/10, core locale tests 28/28, core and
dashboard typechecks pass, core build passes, focused ESLint for changed
dashboard/core files passes, and `git diff --check` passes. Source commit
`d7e74ea624cf845f981360c51219eaf86f72f6f6` is pushed and read back from
`origin/codex/telegram-webhook-hardening`. Package-wide dashboard lint was not
counted for this slice because it previously hung in this environment.

### M793 — F-89 cascades route shell localization

The model-scoped cascades route now resolves the persisted interface locale
through the shared server-locale helper. Loaded, unavailable and load-failure
copy use typed catalog keys in all six launch locales. Existing model scope,
edit-role calculation, template loading and scheduling behavior are unchanged;
this gate covers the route shell only.

Evidence: focused cascades route tests 2/2, core locale tests 28/28, core and
dashboard typechecks pass, core build passes, focused ESLint for changed
dashboard/core files passes, and `git diff --check` passes. Source commit
`89477724ec180a2e91a874ff1a21f3b680a01047` is pushed and read back from
`origin/codex/telegram-webhook-hardening`. Package-wide dashboard lint was not
counted for this slice because it previously hung in this environment.

### M795 — F-89 model team route-shell localization

The model-scoped Team & shifts route now resolves the persisted interface
locale through the shared server-locale helper. Loaded, unavailable and
load-failure copy use typed catalog keys in all six launch locales. Existing
owner-only assignment visibility, role-scoped edit capability, team operations,
shift lifecycle, handoff notes and Chatter mechanics are unchanged; this gate
covers the route shell only.

Evidence: focused team route tests 7/7, core locale tests 28/28, core and
dashboard typechecks pass, core build passes, focused ESLint for changed
dashboard/core files passes, and `git diff --check` passes. Source commit
`0b7d4b232d9f590e56a1e80013c79d5491b063a2` is pushed and read back from
`origin/codex/telegram-webhook-hardening`. Package-wide dashboard lint was not
counted for this slice because it previously hung in this environment.

### M797 — F-89 variant-experiments route-shell localization

The model-scoped variant-experiments route now resolves the persisted
interface locale through the shared server-locale helper. Loaded, unavailable
and load-failure copy use typed catalog keys in all six launch locales.
Existing model scope, role-based edit capability, candidate selection,
experiment lifecycle, outcome tracking and winner promotion mechanics remain
unchanged; this gate covers the route shell only.

Evidence: focused experiments route tests 2/2, core locale tests 28/28, core
and dashboard typechecks pass, core build passes, focused ESLint for changed
dashboard/core files passes, and `git diff --check` passes. Source commit
`f8aaaff7464672234e78cd55043965def328d7e5` is pushed and read back from
`origin/codex/telegram-webhook-hardening`. Package-wide dashboard lint was not
counted for this slice because it previously hung in this environment.

### M799 — F-89 portfolio home-shell localization

The authenticated portfolio home now resolves the persisted interface locale
through the shared server-locale helper. Hero, setup guidance, summary cards,
empty/error states, roster labels, profile status labels, direct actions and
pagination copy use typed catalog keys in all six launch locales. Dynamic
profile data, aggregate count behavior, cursor handling and navigation remain
unchanged; this gate covers the home shell only.

Evidence: existing home behavior tests 7/7, core locale tests 28/28, core and
dashboard typechecks pass, core build passes, focused ESLint for changed
dashboard/core files passes, and `git diff --check` passes. Source commit
`4a3bb9e0511e83aff2781612a98436d08b8039ee` is pushed and read back from
`origin/codex/telegram-webhook-hardening`. Package-wide dashboard lint was not
counted for this slice because it previously hung in this environment.

### M818 — F-89 media approval child-control localization

The next finite localization slice closes the remaining nested media approval
controls without changing their backend contracts. `GenerationRetry` now
localizes retry guidance, consent, reviewed-prompt actions and bounded failure
states; `MediaPromptSuggestion` localizes suggestion consent, diff/review
labels, character-lock context and provider-failure states; and
`MediaOperationControls` localizes transform history, operation/status labels,
clip/resize/transcode controls, retry feedback and safety summaries. Existing
approval interlocks, role checks, idempotency keys, API payloads and raw
provider/user-authored data remain unchanged.

Pass criteria and evidence: core catalog/completeness tests 34/34; dashboard
focused media approval suite 57/57; core/dashboard typechecks pass;
core/dashboard lint exits 0 with only four pre-existing dashboard `any`
warnings; dashboard production build passes with explicit non-secret
`API_ORIGIN`; `scripts/verify.sh` prints `verify: ok`; source commit
`6ac4c8c0e965fba69d090366f302f9e4c216c9a1` is pushed and read back from the
coordination branch. This closes only the source/automated UI localization
criterion. Browser/native, deployed media/runtime, R2, provider,
migration/RLS, and production/operator acceptance remain open. No live action
occurred.

### M820 — F-89 generation and upload workflow localization

The generation form, source-media upload flow and live generation-progress
surface now consume the shared six-locale catalog. The form covers output type,
media prompt, sanitization disclosure, source-image selection, duration,
creative fields, destinations, optional caption enrichment, unresolved-request
reconciliation and ToS report headings. Upload covers file constraints,
sanitization, idempotent retry wording and truthful stored-asset/hash status.
Progress covers queued, paused, hold, rejected, scan, review, blocked,
sanitization and approval/review navigation states. API payloads, provider and
user-authored content, idempotency keys and safety interlocks are unchanged.

Pass criteria and evidence: core catalog/completeness tests 34/34; combined
dashboard generation, upload, progress, approval and transform tests 89/89;
core/dashboard typechecks pass; core/dashboard lint exits 0 with four
pre-existing dashboard `any` warnings; dashboard production build exits 0 with
explicit non-secret `API_ORIGIN`; `scripts/verify.sh` prints `verify: ok`;
source commit `6b418ae87a1430aed1ad101bb3b607d5774e9129` is pushed and read
back from the coordination branch. This closes only the source/automated
generation-workflow localization criterion. Browser/native, deployed
media/runtime, R2, provider, migration/RLS and production/operator acceptance
remain open. No live action occurred.

### M822 — F-89 caption evidence localization

The bounded caption-evidence surface now uses the shared six-locale catalog.
`CaptionGuidance` localizes its structural labels, missing/invalid/changed
receipt states, learned-example disclosure and UTC selection context.
`GeneratedCaptionReceipt` localizes saved-caption, enrichment and unavailable
status copy while preserving caption data and HTML escaping. No private
exemplar identifiers, hashes or provider payloads are exposed.

Pass criteria and evidence: core catalog/completeness tests 34/34; combined
dashboard generation, upload, progress, approval, transform and
caption-evidence tests 102/102; core/dashboard typechecks pass; core/dashboard
lint exits 0 with four pre-existing `any` warnings; dashboard production build
exits 0 with explicit non-secret `API_ORIGIN`; `scripts/verify.sh` prints
`verify: ok`; source commit
`2631a23ec5621b8593c54da6677839d7efac333e` is pushed and read back from the
coordination branch. This closes only the source/automated caption-evidence
localization criterion. Browser/native, deployed media/runtime, R2, provider,
migration/RLS and production/operator acceptance remain open. No live action
occurred.

### M824 — F-89 Patreon web localization

The authenticated Patreon page and client sync manager now use the shared
six-locale catalog for onboarding, scope disclosure, role-gated connection,
read/sync controls, resource counts, sync/webhook health, record tables and
the manual-assist boundary. OAuth, provider scopes, sync payloads, cursor
behavior, role checks and raw provider data are unchanged.

Pass criteria and evidence: core catalog/completeness tests 34/34; combined
dashboard generation, upload, progress, approval, transform, caption-evidence
and Patreon tests 107/107; core/dashboard typechecks pass; core/dashboard
lint exits 0 with four pre-existing `any` warnings; dashboard production
build exits 0 with explicit non-secret `API_ORIGIN`; `scripts/verify.sh`
prints `verify: ok`; source commit
`c56243fff44d87349ebbe5d3b5ba64586cb3e794` is pushed and read back from the
coordination branch. This closes only the source/automated Patreon web
localization criterion. Browser/native, deployed Patreon OAuth/webhook/sync,
R2, provider, migration/RLS and production/operator acceptance remain open.
No live action occurred.

### M856 — F-89 model Network route localization (local fallback)

The model Network page now uses the selected six-locale catalog for mounted
network/security status, OAuth notices, social-connection controls, role
guidance, connected-account tables and safe failure copy. Network `lastError`
values are intentionally reduced to a localized generic failure message rather
than being rendered into the page. Existing owner/manager/operator policy,
model scoping, OAuth endpoints, account payloads and child component contracts
remain unchanged.

Pass criteria and evidence: network route tests 16/16; core locale suite
105/105; full dashboard suite 145 files/893 tests; core/dashboard typechecks
and linters pass with four pre-existing dashboard `any` warnings; verify gate
prints `verify: ok`; source commit
`4884a0c2553729b5adef99abee5a72f1f9912e38` is pushed and read back. The
dashboard build compiles and reaches page generation but standalone tracing
cannot create pnpm symlinks on this Windows host (`EPERM`). This closes only
the source/automated Network localization criterion. Browser/native, provider,
migration/RLS, runtime, deployment and production/operator acceptance remain
open. No live action occurred.

### M857 — F-89 relay binding operator-surface localization (Codex local fallback)

`RelayBindingManager` now consumes the selected six-locale catalog through its
real parent route. Fixed guidance, empty/error/status/action copy,
confirmation text, form labels, accessible labels, validation, success,
unconfirmed and retry states are localized in en, es, ja, it, pt-BR and de.
Channel identifiers, chat references and provider data remain data.

API paths, request bodies, idempotency keys, response confirmation,
retry-same-intent behavior, role policy, model scoping, confirmation semantics
and channel values were preserved. Focused behavior tests pass 10/10; core
passes 19 files/105 tests; dashboard passes 145 files/902 tests;
core/dashboard typechecks pass; lint has no errors and retains four
pre-existing dashboard `any` warnings; `scripts/verify.sh` and `git diff
--check` pass. Source commit `7536083ba115ae8849c450c9dee677f10e8e14d7` is
pushed and read back. No live action occurred.

The Hermes F71 lane is closed as a transport-only stale lane: its authoritative
copy and delivery roots were absent, so no Hermes delivery was accepted. The
local source is canonical, and any future Hermes work must bind to a fresh
source audit rather than resume F71.

### M858 — F-89 workspace-member operator controls localization (Codex local)

The owner-gated workspace-member control now consumes the shared six-locale
catalog for its audit guidance, role labels and descriptions, current/new-role
labels, confirmation/retry/cancel actions, pagination, empty/load failures and
successful access-change notices. Member emails, backend role identifiers and
server response details remain data; role assignment, owner boundary,
idempotency, exact receipt validation and session-revocation semantics are
unchanged.

Pass criteria and evidence: focused WorkspaceMembers behavior tests 10/10;
core 19 files/106 tests including a six-locale member-key non-fallback check;
full dashboard 145 files/902 tests; core/dashboard typechecks pass;
core/dashboard lint exits with no errors and retains four pre-existing
dashboard `any` warnings; `scripts/verify.sh` returns `verify: ok`; and
`git diff --check` passes. Product commit
`224458139080fe674453e2a8116e42ca26b8c3f4` was pushed to
`origin/codex/telegram-webhook-hardening` and the remote SHA was read back
exactly. No live action occurred.
