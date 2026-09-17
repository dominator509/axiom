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

### 3. Team collaboration and shift management — source slice complete; browser/RLS gate open

- Add tenant-scoped team membership/role visibility, shift lifecycle, handoff notes, and bounded queue assignment using existing RBAC and RLS conventions.
- Expose the human workflow in a dedicated team/operations surface; keep infrastructure and secret controls out of content-team roles.
- [x] Gate: authorization/RLS and dashboard navigation tests pass; multi-user browser acceptance remains open.

### 4. Clipping and adaptation controls — source slice complete; deployment gate open

- Wire dashboard clip/resize/transcode controls to the existing media-plane operations.
- Persist operation intent/status and support platform adaptation of captions and formats without bypassing ToS, consent, approval, or idempotency.
- Keep adaptation separate from publication; failed or pending transforms must be visible and retry-safe.
- [x] Gate: route/worker/media-plane contract tests pass; deployed image and video rehearsal remains open.

### 5. Playbook and guideline management — source slice complete; acceptance gate open

- Extend the existing playbook store into model/org-scoped editable guidelines with revision history and audit records.
- Connect guideline reads to scheduling, generation, caption adaptation, and analytics surfaces without silently overriding explicit user input.
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

- Reconcile structured logs, request/job correlation, metrics, health/readiness, incident records, and provider/media audit events.
- Add deployment configuration checks for the selected telemetry backend, redaction, retention, and alert thresholds.
- Verify dashboards/alerts against a controlled failed job and recovery; do not treat a health endpoint as observability acceptance.

### 13. CI and branch-protection enforcement — protection verified; new release CI gate open

- Pin Node and pnpm to repository versions and require typecheck, tests, lint, build, migration checks, provider-contract tests, and security audit in CI.
- Make zero-test success impossible for production packages.
- [x] Classic branch protection API readback on 2026-09-17 confirms strict six required checks (typecheck, lint, test, build, security, container), one approving review, stale-review dismissal, admin enforcement, no force pushes and no deletions. This proves current enforcement, not permanent configuration or CI success on subsequent commits.
- Gate: hosted CI success for the audited commit and branch/ruleset readback. If GitHub credentials are unavailable, leave a precise operator command and mark the external gate open.

## Completion definition

The requested feature-completion goal is achieved only when the full architectural requirements and their source, automated, runtime and provider/operator gates are evidenced on the deployed immutable release. Recording a blocker documents incomplete work; it does not complete the goal. Progress reports must contain commit SHA, test/build receipts, runtime URLs, migration receipt, provider receipts and unresolved gates as applicable; they must not label the product production-ready while any required gate is open.
