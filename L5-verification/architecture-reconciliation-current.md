# Current architecture reconciliation

Date: 2026-09-20  
Repository: `dominator509/axiom`  
Source checkpoint: `6b418ae87a1430aed1ad101bb3b607d5774e9129`

This is a fact record, not a production-readiness claim. The requirements come
from `L1-product/L1.1-feature-catalog.md`; intended boundaries come from the
relevant `L2-architecture/` documents; API and MCP behavior comes from
`L3-specification/`; current wiring and gaps come from
`L5-verification/backend-frontend-coverage-audit.md` and the later milestone
receipts. Historical audit baselines are not silently treated as current source.

## Evidence vocabulary

- **Source-wired:** a real schema/API/worker/runtime path exists in this
  checkout. This is not browser, deployment, or provider acceptance.
- **Partial:** a source path exists, but the architecture contract or user
  workflow is incomplete.
- **Internal:** mechanics are intentionally not a direct user button; the
  user-facing outcome still requires acceptance.
- **Optional/not enabled:** the architecture explicitly does not require or
  expose this provider until its lifecycle is implemented.
- **Open gate:** source evidence exists or is planned, but runtime/provider/
  operator proof is missing.

## Reconciled status

| Architecture area | What the current evidence actually supports | Still open or explicitly bounded |
| --- | --- | --- |
| Model workspaces and character/profile controls (F-01/F-41) | Source-wired model workspace/profile and character-lock paths; role and browser acceptance remain separate. | Authenticated desktop/mobile acceptance and complete role matrix. |
| Network and per-model egress (F-02/F-04/F-43) | Model-scoped network configuration, encrypted credential paths, health/apply controls and Rust fail-closed code exist. | Privileged Linux namespace/WireGuard/proxy leak rehearsal, customer-configured egress runtime, and browser/operator acceptance. |
| Generation, ToS, approval and transforms (F-09/F-29/F-30/F-32/F-36/F-37) | Real API/worker/media-operation contracts and approval interlocks exist; clipping/adaptation and transforms have source tests. | Deployed media/vision runtime, playback, provider execution and complete user acceptance. |
| Uploaded/generated media | Upload is reachable directly from the model media library; source and kind filters fail closed and persist across cursor pagination; generated-asset storage, source-image selection, bounded previews and media operations exist in source; the listing now projects latest operation status, explicit unknown state for assets without an operation, and source/result relationships from the existing asset/media-operation/asset-variant graph. | R2 round-trip, deployed worker/media playback, browser/mobile interaction, approval/retry runtime acceptance, and full production evidence remain open. |
| Sanitization | `packages/worker/src/media-sanitizer.ts`, `scripts/sanitize-media.mjs` and the rehearsal script are real source. They rebuild supported JPEG/PNG/MP4 outputs and expose an opt-in path. | The CLI reports `externalProvenanceErased: false`; no claim is made for C2PA/external provenance removal or byte-fingerprint anonymity. |
| Variants and A/B (F-13/F-15/F-16) | Model-scoped lifecycle, assignments, exposure/outcome capture, attribution and winner/reward source paths exist. M578 wires server-verified existing-bundle guidance provenance through candidate creation, review-bundle revalidation, authenticated guidance-source listing and candidate/performance safe projections, with dashboard selection and truthful unavailable states. M793 localizes the model-scoped cascades route loaded/error shell, and M797 localizes the variant-experiments route loaded/error shell without changing scheduling or experiment mechanics. | Statistical/runtime/browser acceptance, deployed worker/provider acceptance, and any additional guidance fields not present in a verified source receipt remain open. |
| Team and shifts (F-24/F-25/F-26) | RBAC, shift lifecycle, handoff/post-note routes and dashboard controls exist. The dual-actor Chatter source slice adds human/LLM shift records, active-shift/agent-permission checks, durable roleplay handoffs, bounded memory and revisioned `soul.md` persona storage/API/UI. Team history now has bounded keyset pagination with dashboard older-history controls; Chatter roleplay uses its authorized personal shift roster rather than the administrative team endpoint. M667 adds a shared Grok roleplayer runtime and private assigned-LLM inbox drafting that reuses the pending-reply review flow, persists persona/memory provenance, and requires explicit human approval before send. M789 localizes the owner-gated workspace-members route shell, and M795 localizes the model-scoped team/shifts route loaded/error shell through the shared six-locale catalog while preserving the existing role boundary and team mechanics. | Authenticated multi-user browser/RLS acceptance, Grok roleplay and draft provider receipts, live migration/runtime acceptance and operator acceptance remain open. |
| Playbook (F-54/F-55/F-56/F-57) | Revisioned guideline storage/editor, calendar checks, generation/caption enrichment and read-only analytics context exist in source. Analytics renders saved platform guidance as advisory context without changing metric calculations or scheduling. | Browser acceptance, stale-editor/history acceptance, deployed migration acceptance, and any future consumer path not covered by the current source audit. |
| Scraper and research (F-17/F-18) | Authenticated bounded scrape runs, worker dispatch, model egress binding and partial-result/error handling exist. M577 aligns the durable `scrape_run` state, worker persistence and authenticated projection so mixed results remain `partial` end to end. M644 localizes the mounted result/refresh/history UI across all six launch locales with locale-aware counts and UTC timestamps while preserving authored/provider data and mutation semantics. M787 localizes the authenticated scraper route title and load-failure shell through the same catalog. | Deployed sidecar/provider isolation, benchmark history exposure, migration application, browser/mobile and result-quality acceptance. |
| Viral loop (F-79–F-86) | Metric/evidence filtering, publication-bound recipe evidence (hook, scheduled/actual time, bounded shoot controls, media format, ToS verdict and asset/hash-bound Rust vision descriptors), labels, recipes, embeddings/retrieval, parts of reward/digest logic, and a typed Relay-card lifecycle distinguishing durable `stored` evidence from external-dispatch states exist. | Revenue/conversion attribution, all contextual arms, cross-model opt-in behavior, scheduled insight/Relay delivery, migration application and runtime acceptance. |
| Connectors and OAuth (F-03/F-31/F-58–F-67) | Static connector contracts and capability declarations exist for supported paths. M791 localizes the authenticated Grok connection/storage route shell while preserving role-scoped account and private-storage controls. | Live OAuth, refresh/revoke/disconnect, account onboarding, provider upload/publish/metrics receipts and browser acceptance. Snapchat remains capability-honest manual-assist where its API does not support organic posting. |
| Patreon creator/community integration (F-91) | **Wired/partial:** the pure v2 community connector is now wired through authored migration 0055, tenant/model-scoped campaign/member/post/sync/webhook tables with RLS, model-egress OAuth/PKCE and encrypted account persistence, bounded cursor sync, durable replay guards, signed webhook ingress, a model dashboard, and a native mobile community surface with assigned-model scoping, redacted status/read views and operator-only sync controls. | Deployed migration/RLS/runtime acceptance, real provider OAuth/webhook/sync receipts, browser/mobile acceptance and operational reconciliation remain open. No publish/DM/payout/member-mutation/unsupported-analytics claim. |
| Link-in-bio (F-48–F-53) | The Native provider is the current production-enabled default. | Fanlynks, Linktree and Beacons are optional planned adapters and must remain hidden/rejected until their full lifecycle exists; a database row is not evidence of a connection. |
| Localization and language switching (F-89) | **Source-wired/partial:** the shared six-locale catalog, BCP-47 normalization, precedence resolution, persisted user/org preference API, portfolio home shell, model overview profile/network/activity/tool route shell, dashboard provider/navigation/settings wiring, authenticated shell workspace/role/pending/footer/system-health copy, login hero/form labels/errors/session advice, assigned shifts, incidents/crash triage/recovery and localized publishing-safety controls with locale-aware UTC dates, team-shift controls, TeamOperationsManager labels/errors/roles/notes, the model-scoped team/shifts route shell, the model-scoped variant-experiments route shell, digest page/scheduling/recovery controls, Relay history/delivery surfaces, Calendar month/week navigation, drag/date controls, schedule form, status labels and advisory time windows, media approval child controls for generation retry, prompt suggestions and clip/resize/transcode operations, and the generation form, upload workflow and live generation-progress states now consume the same catalog. Locale-aware UTC timestamps, accessible `lang` metadata, and mounted mobile selector, LoginScreen, DashboardScreen, RelayScreen and PatreonScreen labels/statuses/date/count formatting remain wired. UI language remains separate from authored content language. | Complete catalog adoption across remaining dashboard/email/operator surfaces, browser/native mobile acceptance, locale-aware formatting audit for every date/number/currency surface, and deployed migration/RLS/runtime evidence remain open. |
| FanThynks platform affiliate program (F-90) | **Wired/partial:** native platform-level affiliate schema and authored migration 0054, owner-gated API routes, disclosure-gated partner/campaign controls, attribution/conversion/commission/hold state, audit/idempotency and non-transfer payout CSV generation exist; no third-party affiliate stack was imported. | Migration application, native license/security/legal review, browser acceptance, billing/reconciliation integration, payout-provider/operator acceptance and export/deletion evidence remain open. Tenant-owned affiliate builders and creator resale controls are out of scope. |
| R2 media storage | Grok R2 credential storage/status/verify routes, encrypted managed config and tests exist. | A real configured bucket round-trip through the deployed application, retention/delete evidence and operator acceptance. |
| Relay and operator controls (F-68–F-72) | Cards, signed/replay-protected command paths, several approval/revision/review workflows, and a model-scoped cursor-paginated/redacted Relay-card history with an approval deep-link are source-wired. | Attachment sending, external delivery, uncertain-outcome reconciliation and deployed channel acceptance. |
| Observability (F-73–F-78) | Internal crash sink, error boundary, correlation and durable DLQ-related source paths exist. | GlitchTip/Sentry, Loki, Prometheus/Grafana, OpenTelemetry, alerts, crash-loop paging and deployed failed-job recovery. L2.9 explicitly treats those as runtime integrations, not bundled proof. |
| Deployment and release | CI, migration/recovery scripts and a bridge exist; the Hermes target-context repair is not integrated. | Safe installer/bridge source repair, isolated migration/rollback, immutable TEST deployment, worker/media readiness, branch protection readback for the new SHA and production/operator gates. |

## Reconciliation rule

No item above is promoted from partial/open to complete because a page exists,
a route is registered, a unit test passes, a health endpoint returns 200, or a
provider row exists. The next implementation node must cite the exact source
paths, contract tests and remaining runtime/provider evidence before the status
changes.

## Current source correction — calendar surface

The calendar row above is now additionally source-wired for a responsive
month/week visual board, guarded pending-post day moves, and an accessible
keyboard/date move control. The board reuses the existing post PATCH contract
and verifies the returned identity, state, and schedule before refreshing. It
also renders advisory time windows derived from verified viral-performance
buckets without scheduling or publishing. This changes only the source-wired
column; authenticated browser/mobile interaction, provider execution, and
deployed runtime acceptance remain open.

## Explicit owner extension — dual-actor Chatter roleplayer

The owner has extended the Chatter requirement: the assigned actor may be a
real human or an approved model-scoped LLM, with Grok as the first roleplayer
provider and Venice preserved as a future provider-compatible option. This is
an architecture extension, not evidence that the feature already exists.
The current source has human Chatter assignment/shift policy, model-scoped
agent permissions, Grok subscription transport, persona/playbook prompt
segments, and audited reply intents as separate contracts. It does not yet
prove their safe composition.

The required implementation must keep one assignment, consent, safety,
approval, idempotency, audit and uncertain-delivery boundary for both actor
types. Its handoff must be actor-agnostic and readable by humans and LLMs,
including actor type/reference, org/model, active shift, conversation cursor,
queue, last safe summary, pending intent, memory policy, persona source and
persona revision. LLM roleplay additionally requires bounded
tenant/model-scoped conversation memory and an optional versioned
`soul.md`-style persona source with size, traversal, revision, audit and
instruction-data safeguards. No provider, deployment, live OAuth, or
publication evidence is implied until separately demonstrated.

Current source progress: `packages/llm-gateway/src/roleplay-context.ts` now
exports a shared actor-agnostic handoff formatter, bounded memory window,
revisioned persona snapshot validator and `soul.md`-style source-reference
contract. It performs no filesystem reads, persistence or provider calls. The
DB/API/dashboard assignment, durable memory/persona storage and runtime
acceptance gates remain open.

M429 extends that source contract with a versioned canonical JSON envelope and
round-trip parser, a human/LLM prompt-context formatter, bounded persona
guidance rendering, and `loadRoleplaySoulSnapshot`. The loader accepts only an
approved tenant/model-scoped reader result; it does not resolve arbitrary
filesystem paths or follow symlinks. Evidence is 12 focused roleplay tests,
gateway typecheck, lint with the existing 16 warnings, and diff-check on
commit `ddd8314`. Durable storage, API/dashboard assignment controls, Grok
dispatch and runtime/provider acceptance remain open.

M431 wires the durable source slice without inventing a second assignment or
permission system. `packages/db/src/schema/roleplay.ts` and migration `0050`
add actor-aware shifts, immutable persona revisions, ordered bounded memory
turns, and one resumable handoff per conversation with tenant RLS and explicit
least-privilege grants. `packages/api/src/routes/roleplay.ts` rechecks model
access, active shifts, LLM edit permission, optimistic revisions and bounded
payloads before persistence; the dashboard exposes the Chatter & roleplay tab,
human/LLM shift selection, handoff editing, memory retention and local
`soul.md`/persona text loading. DB tests pass 151/151, targeted API tests pass
160/160 and targeted dashboard navigation tests pass 40/40. The gateway's
roleplay tests pass 12/12; its full suite still has four pre-existing
Windows subscription-process termination failures. Migration `0050` has not
been run, and no provider call, live action or deployment acceptance is
claimed.

### M556 — assigned-shift server localization

The authenticated `/shifts` page now resolves the persisted UI locale through a
server-side catalog helper instead of emitting English-only copy. Access
denials, roster description/warnings, refresh and load-failure states, empty
rosters, handoff notes, queue/status labels, active-window guidance, terminal
states, pagination labels and time-range labels are covered by all six launch
catalogs. Valid shift times render through `Intl.DateTimeFormat` in UTC while
machine-readable `<time>` values remain ISO timestamps; user/provider/shift
content is not translated. Focused shifts tests (13/13), the full dashboard
suite (731/731), core suite (65/65), dashboard typecheck and elevated
production build passed. No migration, provider, runtime, browser or
deployment evidence is claimed; remaining F-89 catalog adoption and external
acceptance gates stay open.

### M558 — team-shift control localization

The reusable `TeamShiftCard` now consumes the shared locale provider for its
handoff editor, save/immutability guidance, start/complete/cancel controls and
assignee/time summary. Shift timestamps use `Intl.DateTimeFormat` with an
explicit UTC zone, and the assignee value remains escaped interpolation rather
than translated content. Core tests/build, the TeamShiftCard locale test and
dashboard typecheck passed; the full dashboard suite passed 732/732. This is a
source/UI improvement only: role policy, shift transitions, migrations,
provider/runtime, browser and deployment gates remain open.

### M559 — team operations manager localization

The reusable `TeamOperationsManager` now consumes the shared six-locale catalog
for shift and note labels, actor types, role labels, validation/errors, retry
controls and pagination controls. Note timestamps use explicit UTC formatting;
human/LLM references and authored note content remain interpolated or preserved
as data rather than translated. Core tests passed 65/65, focused team-operation
tests passed 7/7, the full dashboard suite passed 734/734 and dashboard
typecheck passed. This is a source/UI improvement only: role policy, shift
transitions, migrations, provider/runtime, browser and deployment gates remain
open.

### M560 — digest and Relay surface localization

Hermes' scoped R3 archive was independently audited before integration. The
archive SHA-256 is
`de033fae7281a2ae93b91b31946bc24dfbd3bd75694a0e294a7b31b85140fbbd`; the
12 declared changed source paths were copied individually and every declared
file SHA-256 matched the delivery. The merge preserved the already accepted
TeamShiftCard and TeamOperationsManager locale keys rather than replacing the
current branch catalog wholesale.

The digest page, digest generation/schedule/recovery controls, Relay page and
cursor-paginated Relay-card history now consume the shared six-locale catalog.
Stored-vs-external-delivery wording, authored card data, safe local API
accessors and UTC timestamps remain explicit; no provider or publication claim
is inferred from a stored card. Core tests passed 65/65, the focused digest and
Relay suite passed 19/19, the full dashboard suite passed 739/739 and dashboard
typecheck passed. Source commit `789edae3ba0c357e9e5a8ffb67329281c1076a65`.
This is source/UI evidence only: worker delivery, external Relay, migration,
provider, browser, mobile and deployment gates remain open.

### M562 — authenticated workspace-settings localization

The authenticated owner settings page and `OrgSettingsForm` now consume the
shared six-locale catalog for the workspace heading, load failure, accessible
form name, viral-sharing/digest/publishing controls, safety explanations,
success/error states and retry/save actions. Existing settings mutation
idempotency, response confirmation and retry semantics were preserved.
Core tests passed 65/65, the focused settings/localization suite passed 6/6,
the full dashboard suite passed 741/741 and dashboard typecheck passed. Source
commit `2c51eafef2188cbe7fdbd2fdea9d21b85211fb7b`. This is source/UI evidence
only: remaining catalog adoption, locale-aware formatting, browser/mobile,
provider, migration/RLS, runtime and deployment gates remain open.

### M564 — analytics surface localization and formatting

The model analytics page now consumes the shared six-locale catalog for access
states, report actions, metric labels, playbook context, viral insight copy and
empty/error states. Counts and engagement percentages use the selected locale's
`Intl.NumberFormat`; authored platform names, labels and provider observations
remain data rather than being silently translated. Core tests passed 65/65, the
analytics/settings focused dashboard slice passed 10/10, the full dashboard
suite passed 742/742 and dashboard typecheck passed. Source commit
`beac9152634bfeddf61755b2d7c0f33c735e7043`. Provider, browser/PDF, mobile,
migration/RLS, runtime and deployment evidence remain open.

## Explicit owner extensions — localization and platform affiliate stack

### F-89: multilingual product surface

The product must support English (`en`), Spanish (`es`), Japanese (`ja`),
Italian (`it`), Brazilian Portuguese (`pt-BR`) and German (`de`) at launch.
Portuguese is intentionally represented as `pt-BR` rather than an ambiguous
`pt`; `pt-PT` can be added as a catalog extension without changing the
contract. Locale selection is a user-visible setting with this precedence:
explicit user choice, organization default, browser `Accept-Language` on first
visit, then English. The selected locale must persist across web, native
mobile and authentication flows.

All UI, validation, API error presentation, email/operator notifications and
accessible labels use versioned, typed message keys in a shared catalog. ICU
plural/select formatting and `Intl` number, currency, date, time-zone and
relative-time formatting are required. Missing translations fall back to
English and emit a test-visible diagnostic; raw keys must never be shown to
users. User/creator text, provider text and generated content are not silently
translated: UI locale and model/content locale are separate fields and any
translation action is explicit and audited.

### F-90: FanThynks platform affiliate/referral control plane

F-90 is the Axiom/FanThynks platform-acquisition program for partners who refer
creators to the FanThynks SaaS. It is not a tenant-facing affiliate-program
builder, creator referral program or customer resale control plane. The minimum
durable contract is: platform program, partner/affiliate, campaign/link,
click/visit, identity stitch, referred-creator SaaS conversion, commission
accrual, review, reversal/refund, payout batch/export, fraud/hold state,
disclosure/consent, idempotency and audit. Attribution events are immutable;
commission and payout views are derived and re-computable. No affiliate event
can create a publication, billing or payout side effect without its own
approval and idempotency fence.

The platform affiliate UI must support partner onboarding/revocation, link and
campaign management, conversion/commission review, payout export, fraud holds,
program terms, disclosures, export/deletion and role-aware platform
administration. Partners may see only their own attribution and payout views;
they cannot see another partner's or referred creator's unrelated customers,
content, credentials or records. White-label/resale permissions remain a
license-selection requirement for any imported component, not a tenant-facing
F-90 feature.

#### License and import decision

OpenPartner (`getcoherence/openpartner`) and Refferq (`Refferq/Refferq`) are
MIT-licensed candidates. MIT permits modification, distribution, sublicensing
and sale, subject to preserving copyright/license notices; their upstream
trademarks and third-party dependencies remain separate obligations. RefKit's
application is AGPL-3.0 while its SDK/CLI/MCP are MIT; AGPL permits commercial
distribution but carries network-copyleft/source-notice obligations and is not
the default for a proprietary white-label FanThynks deployment. These are
license-fit findings, not a security or production-hardening certification.

No candidate currently satisfies the stronger requirement “already made and
hardened” on the evidence available to this repository. OpenPartner is the
first isolated evaluation candidate because its documented event-sourced
click→identity→conversion→attribution→payout shape and Stripe Connect path
best match the contract. It must pass a pinned-source dependency/SBOM review,
auth/session and tenant-isolation review, webhook-signature/idempotency review,
fraud/chargeback/payout review, data-export/deletion review and focused tests
before import. If it fails any gate, FanThynks builds F-90 in its existing
PostgreSQL/RLS/API/worker/dashboard architecture; no unreviewed affiliate
repository is copied into production.

License/source references for the candidate review: OpenPartner README and MIT
license at `https://github.com/getcoherence/openpartner` and
`https://raw.githubusercontent.com/getcoherence/openpartner/main/LICENSE`;
Refferq README and MIT license at `https://github.com/Refferq/Refferq` and
`https://raw.githubusercontent.com/Refferq/Refferq/main/LICENSE`; RefKit's
application/SDK license split at `https://refkit.net/` and
`https://raw.githubusercontent.com/refkitnet/RefKit/main/LICENSE`.

### F-91: Patreon creator/community integration

Patreon is added as an architecture-level provider integration for creators who
use Patreon alongside Fanvue and the other social surfaces. It is not counted
as one of the ten publishing social networks. The planned integration reuses
the existing model/org-scoped connection, OAuth state/PKCE, encrypted token,
model egress, worker queue, webhook ingress, idempotency, audit, RLS and
dashboard integration contracts.

The official [Patreon API Reference](https://docs.patreon.com/) documents API
v2 OAuth and the scopes `identity`, `identity.memberships`, `campaigns`,
`campaigns.members`, `campaigns.posts`, and `w:campaigns.webhook`. Those
surfaces support creator/campaign identity, membership/tier synchronization,
post read history and campaign webhooks. Sensitive email/address scopes are
optional and must not be requested by default. API v1 is scheduled to retire
on 2026-10-07; the implementation is v2-only.

The provider matrix is capability-honest: Patreon publish is `none` in the
current documented contract, with `manual-assist` as the only content handoff
option. Patreon webhook triggers named `posts:publish`, `posts:update` and
`posts:delete` are inbound notifications, not write authority. The product
must not expose Patreon DMs, payouts, member mutations, or normalized
performance analytics until official documentation and scopes prove them.
Member identity may be masked by the member, so null/hidden values are valid
and must never be replaced with guessed data.

No public Patreon sandbox is documented. The source implementation uses redacted
JSON fixtures, pagination samples and HMAC signature vectors. It now includes
the source-side OAuth callback, encrypted connection persistence, normalized
campaign/member/post reads, durable cursor/replay state, signed webhook event
persistence and a dashboard surface. A live creator account, OAuth receipt,
webhook delivery, sync receipt, mobile/manual browser acceptance and deployed
migration/RLS receipt remain separate open gates. The source implementation
does not authorize live provider activity.

### M521 source validation correction

The full disposable source matrix found and closed four local regressions: the
Patreon community route is now reachable from the talent workspace tabs,
Chatter human actors prefer the authenticated display name with a typed session
field, the DB relation-count invariant matches the exported roleplay relations,
and the mobile locale selector uses the existing panel theme token. This is a
source/build correction only. Deployed migration/RLS, provider
OAuth/webhook/sync, browser/mobile and operational acceptance remain open.

### M580 source-lane checkpoint

The source audit identified a distinct remaining F-89 slice in mounted
operator surfaces: Audit, Approvals, Playbook history, AgentPermissionManager
and TriggerRuleManager still contain raw visible English and/or host-locale
date/count/percentage formatting. The bounded
`F89-DASHBOARD-OPERATOR-FORMATTING-R1` task is assigned to Hermes against the
current pushed branch tip. This is a source-only lane; browser/mobile,
deployed migration/RLS/runtime and external provider evidence remain open.

### M757 source-lane checkpoint

The AgentPermissionManager portion of the operator-formatting gap is now
closed in the current source. Token expiry presentation uses the shared
locale-aware formatter with an explicit UTC zone rather than the host
environment's `toLocaleString()` behavior. Agent references, token IDs and
other capability metadata remain unchanged data. The focused AgentPermission,
PlaybookHistory and TriggerRuleManager component suite passed 8/8, dashboard
typecheck and lint passed, and the core package rebuilt successfully. The
remaining operator-formatting work is limited to the separately audited
Audit, Approvals and TriggerRuleManager criteria; browser/mobile, deployed
migration/RLS/runtime and external provider evidence remain open.

### M759 source-lane checkpoint

TriggerRuleManager now uses the shared locale-aware formatter with an explicit
UTC zone for last-fired values. Rule names, provider platform identifiers,
thresholds and authored styles remain data. The focused
AgentPermissionManager, PlaybookHistory and TriggerRuleManager suite passed
9/9, dashboard typecheck and lint passed, and the formatting diff is clean.
This closes the TriggerRuleManager date-formatting criterion only; Audit and
Approvals operator surfaces plus browser/mobile, deployed migration/RLS,
runtime and external provider evidence remain open.

### M761 source-lane checkpoint

The mounted `ApproveButtons` control now uses the shared six-locale catalog for
all user-visible scheduling, account-selection, unresolved-intent, caption
revision and approval/rejection copy. Existing idempotency keys, retry of the
unchanged request, response identity/state checks and ToS publication gate are
unchanged. Focused approval plus prior operator-surface tests pass 41/41;
core build/tests, dashboard typecheck/lint and diff checks pass. This is a
source/UI criterion closure only. Audit and remaining catalog adoption,
browser/native, provider, migration/RLS, runtime and deployment evidence remain
open.

### M763 source-lane checkpoint

The media-to-review entry point `MediaBundleCreate` now uses the shared
six-locale catalog for its visible controls and safety states, including the
explicit no-publication explanation and MP4 requirement. Existing idempotent
payload/retry behavior, requested-schedule confirmation and approvals routing
remain unchanged. Focused MediaBundleCreate tests pass 3/3 and the combined
approval/operator source suite passes 47/47; core build/tests, dashboard
typecheck/lint and diff checks pass. This is a source/UI criterion closure
only. Other approval children plus browser/native, provider, migration/RLS,
runtime and deployment evidence remain open.

### M581 source-lane checkpoint

The mobile F-89 audit found raw language/delivery labels and host-locale
date/count formatting still mounted in `DashboardScreen` and `RelayScreen`.
The bounded `F89-MOBILE-RELAY-FORMATTING-R1` task is assigned to Hermes against
the current pushed branch tip. This is source-only; native/browser, deployed
migration/RLS/runtime and external provider evidence remain open.

### M582 source-lane checkpoint

The desktop operator-formatting ACK was rejected for WIRE collision: Hermes
reused the task WIRE in the reply and `IN_REPLY_TO`. A strict correction
receipt now requires a unique correlated ACK before the lane can advance. No
operator source delivery is accepted; the existing five-surface localization
gap remains open alongside the agentic-drafting and mobile lanes.

### M583 source-lane checkpoint

F-81/F-84 remains source-partial because `recipe-evidence.ts` explicitly omits
thumbnail descriptors until a trusted vision receipt exists, while the local
vision wire currently exposes only ToS/analysis data. A bounded current-source
Hermes task now targets that existing Rust -> TypeScript -> worker -> viral
recipe path. Conversion attribution remains unavailable unless an authoritative
provider field is present; no synthetic metric is permitted.

### M593 source checkpoint

F-81/F-84 trusted thumbnail evidence is now source-wired through the existing
Rust vision, ToS, content-bundle, publication-snapshot and viral-recipe paths
at commit `81ef2069aae36256bed673c093ec5fbe16212cd6`. The receipt is versioned,
Rust-only, asset-ID/SHA-256 bound and bounded; override, fallback, malformed,
divergent and wrong-asset inputs remain unknown. Focused and full owning
package tests, typechecks, builds and lints passed with only pre-existing lint
warnings. This is not runtime or provider evidence: conversion/revenue
attribution, migration/RLS, browser/mobile, deployed worker/media and provider
acceptance remain open.

### M599 source checkpoint

The mounted Audit page now consumes the shared six-locale catalog for its
heading, chain-valid/broken state, entry labels, empty state and load failure.
Audit timestamps use the existing server-locale UTC formatter rather than the
host locale, and backend errors are not rendered raw. Core catalog tests passed
74/74 and the full dashboard suite, dashboard typecheck and lint passed with
only pre-existing warnings. Remaining approvals, playbook, agent-access and
automation-rule operator surfaces still require the same catalog/UTC audit.

### M601 source checkpoint

Approvals/review drafts, playbook score/history, model agent access and
automation-rule pages now use the shared six-locale catalog. Review and
playbook timestamps use the server-locale UTC formatter; access, empty,
unavailable and no-state-change messages are localized without exposing raw
backend errors. Existing approval, playbook and full dashboard behavior tests
remain green; typecheck is clean and lint has only pre-existing warnings.
Reusable child components and browser/native acceptance remain separate gates.

### M603 source checkpoint

The reusable `AgentPermissionManager` now consumes typed six-locale messages
for capability-scope explanations, tier labels, token issuance/revocation,
owner-only boundaries, confirmations, validation and retry states. Agent
references, bearer tokens and token timestamps remain data; only the UI copy
is translated. Mounted-render coverage covers Spanish and German editable and
read-only controls without emitting the English labels in those paths.

Evidence: core tests 74/74, core build and lint pass, focused
agent-permission tests 2/2, full dashboard tests 755/755, dashboard typecheck
pass and dashboard lint has only the three pre-existing warnings in
`MediaBundleCreate.behavior.test.tsx`. Source commit
`f920eb07bfe09fabb2ecdd96fe862f862df09d7c`. Browser/native, provider,
migration/RLS, runtime and deployment gates remain open.

### M607 source checkpoint

The reusable `TriggerRuleManager` now consumes typed six-locale messages for
rule descriptions, empty/read-only boundaries, metric and action labels,
validation, confirmation, retry and mutation status. Rule names, provider
identifiers, thresholds and authored follow-up styles remain data. Locale-aware
date formatting is used for last-fired timestamps. Mounted-render coverage
proves Spanish editable controls and German read-only controls without the
English labels in those paths.

Evidence: core 74/74, core build/lint, focused trigger-rule tests 2/2, full
dashboard 757/757, dashboard typecheck, dashboard lint with only the three
pre-existing warnings in `MediaBundleCreate.behavior.test.tsx`, and `git diff
--check` pass. Source commit `ea3ad70c33399edb8a8fc37dd76e04b9856ec661`.
Browser/native, provider, migration/RLS, runtime and deployment gates remain
open.

### M609 source checkpoint

The reusable `PlaybookGuidelineManager` now consumes typed six-locale messages
for editor labels, revision state, placeholders, save/retry/error feedback and
the owner-only boundary. Platform identifiers and authored upsell strategy
text remain data. Mounted-render coverage proves Spanish editable controls and
German read-only controls without the English save labels in those paths.

Evidence: core 74/74, core build/lint, focused playbook-manager tests 2/2, full
dashboard 759/759, dashboard typecheck, dashboard lint with only the three
pre-existing warnings in `MediaBundleCreate.behavior.test.tsx`, and `git diff
--check` pass. Source commit `ee4fceedabeb8308055cd7af260584e25f8d214b`.
Browser/native, provider, migration/RLS, runtime and deployment gates remain
open.

### M584 source-lane checkpoint

The desktop operator-formatting lane's corrected WIRE was unique, but its ACK
used invalid `STATE: OPEN`. Codex rejected that transport envelope with a
validated strict receipt requiring a valid `ACCEPTED` or `READ` ACK state and a
unique correlation. The correction readback SHA-256 is
`288a5433ab6ba1889a9dc3e13bcd8e6507f75ddf07023a18b6f0725c8b507a4f`.
The five-surface operator localization gap remains open; no source delivery is
accepted and no runtime/provider/database/deployment action occurred.

### M585 source-lane checkpoint

The F81/F84 lane was blocked only because Hermes could not fetch the exact
current source commit. Codex supplied and hash-verified a tracked-source
archive from `ac7961b9444fea4ec538e84c5980afca84e69ea6` and reissued the task
against a writable isolated copy root. Archive SHA-256 is
`92fffb7bf4d02352420ba3d7ece86411e41afa2bc590234c7f7577df18e92e11`; task
envelope SHA-256 is
`a9a099c041bb4429f6389f47aab4e925499ef34d6d6246ce6bb0e85bdb0ba1b9`.
No implementation delivery is accepted until Hermes returns changed paths,
tests and hashes.

### M586 source-lane checkpoint

The F89 mobile Relay delivery is now source-integrated at
`94416816354926e2e0282420e360defa1a9655dd`. Mounted `DashboardScreen` and
`RelayScreen` consume the shared six-locale catalog for visible labels,
delivery/status states, empty/error/retry copy and locale-aware date/count
formatting. Core catalog and mounted-screen behavior tests cover the reachable
surfaces. Codex also corrected the test config's root/env boundary and the
Relay error-versus-empty rendering ambiguity found during review.

Mobile 19/19, core 74/74 and dashboard 753/753 tests pass; mobile/core
typechecks and linters pass; mobile TypeScript plus Expo web export passes.
This is source evidence only. Native/browser, deployed migration/RLS/runtime,
provider and complete remaining catalog-adoption gates remain open.

### M667 — F-31 assigned-LLM private inbox drafting

The previously stale Hermes lane is quarantined; no Hermes artifact is treated
as source evidence. The local source now connects the existing Chatter
roleplay runtime to a private assigned-LLM inbox-draft workflow. Authorization
requires the same org/model boundary, an active LLM team shift, agent edit
permission, an active exact Fanvue connection, a matching roleplay handoff,
the latest `soul.md` persona and bounded memory. A bounded Grok result becomes
an immutable pending `inbox_reply_intent` linked to a roleplay turn; replay is
idempotent, scope mismatches conflict, and provider rejection/uncertainty is
not sendable.

The dashboard exposes generation and provenance, then requires explicit human
approval before the existing text-only send confirmation. `reply-dispatch`
rejects unapproved LLM drafts even if a caller bypasses the UI. Migration
0058 is authored for the new provenance/approval contract but is not applied.
API focused tests 28/28, dashboard focused tests 12/12, full API 1,097
passed/50 skipped, DB 155 passed/17 skipped and the complete 12-package build
pass. Source commit `7ff39ea66cc601c1c2e0659d5e2f36cdb942f3d5` is pushed to
`origin/codex/telegram-webhook-hardening`. This is source/automated evidence only; live migration, provider,
browser/mobile and deployment evidence remain open.

### M644 source checkpoint — scraper result/history localization

The mounted scraper result, refresh and run-history surfaces now consume the
shared six-locale catalog. State labels, profile/count labels, lookup failures,
empty states, pagination, queue/retry controls and user-facing errors are
localized. Counts use the selected locale, completed timestamps use an
explicit UTC formatter, and provider/authored values remain data. Existing
authorization, idempotency, API payload and retry behavior is unchanged.

Evidence: core tests 80/80, dashboard tests 779/779, core/dashboard
typechecks pass, core lint passes, dashboard lint has only the three
pre-existing warnings in `MediaBundleCreate.behavior.test.tsx`, and diff-check
passes. Source commit `f90e13d5d5e17f2f96c242ca393ac07f7b4e32a0`. This is a
source/UI slice only; browser/mobile, deployed migration/RLS/runtime, provider
and deployment acceptance remain open.

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

Evidence: Calendar page/board/schedule/optimal-time tests 20/20, core tests
80/80, core build, dashboard typecheck and `git diff --check` pass. This is
source and automated evidence only; remaining dashboard catalog adoption,
browser/mobile acceptance, provider, migration/RLS, runtime and deployment
gates remain open.

### M795 — F-89 model team route-shell localization

The model-scoped Team & shifts route now resolves the persisted interface
locale through the shared server-locale helper. Loaded, unavailable and
load-failure copy use typed catalog keys in all six launch locales. Existing
owner-only assignment visibility, model-scoped team operations, shift
lifecycle, handoff notes, actor selection and Chatter mechanics are unchanged;
this closes the route-shell criterion only.

Evidence: focused team route tests 7/7, core locale tests 28/28, core and
dashboard typechecks, core build, focused ESLint for changed files and
`git diff --check` pass. Source commit
`0b7d4b232d9f590e56a1e80013c79d5491b063a2` is pushed and read back from
`origin/codex/telegram-webhook-hardening`. Browser/mobile, multi-user/RLS,
Grok/provider, migration, runtime and deployment acceptance remain open.

### M797 — F-89 variant-experiments route-shell localization

The model-scoped variant-experiments route now resolves the persisted
interface locale through the shared server-locale helper. Loaded, unavailable
and load-failure copy use typed catalog keys in all six launch locales.
Existing model scope, edit-role calculation, experiment lifecycle, candidate
selection, outcome tracking and winner promotion mechanics are unchanged; this
closes the route-shell criterion only.

Evidence: focused experiments route tests 2/2, core locale tests 28/28, core
and dashboard typechecks, core build, focused ESLint for changed files and
`git diff --check` pass. Source commit
`f8aaaff7464672234e78cd55043965def328d7e5` is pushed and read back from
`origin/codex/telegram-webhook-hardening`. Browser/mobile, statistical,
worker/provider, migration, runtime and deployment acceptance remain open.

### M799 — F-89 portfolio home-shell localization

The authenticated portfolio home now resolves the persisted interface locale
through the shared server-locale helper. Hero, setup guidance, summary cards,
empty/error states, roster labels, profile status labels, direct actions and
pagination copy use typed catalog keys in all six launch locales. Dynamic
profile names, handles, biographies and backend error data remain data; model
listing, aggregate counts, cursor handling and direct navigation behavior are
unchanged.

Evidence: existing home behavior tests 7/7, core locale tests 28/28, core and
dashboard typechecks, core build, focused ESLint for changed files and
`git diff --check` pass. Source commit
`4a3bb9e0511e83aff2781612a98436d08b8039ee` is pushed and read back from
`origin/codex/telegram-webhook-hardening`. Browser/mobile, deployed runtime,
provider, migration and deployment acceptance remain open.

### M818 — F-89 media approval child-control localization

The remaining mounted media approval child controls now consume the shared
six-locale catalog. `GenerationRetry` localizes retry guidance, consent,
reviewed-prompt actions and bounded failure states; `MediaPromptSuggestion`
localizes suggestion consent, diff/review labels, character-lock context and
provider-failure states; and `MediaOperationControls` localizes transform
history, operation/status labels, clip/resize/transcode controls, retry
feedback and safety summaries. Existing payloads, idempotency keys, approval
interlocks, role checks and raw provider/user-authored data are unchanged.

Evidence: core catalog/completeness tests 34/34; dashboard focused media
approval suite 57/57; core and dashboard typechecks pass; core and dashboard
lint pass with four pre-existing dashboard `any` warnings; dashboard
production build passes with explicit non-secret `API_ORIGIN`; `verify.sh`
prints `verify: ok`; source commit `6ac4c8c0e965fba69d090366f302f9e4c216c9a1`
is pushed and read back from `origin/codex/telegram-webhook-hardening`.
Browser/native, deployed media/runtime, R2, provider, migration/RLS and
production acceptance remain open. No live action occurred.

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

Evidence: core catalog/completeness tests 34/34; combined dashboard generation,
upload, progress, approval and transform tests 89/89; core/dashboard
typechecks pass; core/dashboard lint exits 0 with four pre-existing dashboard
`any` warnings; dashboard production build exits 0 with explicit non-secret
`API_ORIGIN`; `verify.sh` prints `verify: ok`; source commit
`6b418ae87a1430aed1ad101bb3b607d5774e9129` is pushed and read back from
`origin/codex/telegram-webhook-hardening`. Browser/native, deployed
media/runtime, R2, provider, migration/RLS and production acceptance remain
open. No live action occurred.

### M822 — F-89 caption evidence localization

`CaptionGuidance` and `GeneratedCaptionReceipt` now consume typed six-locale
catalog keys for guidance summaries, evidence states, selection context and
saved-caption enrichment status. Caption text, platform identifiers, hashes,
exemplar identifiers and provider/user-authored values remain data; the
private guidance payload is still not rendered.

Evidence: core catalog/completeness tests 34/34; combined dashboard
generation, upload, progress, approval, transform and caption-evidence tests
102/102; core/dashboard typechecks pass; core/dashboard lint exits 0 with four
pre-existing `any` warnings; dashboard production build exits 0 with explicit
non-secret `API_ORIGIN`; `verify.sh` prints `verify: ok`; source commit
`2631a23ec5621b8593c54da6677839d7efac333e` is pushed and read back from
`origin/codex/telegram-webhook-hardening`. Browser/native, deployed
media/runtime, R2, provider, migration/RLS and production acceptance remain
open. No live action occurred.

### M824 — F-89 Patreon web localization

The authenticated Patreon page and its client sync manager now consume typed
six-locale catalog keys for onboarding, documented scope disclosure,
role-gated connection, read/sync status, campaign/member/post controls, sync
health, webhook health, saved-record tables and the manual-assist boundary.
OAuth, provider scopes, sync endpoints, cursor behavior, role gates and
provider/user data remain unchanged.

Evidence: core catalog/completeness tests 34/34; combined dashboard
generation, upload, progress, approval, transform, caption-evidence and
Patreon tests 107/107; core/dashboard typechecks pass; core/dashboard lint
exits 0 with four pre-existing `any` warnings; dashboard production build
exits 0 with explicit non-secret `API_ORIGIN`; `verify.sh` prints
`verify: ok`; source commit
`c56243fff44d87349ebbe5d3b5ba64586cb3e794` is pushed and read back from
`origin/codex/telegram-webhook-hardening`. Browser/native, deployed Patreon
OAuth/webhook/sync, R2, migration/RLS and production acceptance remain open.
No live action occurred.

### M839 — F-89 model overview route-shell localization

The model overview route now resolves the persisted interface locale through
the shared server-locale helper. Profile, network, activity, workspace-tool,
error, action and role-boundary copy is catalog-backed across all six launch
locales. Raw network error text is no longer rendered, and the created-at
field uses shared UTC formatting. Existing role-scoped navigation and data
semantics are unchanged.

Evidence: core locale/settings tests 40/40; model overview dashboard tests
14/14 including persisted Spanish route-shell behavior; core build,
typecheck and lint pass; dashboard typecheck passes; dashboard lint exits 0
with four pre-existing `any` warnings; `verify.sh` prints `verify: ok`;
source commit `c6b5996a295a307c553657aa8f9c819b669a4454` is pushed and read
back from `origin/codex/telegram-webhook-hardening`. Browser/native,
deployed runtime, provider, migration/RLS and production acceptance remain
open. No live action occurred.
