# Current architecture reconciliation

Date: 2026-09-20  
Repository: `dominator509/axiom`  
Source checkpoint: `90a85530d2ab56e3c5811e162a80ae31783c1e3f`

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
| Variants and A/B (F-13/F-15/F-16) | Model-scoped lifecycle, assignments, exposure/outcome capture, attribution and winner/reward source paths exist. M578 wires server-verified existing-bundle guidance provenance through candidate creation, review-bundle revalidation, authenticated guidance-source listing and candidate/performance safe projections, with dashboard selection and truthful unavailable states. M900 adds an authenticated model/experiment-scoped guidance-attribution route and mounted dashboard surface, using only stored guidance receipts and assignment outcomes; metric averages are weighted by actual sample counts. M793 localizes the model-scoped cascades route loaded/error shell, and M797 localizes the variant-experiments route loaded/error shell without changing scheduling or experiment mechanics. | Statistical/runtime/browser acceptance, deployed worker/provider acceptance, and any additional guidance fields not present in a verified source receipt remain open. |
| Team and shifts (F-24/F-25/F-26) | RBAC, shift lifecycle, handoff/post-note routes and dashboard controls exist. The dual-actor Chatter source slice adds human/LLM shift records, active-shift/agent-permission checks, durable roleplay handoffs, bounded memory and revisioned `soul.md` persona storage/API/UI. Team history now has bounded keyset pagination with dashboard older-history controls; Chatter roleplay uses its authorized personal shift roster rather than the administrative team endpoint. M667 adds a shared Grok roleplayer runtime and private assigned-LLM inbox drafting that reuses the pending-reply review flow, persists persona/memory provenance, and requires explicit human approval before send. M789 localizes the owner-gated workspace-members route shell, M795 localizes the model-scoped team/shifts route loaded/error shell, M841 localizes owner-visible model assignment controls and UTC assignment times, and M842 localizes post-note controls and UTC note times through the shared six-locale catalog while preserving the existing role boundary and team mechanics. | Authenticated multi-user browser/RLS acceptance, Grok roleplay and draft provider receipts, live migration/runtime acceptance and operator acceptance remain open. |
| Playbook (F-54/F-55/F-56/F-57) | Revisioned guideline storage/editor, calendar checks, generation/caption enrichment and read-only analytics context exist in source. Analytics renders saved platform guidance as advisory context without changing metric calculations or scheduling. | Browser acceptance, stale-editor/history acceptance, deployed migration acceptance, and any future consumer path not covered by the current source audit. |
| Scraper and research (F-17/F-18) | Authenticated bounded scrape runs, worker dispatch, model egress binding and partial-result/error handling exist. M577 aligns the durable `scrape_run` state, worker persistence and authenticated projection so mixed results remain `partial` end to end. M644 localizes the mounted result/refresh/history UI across all six launch locales with locale-aware counts and UTC timestamps while preserving authored/provider data and mutation semantics. M787 localizes the authenticated scraper route title and load-failure shell through the same catalog. | Deployed sidecar/provider isolation, benchmark history exposure, migration application, browser/mobile and result-quality acceptance. |
| Viral loop (F-79–F-86) | Metric/evidence filtering, publication-bound recipe evidence (hook, scheduled/actual time, bounded shoot controls, media format, ToS verdict and asset/hash-bound Rust vision descriptors), labels, recipes, embeddings/retrieval, parts of reward/digest logic, and a typed Relay-card lifecycle distinguishing durable `stored` evidence from external-dispatch states exist. M931 adds a model-scoped `viral.insight` job, localized analytics enqueue control, and model-owned Relay-card history that remains visible when no content bundle is present. Its card renderer is evidence-only and reads published provider snapshots with bounded group evidence. | Revenue/conversion attribution, all contextual arms, cross-model opt-in behavior, scheduled insight/Relay delivery, migration application and runtime acceptance. M931 does not claim provider publication or conversion outcomes. |
| Connectors and OAuth (F-03/F-31/F-58–F-67) | Static connector contracts and capability declarations exist for supported paths. M791 localizes the authenticated Grok connection/storage route shell while preserving role-scoped account and private-storage controls. M843 localizes the mounted social-disconnect confirmation and provider-revocation outcome states across all six launch locales without changing revocation-before-local-removal or idempotency semantics. | Live OAuth, refresh/revoke/disconnect, account onboarding, provider upload/publish/metrics receipts and browser acceptance. Snapchat remains capability-honest manual-assist where its API does not support organic posting. |
| Patreon creator/community integration (F-91) | **Wired/partial:** the pure v2 community connector is now wired through authored migration 0055, tenant/model-scoped campaign/member/post/sync/webhook tables with RLS, model-egress OAuth/PKCE and encrypted account persistence, bounded cursor sync, durable replay guards, signed webhook ingress, a model dashboard, and a native mobile community surface with assigned-model scoping, redacted status/read views and operator-only sync controls. | Deployed migration/RLS/runtime acceptance, real provider OAuth/webhook/sync receipts, browser/mobile acceptance and operational reconciliation remain open. No publish/DM/payout/member-mutation/unsupported-analytics claim. |
| Link-in-bio (F-48–F-53) | The Native provider is the current production-enabled default. | Fanlynks, Linktree and Beacons are optional planned adapters and must remain hidden/rejected until their full lifecycle exists; a database row is not evidence of a connection. |
| Localization and language switching (F-89) | **Source-wired/partial:** the shared six-locale catalog, BCP-47 normalization, precedence resolution, persisted user/org preference API, portfolio home shell, model overview profile/network/activity/tool route shell, dashboard provider/navigation/settings wiring, authenticated shell workspace/role/pending/footer/system-health copy, login hero/form labels/errors/session advice, assigned shifts, incidents/crash triage/recovery and localized publishing-safety controls with locale-aware UTC dates, team-shift controls, TeamOperationsManager labels/errors/roles/notes, the model-scoped team/shifts route shell, the model-scoped variant-experiments route shell, digest page/scheduling/recovery controls, Relay history/delivery surfaces, Calendar month/week navigation, drag/date controls, schedule form, status labels and advisory time windows, media approval child controls for generation retry, prompt suggestions and clip/resize/transcode operations, the generation form, upload workflow and live generation-progress states, model overview actions, authenticated inbox attachment details/preview controls, owner-visible model assignments, post-note controls, social-disconnect confirmation/outcome states, consent-vault controls, and the mounted Link-in-bio, generation access, earnings/inbox loading, and model workspace header surfaces now consume the same catalog (M944). F-90 campaign referral-link/copy labels also use the six launch catalogs (M952). CalendarBoard now formats scheduled UTC times with the selected locale instead of slicing ISO strings (M904). Attachment prices use the selected locale and purchase times use the selected locale with explicit UTC. Locale-aware UTC timestamps, accessible `lang` metadata, and mounted mobile selector, LoginScreen, DashboardScreen, RelayScreen and PatreonScreen labels/statuses/date/count formatting remain wired. UI language remains separate from authored content language. | Complete catalog adoption across remaining dashboard/email/operator surfaces, browser/native mobile acceptance, locale-aware formatting audit for every date/number/currency surface, and deployed migration/RLS/runtime evidence remain open. |
| FanThynks platform affiliate program (F-90) | **Wired/partial:** native platform-level affiliate schema and authored migration 0054, owner-gated API routes, disclosure-gated partner/campaign controls, a rate-limited public referral redirect that records anonymous clicks, an authenticated idempotent identity-stitch claim from the login handoff, conversion reconciliation that requires the matching prior stitch plus active program/partner/disclosure checks, attribution/conversion/commission/hold state, audit/idempotency, partner-owned export/revoke semantics and non-transfer payout CSV generation exist; the owner dashboard now renders each campaign's public referral path and copies an origin-qualified share URL with six-locale labels (M952); no third-party affiliate stack was imported. | Migration application, native license/security/legal review, browser acceptance, billing/reconciliation integration, payout-provider/operator acceptance and deployed export/deletion evidence remain open. Tenant-owned affiliate builders and creator resale controls are out of scope. |
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

## M931 — model-scoped viral insight Relay cards

Source checkpoint: `90a85530d2ab56e3c5811e162a80ae31783c1e3f`.

This milestone is source-wired and pushed on the coordination branch. It adds:

- `packages/db/src/schema/relay_card.ts` model ownership and migration `0061`;
- the typed `viral.insight` worker job, published-provider-snapshot filtering,
  bounded evidence configuration and model-scoped deduplication;
- the authenticated model route and idempotent analytics enqueue control;
- model-owned Relay-card history even when a card has no content bundle;
- localized analytics generation states across the existing six-locale catalog;
- evidence-only viral insight card rendering with no conversion, causality or
  recommendation claim; and
- focused DB, core, worker, API and dashboard tests plus affected typecheck and
  lint gates.

Hermes' F85 lane has a valid progress checkpoint but no source delivery,
manifest or tested artifact. No Hermes worktree or artifact was integrated into
this milestone. The local source above is therefore authoritative for M931;
the F85 lane remains unintegrated until a fresh, strict delivery is produced.

Still open for this feature: applying the migration, deployed worker/runtime
acceptance, automatic scheduling, revenue/conversion attribution, full
contextual-arm coverage, cross-model opt-in semantics and any provider-facing
delivery. None is promoted by the source tests alone.

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

### M840 — F-89 inbox attachment localization

Authenticated inbox attachment details and image/video/audio preview controls now
consume typed catalog keys across all six launch locales. Loading, access/error,
unavailable, variant-selection, retry and preview-alt copy are localized; listed
prices and paid amounts use the selected locale, and valid purchase timestamps use
the selected locale with an explicit UTC zone. Authored/provider values, purchase
and read semantics, attachment limits and authenticated media proxy paths remain
unchanged. The model overview route's strict tuple typing was also corrected so
the production build accepts the role-filtered tool-link list.

Evidence: focused dashboard InboxAttachments suite 9/9, new mounted locale tests
2/2, core locale suite 57/57, serialized full matrix 24/24 package tasks, and
dashboard production build compilation/lint/type/page generation/trace passed;
`scripts/verify.sh` prints `verify: ok`. Source commit
`b2fe80bce8d291024e01e38a229372c2b8fd81f0` is pushed and read back from
`origin/codex/telegram-webhook-hardening`. Browser/native, provider, deployed
migration/RLS/runtime and production acceptance remain open. No live action
occurred.

### M841 — F-89 model-assignment localization

The owner-visible `ModelAssignments` control now consumes typed catalog keys across
all six launch locales. Assignment loading, empty state, assignment/removal
controls, confirmation, rejection, retry and success/unconfirmed states are
localized; assignment timestamps use the selected locale with an explicit UTC
zone. Member email/role values remain authored account data, and the existing
idempotency, exact receipt validation, owner-only boundary and workspace-role
semantics are unchanged.

Evidence: focused ModelAssignments behavior/locale tests 4/4, full dashboard
matrix 137 files and 858 tests passed, core locale tests 57/57, core/dashboard
typechecks passed, core/dashboard lint exited 0 with four pre-existing `any`
warnings, dashboard production build compilation/lint/type/page generation/trace
passed, and `scripts/verify.sh` prints `verify: ok`. Source commit
`90c597a2a663830dd25615aa34c08f8cafcc60f6` is pushed and read back from
`origin/codex/telegram-webhook-hardening`. PostTeamNotes and
DisconnectSocialAccountButton remain audited but open for a separate finite
slice; browser/native, provider, deployed migration/RLS/runtime and production
acceptance remain open. No live action occurred.

### M845 - F-89 Fanvue analytics-card localization

The mounted `FanvueAnalyticsCard` on the model Fans route now consumes a
feature-owned catalog covering all six launch locales. Loading, sync, queued,
failure, empty and summary labels are localized; subscriber, unread-message,
contact and top-spender counts use the selected locale, and lifetime-value
currency uses the selected locale with USD. Provider/account identifiers and
API, mutation, retry and error semantics remain unchanged. The feature catalog
is merged by `LocaleProvider`, so the base catalog contract remains intact.

Evidence: feature catalog completeness 1/1; mounted Spanish analytics-card
behavior 1/1; full dashboard matrix 141 files and 862 tests passed; core build,
dashboard typecheck, dashboard lint (0 errors, four pre-existing `any`
warnings), dashboard production build and `scripts/verify.sh` (`verify: ok`)
passed. Source commit
`2e75113883d579296ba745861953a4b9624127e2` is pushed and read back from
`origin/codex/telegram-webhook-hardening`. This closes only the M845 source/UI
slice; remaining dashboard/email/operator localization, other date/number/
currency surfaces, browser/native, provider, deployed migration/RLS/runtime,
observability, CI governance and production acceptance remain open. No live
action occurred.

### M851 - F-89 network child controls localization

The mounted network child controls now consume a dedicated six-locale catalog
for encrypted egress credential entry/import/save, live connection health, and
saved-connection activation. `EgressCredentials` keeps the existing WireGuard
parser, opaque secret handling, HTTPS warning, complete-replacement contract,
idempotency and role boundary; `NetworkHealth` keeps model-identity validation,
direct/unhealthy/missing-IP distinctions and the no-new-leak-test boundary; and
`ActivateNetwork` keeps the model-scoped sync payload, idempotency key, response
validation and explicit safety-switch boundary. The catalog is mounted through
`LocaleProvider` in all six launch locales, including the visible labels,
acknowledgement, retry, error and completion states.

Evidence: core 17 files/101 tests passed; dashboard 143 files/872 tests passed;
focused network-child tests 32/32 passed; core and dashboard typechecks passed;
core lint passed; dashboard lint passed with zero errors and four pre-existing
test `any` warnings; touched-file Prettier check passed; dashboard production
build passed with the required Windows symlink capability; and
`scripts/verify.sh` printed `verify: ok`. Source commit
`22d97aff50dc5169d3a00783bf866a8aeee68b3b` is pushed and read back from
`origin/codex/telegram-webhook-hardening`. This closes only the M851 source/UI
localization slice; browser/native interaction, customer-provider execution,
deployed migration/RLS/runtime and production acceptance remain open. No live,
database, migration, provider, credential, permission, network or deployment
action occurred.

### M850 - F-89 profile/network/lifecycle localization

The mounted profile editor, model lifecycle controls, and egress network form
now consume a feature-owned six-locale catalog for English, Spanish, Japanese,
Italian, Brazilian Portuguese, and German. Profile validation, lifecycle
confirmation/status copy, network-mode labels, direct-mode safety warning,
field labels, and retry/save states are localized without changing API
payloads, idempotency keys, role checks, refresh behavior, or the explicit
direct-mode unprotected-network semantics.

Evidence: feature catalog completeness 2/2; core package 16 files and 95 tests
passed; dashboard package 142 files and 866 tests passed, including mounted
Spanish/German profile/lifecycle/network rendering; full typecheck, production
build, and `scripts/verify.sh` (`verify: ok`) passed. The eslint phase reports
zero errors; the repository-wide Prettier check remains baseline-red across
586 existing files, and the root test matrix retains four unrelated Windows
subscription process-tree failures in `@axiom/llm-gateway`. Source commit
`f5735f70e404573c906bbf3cd24f97f5096b5897` is pushed and read back from
`origin/codex/telegram-webhook-hardening`. This closes only the M850 source/UI
slice; remaining catalog adoption, locale date/number/currency surfaces,
browser/native, provider, deployed migration/RLS/runtime, observability, CI
governance, and production acceptance remain open. No live action occurred.

### M849 - F-89 portfolio-error localization

The portfolio home page now retains localized workspace-unreachable and
profile-request-failed states without rendering raw backend exception text.
Model listing/count requests, pagination semantics and profile actions remain
unchanged.

Evidence: focused home-page tests 7/7; full dashboard matrix 141 files and 864
tests passed; dashboard typecheck passed; dashboard lint exited 0 with four
pre-existing `any` warnings; dashboard production build and
`scripts/verify.sh` (`verify: ok`) passed. Source commit
`ad021d17a821b4dcfe9b01430392ee0f92ef8f00` is pushed and read back from
`origin/codex/telegram-webhook-hardening`. This closes only the M849 source/UI
slice; remaining catalog adoption, browser/native, provider, deployed
migration/RLS/runtime, observability, CI governance and production acceptance
remain open. No live action occurred.

### M848 - F-89 approval-queue localization

The server-rendered approval queue now hides raw backend exceptions behind
localized recovery copy and maps persisted ToS verdict codes through a
feature-owned six-locale catalog, with an unknown-value fallback. This removes
provider/backend wording and storage codes from the owner-facing review queue
without changing approval, ToS, mutation, publication or provider semantics.

Evidence: review catalog completeness 1/1; approval-page focused tests 36/36;
full dashboard matrix 141 files and 864 tests passed; dashboard typecheck
passed; dashboard lint exited 0 with four pre-existing `any` warnings; dashboard
production build and `scripts/verify.sh` (`verify: ok`) passed. Source commit
`022e1ed39b331a98c10d92143de14b4bf4c15deb` is pushed and read back from
`origin/codex/telegram-webhook-hardening`. This closes only the M848 source/UI
slice; remaining catalog adoption, browser/native, provider, deployed
migration/RLS/runtime, observability, CI governance and production acceptance
remain open. No live action occurred.

### M847 - F-89 affiliate hold-reason localization

The mounted platform affiliate manager now renders known persisted hold reason
codes through a feature-owned six-locale catalog, with a safe fallback for an
unknown future code. This removes raw storage identifiers from the owner-facing
risk-review table without translating partner identifiers, provider/account
data, or user-authored values. Affiliate API calls, mutation idempotency, payout
export, and hold-resolution semantics remain unchanged.

Evidence: affiliate catalog completeness 1/1; focused `PlatformAffiliateManager`
tests 4/4, including UTC and hold-reason regressions; full dashboard matrix 141
files and 864 tests passed; dashboard typecheck passed; dashboard lint exited 0
with four pre-existing `any` warnings; dashboard production build and
`scripts/verify.sh` (`verify: ok`) passed. Source commit
`95e2eb3fdd553f896e7006bb990303813bc54772` is pushed and read back from
`origin/codex/telegram-webhook-hardening`. This closes only the M847 source/UI
slice; remaining dashboard/email/operator localization, other date/number/
currency surfaces, browser/native, provider, deployed migration/RLS/runtime,
observability, CI governance and production acceptance remain open. No live
action occurred.

### M846 - F-89 affiliate hold-date localization

The mounted platform affiliate manager now formats open-hold dates with the
selected locale and an explicit UTC time zone. This removes host-timezone drift
from the owner-facing affiliate risk-review table without translating partner
identifiers, hold reasons, or provider/account data. Affiliate API calls,
mutation idempotency, payout export, and hold-resolution semantics remain
unchanged.

Evidence: focused `PlatformAffiliateManager` tests 3/3, including a
host-timezone regression; full dashboard matrix 141 files and 863 tests
passed; dashboard typecheck passed; dashboard lint exited 0 with four
pre-existing `any` warnings; dashboard production build and
`scripts/verify.sh` (`verify: ok`) passed. Source commit
`05b6fc5c03ea304998a47080da1778eb9bcb4a84` is pushed and read back from
`origin/codex/telegram-webhook-hardening`. This closes only the M846 source/UI
slice; remaining dashboard/email/operator localization, other date/number/
currency surfaces, browser/native, provider, deployed migration/RLS/runtime,
observability, CI governance and production acceptance remain open. No live
action occurred.

### M842 — F-89 post-note localization

The mounted post-specific internal-note workflow now consumes typed catalog keys
across all six launch locales. Summary/never-published guidance, load/empty/older
controls, editor labels, save/retry feedback and load/save failures are localized;
note timestamps use the selected locale with an explicit UTC zone. Note body,
author identifier, post scope, idempotency intent and the existing boundary that
nothing is sent to a social platform remain unchanged.

Evidence: focused PostTeamNotes behavior/locale tests 3/3, full dashboard matrix
138 files and 859 tests passed, core locale tests 57/57, core/dashboard
typechecks passed, core/dashboard lint exited 0 with four pre-existing `any`
warnings, dashboard production build compilation/lint/type/page generation/trace
passed, and `scripts/verify.sh` prints `verify: ok`. Source commit
`02c60235dd7faaf6b1977eb6615373c42712e1a5` is pushed and read back from
`origin/codex/telegram-webhook-hardening`. DisconnectSocialAccountButton remains
audited but open for a separate finite slice; browser/native, provider, deployed
migration/RLS/runtime and production acceptance remain open. No live action
occurred.

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

### M843 — F-89 social disconnect localization

The mounted `DisconnectSocialAccountButton` now consumes typed catalog keys
across all six launch locales. Connection-specific confirmation, rejected
provider-revocation recovery, successful revocation/local-removal confirmation
and unconfirmed/unexpected retry states are localized. Provider revocation
still precedes local removal; existing idempotency behavior, provider/account
identifiers and mutation semantics remain unchanged.

Evidence: focused DisconnectSocialAccountButton behavior/locale tests 2/2, full
dashboard matrix 139 files and 860 tests passed, core locale tests 57/57,
core/dashboard typechecks passed, core/dashboard lint exited 0 with four
pre-existing `any` warnings, dashboard production build
compilation/lint/type/page generation/trace passed, and `scripts/verify.sh`
prints `verify: ok`. Source commit
`18e09a97e5e8252d35c69206657e47f6ce0efe3a` is pushed and read back from
`origin/codex/telegram-webhook-hardening`. This closes only the M843 source/UI
slice; browser/native, provider, deployed migration/RLS/runtime, observability,
CI governance and production acceptance remain open. No live action occurred.

### M844 — F-89 Chatter InboxReplies localization

The mounted Chatter `InboxReplies` workflow now consumes typed catalog keys across
all six launch locales for history loading, assigned-LLM private drafting,
human-approval prompts, send/cancel actions, status/outcome and retry states,
character counts, and prepared timestamps with explicit UTC formatting. The
existing boundary remains unchanged: assigned-LLM drafts are private review
artifacts and human approval is required before a send; saving or drafting never
sends automatically.

Evidence: `InboxReplies` behavior/locale tests 13/13, full dashboard matrix 140
files and 861 tests passed, core locale tests 57/57, core/dashboard typechecks
passed, core/dashboard lint exited 0 with four pre-existing `any` warnings,
dashboard production build compilation/lint/type/page generation/trace passed,
and `scripts/verify.sh` prints `verify: ok`. Source commit
`78809a3ca102b218dfe616e36372896de9ef08bc` is pushed and read back from
`origin/codex/telegram-webhook-hardening`. This is source/UI evidence only;
remaining dashboard/email/operator localization, browser/native, provider,
deployed migration/RLS/runtime, observability, CI governance and production
acceptance remain open. No live action occurred.

### M852 — F-89 consent-vault localization

The mounted metadata-only consent vault now consumes a feature-owned six-locale
catalog for the route shell, record status, validity labels, add/revoke controls,
validation feedback, save/retry states and revocation confirmation. The server
route resolves the persisted interface locale and formats validity dates with an
explicit UTC date-only formatter. The form and revoke control never render raw
backend error text; they expose bounded HTTP/status copy and preserve the
existing model scope, role gate, idempotency behavior, metadata-only payload,
document-reference non-readback and explicit confirmation before revocation.

Evidence: core build and full tests 18 files/103 tests passed; focused consent
dashboard tests 4 files/16 tests passed; full dashboard matrix 145 files/886
tests passed; dashboard typecheck passed; dashboard lint exited 0 with four
pre-existing `any` warnings; touched-file Prettier check passed; dashboard
production build passed with non-secret `API_ORIGIN` and Windows symlink
capability; and `scripts/verify.sh` printed `verify: ok`. Source commit
`5dd265a6a9f1fc302d9b6aa142bd3d41cb64a0a3` is the reviewed product source
commit. This closes only the M852 consent-vault localization source/UI slice;
browser/native, provider, deployed migration/RLS/runtime and production
acceptance remain open. No live, database, migration, provider, credential,
permission, network or deployment action occurred.

### M853 — F-05/F-08 Fan CRM workflow localization

The mounted Fan CRM route now consumes a feature-owned six-locale catalog for
access boundaries, contact and interaction controls, custom-request controls,
enum labels, empty states, retry states and safe HTTP/status errors. The route
uses the persisted server UI locale, formats timeline timestamps in UTC and
formats recorded USD values with the selected locale. Provider identifiers,
fan display names, authored request titles/descriptions and interaction content
remain data; the workflow still records existing activity and never sends a
message or charges a fan.

Evidence: core build and full tests 19 files/105 tests passed; focused Fan CRM
dashboard tests 4 files/30 tests passed; full dashboard matrix 145 files/886
tests passed; dashboard typecheck passed; dashboard lint exited 0 with four
pre-existing any warnings; touched-file Prettier and diff-check passed;
dashboard production build passed with non-secret API_ORIGIN and Windows
symlink capability. Source commit
4a22f17f683930c8c8338d6a3a6be46b698e923f is the reviewed product source
commit. This closes only the M853 Fan CRM source/UI slice; browser/mobile,
provider, deployed migration/RLS/runtime, observability, CI governance and
production acceptance remain open. No live action occurred.

### M854 — F-89 Chatter/roleplay localization and bounded error presentation

The architecture-backed Chatter/roleplay surface was audited before editing.
The existing implementation already provides the requested human-versus-
assigned-LLM actor choice, bounded handoff/memory, suggested-personality and
manual-persona modes, local `.md`/`.txt` persona loading with a size cap, and
the assigned Grok roleplay-turn path. M854 does not claim those mechanics as
new; it closes the remaining mounted-surface gap around localization and safe
error presentation.

`RoleplayManager` now uses feature-owned catalog keys for context, mutation,
memory and Grok-turn failures and never renders raw backend exception text.
The roleplay page resolves the persisted server locale, localizes access and
load failures, and distinguishes the human-chatter and assigned-LLM actor
labels without translating user/provider identifiers. Existing approval,
memory-boundary, model-scope and provider-call semantics remain unchanged.

Evidence: focused roleplay page/manager tests 3 files/6 tests passed; full
dashboard matrix 145 files/886 tests passed; dashboard typecheck passed; lint
exited 0 with four pre-existing `any` warnings; diff check passed; elevated
dashboard production build passed with explicit non-secret `API_ORIGIN`; and
`scripts/verify.sh` printed `verify: ok`. Product source commit
`5c0163fbfe7d7e26eacdb404a3f512943930707b` is the reviewed M854 commit.
Browser/mobile, provider/OAuth/Patreon receipts, deployed migration/RLS/runtime,
observability, CI governance, WireGuard/customer-egress rehearsal and
production acceptance remain open. No live action occurred.

### M855 — F-89 analytics trend-date formatting

The analytics route already had catalog-backed labels, locale-aware counts,
percentages and currency. The remaining date-formatting defect was concrete:
daily trend rows rendered the API's raw ISO `YYYY-MM-DD` value, bypassing the
selected UI locale. M855 formats each trend day with `Intl.DateTimeFormat` and
an explicit UTC zone, preserving the API payload, model access boundary,
analytics calculations and provider-free report behavior.

Evidence: focused analytics page tests 6/6 passed, including a Spanish locale
assertion that the rendered date is localized and the raw ISO string is absent;
full dashboard matrix 145 files/886 tests passed; dashboard typecheck passed;
lint exited 0 with four pre-existing `any` warnings; diff check passed;
elevated dashboard production build passed; and `scripts/verify.sh` printed
`verify: ok`. Product source commit
`fc3dd5d099bc61f746953a6addbbb87765227302` is the reviewed M855 commit.
Remaining localization work is other dashboard/email/operator adoption and a
complete formatting audit; browser/mobile, provider/OAuth/Patreon receipts,
deployed migration/RLS/runtime, observability, CI governance,
WireGuard/customer-egress rehearsal and production acceptance remain open. No
live action occurred.

### M856 — F-89 model Network route localization (local fallback)

The model Network route now resolves the persisted UI locale through the shared
server catalog for its owner-only network status, egress mode, health and
latency labels, social-account controls, OAuth notices, role guidance, table
headings and bounded failure states. Raw `lastError` text is no longer rendered
to the browser. The existing role checks, model scope, OAuth links, child
controls and API payloads are unchanged. All six launch catalogs cover the new
typed keys.

Hermes's F89 copy was not accepted: repeated authoritative reads found the
declared COPY_ROOT byte-identical to its baseline and the DELIVERY_ROOT empty.
Codex therefore closed that lane as a local fallback and published source
commit `4884a0c2553729b5adef99abee5a72f1f9912e38`. Focused network tests passed
16/16, core tests 105/105, the full dashboard matrix passed 145 files/893
tests, dashboard/core typechecks and linters passed, and `scripts/verify.sh`
printed `verify: ok`. The dashboard build compiled and completed page generation
but Windows standalone tracing failed to create pnpm symlinks with `EPERM`.
This is source/automated evidence only; browser/native, provider, migration/RLS,
runtime, deployment and production acceptance remain open. No live action
occurred.

### M857 — F-89 relay binding operator-surface localization (Codex local fallback)

`RelayBindingManager` now receives the parent route's selected-locale translator
and uses typed catalog keys for fixed guidance, empty/error/status/action copy,
confirmation text, form labels, accessible labels, validation, success,
unconfirmed and retry states. All six supported catalogs (en, es, ja, it,
pt-BR and de) contain the new relay-binding keys. Channel identifiers, chat
references and provider data remain untranslated data.

The existing POST/PATCH paths, idempotency keys, response confirmation,
retry-same-intent behavior, role gate, model scope, confirmation semantics and
channel values are unchanged. Focused behavior coverage is 10/10: server-
generated IDs, six-locale output, owner/editor and read-only rendering,
populated enabled/disabled rows, localized confirmation, validation,
rejection, success and retry-same-intent states. Core passed 19 files/105
tests; dashboard passed 145 files/902 tests; core/dashboard typechecks passed;
lint exited with no errors and retains four pre-existing dashboard `any`
warnings; `scripts/verify.sh` returned `verify: ok`; `git diff --check`
passed. Source commit `7536083ba115ae8849c450c9dee677f10e8e14d7` was pushed and
read back from the branch. No live action occurred.

The Hermes F71 transport lane is closed by local fallback. Its ACK/READ receipt
was transport evidence only, and authoritative reads found no COPY_ROOT or
DELIVERY_ROOT to audit; no Hermes artifact was accepted or integrated. A fresh
Hermes lane must bind to the next source audit and may not resume F71.

### M858 — F-89 workspace-member operator controls localization (Codex local)

The owner-only `WorkspaceMembers` control now consumes typed catalog keys across
en, es, ja, it, pt-BR and de for role labels/descriptions, audit guidance,
load/pagination/empty states, confirmation, retry/cancel, rejection and saved
access notices. Member emails, backend role identifiers and server-provided
details remain data. Existing role assignment, owner boundary, idempotency,
exact receipt validation and session-revocation behavior are preserved.

Evidence: focused WorkspaceMembers behavior tests 10/10; core 19 files/106
tests including explicit six-locale member-key translation coverage; full
dashboard matrix 145 files/902 tests; core/dashboard typechecks pass;
core/dashboard lint has no errors and retains four pre-existing dashboard
`any` warnings; `scripts/verify.sh` prints `verify: ok`; and `git diff --check`
passes. Product commit
`224458139080fe674453e2a8116e42ca26b8c3f4` was pushed to
`origin/codex/telegram-webhook-hardening` and remote readback matches exactly.
This closes only the workspace-member source/UI localization criterion;
browser, deployed runtime, RLS, provider, observability, CI governance and
production acceptance remain open. No live action occurred.

### M859 — F-89 PlaybookCadence calendar guidance localization (Codex local)

The model calendar's weekly playbook-cadence advisory now consumes typed
catalog keys across en, es, ja, it, pt-BR and de. The section label, UTC week
range, advisory boundary, unavailable/empty states, revision/count summaries,
deficit/covered states, saved posting-time guidance and review link are all
localized; UTC week dates use the selected locale's medium date format. The
server calendar passes its resolved locale and translator into the component,
while cadence counting, API data, publication disclaimers and navigation remain
unchanged.

Evidence: focused PlaybookCadence tests 6/6; calendar page tests 12/12; core
19 files/107 tests; full dashboard 145 files/903 tests; core build,
core/dashboard typechecks and lint pass (four existing dashboard `any`
warnings remain); `git diff --check` passes; `scripts/verify.sh` prints
`verify: ok`. Product commit
`462cdaf31ee06e7263057df4489d7fbd14b4cd35` was pushed to
`origin/codex/telegram-webhook-hardening` and remote readback matches exactly.
This closes only the PlaybookCadence source/UI localization criterion;
browser, deployed runtime, provider, observability, CI governance, WireGuard
and production acceptance remain open. No live action occurred.

### M918 — F-89 variant workflow localization

The model-scoped variant workflow now consumes the shared six-locale catalog
for candidate creation, experiment lifecycle and winner controls, assignment
and observed-outcome tracking, guidance attribution, published-performance
summaries, review creation and safe retry/error states. Variant UI strings are
kept in a dedicated catalog extension and composed by the dashboard provider;
the base `LocaleCatalog` remains strict for the core catalog and continues to
report missing base translations instead of masking them with an extension.
Platform identifiers, opaque IDs, authored copy and provider evidence remain
data. Assignment, evaluation, attribution, approval, publication and role
semantics are unchanged.

Evidence: core 21 files/126 tests, dashboard 146 files/904 tests, core build,
dashboard typecheck, full dashboard test suite, `git diff --check`, and an
elevated dashboard production build with explicit loopback `API_ORIGIN` all
passed. The first build attempt failed closed because `API_ORIGIN` was absent;
the elevated retry completed standalone tracing. Product commit
`6844f8ef6e266660f5d6a71d9c9acdecdc29a59b` was pushed and read back from
`origin/codex/telegram-webhook-hardening`. This is source/UI evidence only;
browser/mobile, provider, migration/RLS, runtime, observability, WireGuard and
production acceptance remain open. No live action occurred.

### M920 — F-89 character, cascade and native link-in-bio localization

CharacterLockEditor, CascadeTemplateManager and the native LinkbioPanel now
consume the shared typed locale catalog instead of embedding user-facing
English copy. The slice adds 67 typed keys across en, es, ja, it, pt-BR and de,
including validation, confirmation, retry, role-gate, conflict and
unconfirmed-response states. Authored names, platform identifiers, URLs,
provider data and backend error details remain data; the existing mutation,
idempotency, authorization, confirmation and retry behavior is unchanged.

Evidence: Hermes manifest bytes and all nine delivered-file hashes matched;
focused core locale completeness tests passed 8/8, focused dashboard behavior
tests passed 24/24, core and dashboard typechecks passed, core and dashboard
lint passed with four pre-existing dashboard `any` warnings, and
`git diff --check` passed. The source milestone is commit
`cd155c5ef00d542b22fc312c4ab6787abd7adaa7`, pushed and read back from
`origin/codex/telegram-webhook-hardening`. The strict Hermes DELIVERY reply
and terminal Codex receipt are still open; no live action occurred.

### M944 — F-89 mounted model workspace localization

The remaining mounted model workspace copy is now feature-owned and typed across
the six launch locales. Link-in-bio provider, native-page, analytics and
Fanvue-attribution labels use the persisted server locale; currency and
conversion-rate values use locale-aware `Intl` formatting with a bounded
currency fallback. Generation access-denied copy, earnings/inbox loading
states, and the model workspace header/status labels now use the same catalog.
Provider identifiers, URLs, model data, API payloads, role checks and existing
LinkbioPanel behavior remain data or existing contracts.

Evidence: model-surface catalog completeness 1/1; core full suite 24 files /
138 tests; dashboard full suite 154 files / 967 tests; core/dashboard
typechecks and lint pass; `git diff --check` and `scripts/verify.sh` pass with
`verify: ok`; dashboard production compilation, type validation, lint, page
generation and trace collection pass with a non-secret loopback `API_ORIGIN`.
Windows standalone output then fails only while creating pnpm symlinks with
`EPERM`, an environment packaging limitation. Product commit
`daa230ff4a8b4f993e4ea3f819bb5ec2d39460fa` and handoff commit
`1f942538e5a4335497d7634171cfe3a6f673c5bc` are pushed and read back. No live
action occurred.

### M950 — F-90 public referral entry point

The platform affiliate source now has a real anonymous referral entry point at
`GET /affiliate/r/{referralToken}`. The route is rate-limited, accepts no
destination URL, verifies the campaign, program and partner are all active and
that partner disclosure is accepted, records one immutable `click` attribution
fact with no visitor credential or raw network identity, and redirects only to
the same-origin `/login?affiliate_ref=...` flow. Inactive or mismatched rows
fail closed without recording a click. Owner-only campaign, conversion, payout,
export and hold controls remain behind the existing platform boundary.

Evidence: affiliate route/domain tests 44/44; API typecheck passed; the owning
API suite passed 73 files with 1,136 tests passed and 50 skipped (five skipped
integration files); `git diff --check` passed. This is source/UI contract
evidence only. The signup handoff, billing conversion reconciliation, provider
payout, migration application, browser acceptance and operator/legal gates
remain open. Product commit `8396b9a0db75311194727862bc44ed91e72b91bf` is
pushed and read back from `origin/codex/telegram-webhook-hardening`. No live
action occurred.

### M952 — F-90 dashboard share-link surface

The owner dashboard now consumes the public referral contract instead of
showing only the opaque database token. Each campaign renders the encoded
`/affiliate/r/{referralToken}` path as a same-origin link and provides a
clipboard action that copies an origin-qualified URL. Clipboard failure is
reported through localized UI state rather than being treated as a successful
copy. The new link/copy/success/fallback messages are present in the `en`,
`es`, `ja`, `it`, `pt-BR` and `de` catalogs.

Evidence: `PlatformAffiliateManager.test.tsx` 5/5; dashboard full suite 154
files / 974 tests; core build/typecheck and dashboard typecheck passed;
`git diff --check` passed. This is source and component-test evidence only;
browser acceptance and deployed public-domain behavior remain open. No live
action occurred.

### M954 — F-90 authenticated referral identity stitch

The public referral flow now has a complete source-level identity handoff. The
rate-limited redirect validates the opaque token and sends the visitor to the
same-origin login page; the login page forwards only a constrained token after
the Better Auth response and session identity are both confirmed. The
authenticated `POST /api/affiliate/claim` route revalidates the active program,
campaign, partner and disclosure, attaches only the session user id as an
immutable `identity_stitch` event, and derives a deterministic unique event key
so retries return a duplicate receipt without creating another event. The
claim has no billing, payout or provider side effect.

Evidence: affiliate route/domain tests 10/10; login form tests 16/16; core
catalog tests 139/139; owning API suite 73 files / 1,138 passed / 50 skipped;
owning dashboard suite 154 files / 976 passed; core build and API/dashboard
typechecks passed; `git diff --check` passed. This is source and test evidence
only. Billing conversion reconciliation, migration/runtime, browser acceptance
and operator/legal gates remain open. No live action occurred.

### M955 — F-90 conversion attribution integrity

Conversion reconciliation now fails closed unless the platform program and
partner are active, partner disclosure is still accepted, and the supplied
creator identity has an earlier `identity_stitch` event for the same campaign.
The conversion route no longer accepts a creator id as an assertion without
provenance. Refunds additionally have to reference a started/renewed
conversion for the same campaign and creator, preventing cross-campaign or
refund-of-refund commission reversals. These checks remain inside the existing
transaction and billing idempotency boundary; they do not call a provider or
move money.

Evidence: affiliate route/domain tests 11/11; owning API suite 73 files / 1,139
passed / 50 skipped; API typecheck and `git diff --check` pass. This is source
and test evidence only. Billing provider
integration, migration/runtime, browser acceptance, payout/operator and legal
gates remain open. No live action occurred.

### M956 — F-90 refund-source binding

Refund reconciliation now fails closed when `subscription_refunded` omits its
`sourceBillingEventKey`. A refund must identify a prior started or renewed
conversion for the same campaign and referred creator before a reversal
commission can be recorded; the existing route also rejects cross-campaign,
cross-creator and refund-of-refund sources. This remains source-level
idempotency and provenance control; it does not call a billing provider or move
money.

Evidence: affiliate route/domain tests 12/12; owning API suite 73 files / 1,140
passed / 50 skipped; API typecheck and `git diff --check` pass. Source, test
and contract evidence only. Billing
provider, migration/runtime, browser, payout/operator and legal gates remain
open. No live action occurred.

### M957 — F-89 variant winner-control localization

The remaining hardcoded `Select as winner` action in the model-scoped variant
experiment manager now uses `variant.manager.selectWinner` from the shared
variant catalog. The label is explicitly present for English, Spanish,
Japanese, Italian, Brazilian Portuguese and German; platform names remain
provider/product data rather than translated prose.

Evidence: variant catalog tests 3/3, dashboard component test 5/5, core suite
25 files / 140 passed, dashboard suite 154 files / 976 passed, core/dashboard
typechecks, core build and `git diff --check` pass. Browser/native acceptance,
remaining catalog adoption, runtime/provider, migration and deployment gates
remain open. No live action occurred.

### M958 — F-89 remaining date and count formatting

The next independently reproduced localization gaps were concrete host-format
leaks in mounted dashboard surfaces. Digest creation timestamps now use the
selected locale with an explicit UTC zone; model calendar detail timestamps now
use the shared server-locale date/time formatter; and Patreon campaign/member/
post counts, sync feedback counts and saved-record sync timestamps now use the
selected locale with invalid-date and non-finite-value fallbacks. Provider,
platform, authored and identifier values remain data rather than translated
labels.

Evidence: focused dashboard tests 20/20, full dashboard suite 154 files / 977
passed, core typecheck/build, dashboard typecheck/lint, `git diff --check` and
`scripts/verify.sh` (`verify: ok`) pass. Product source commit
`b4c7c359599c42f0cce6501edfa9a6654da1f1cc` is pushed and read back from
`origin/codex/telegram-webhook-hardening`. This closes only the verified
digest/calendar/Patreon formatting source slice; complete catalog adoption,
browser/native acceptance, deployed migration/RLS/runtime, provider receipts,
observability, CI governance and production acceptance remain open. No live
action occurred.

### M959 — F-89 Relay and calendar formatting

The next independently reproduced formatting leaks were in mounted Relay and
calendar controls. Relay history now formats card timestamps with the selected
locale and explicit UTC instead of slicing ISO text. Calendar cells display
locale-aware labels, visible post counts use locale-aware number formatting,
and successful guarded moves use a locale-aware UTC date in the confirmation.
Machine-readable UTC keys and input values remain unchanged for routing and API
contracts; platform names and authored card content remain data.

Evidence: focused dashboard tests 9/9, full dashboard suite 154 files / 978
passed, dashboard typecheck/lint, `git diff --check` and `scripts/verify.sh`
(`verify: ok`) pass. Product source commit
`1f03c70fd452796d1a7cb87c56c0d9d52fb03dd6` is pushed and read back from
`origin/codex/telegram-webhook-hardening`. This closes only the verified Relay
history/calendar formatting source slice; complete catalog adoption,
browser/native acceptance, deployed migration/RLS/runtime, provider receipts,
observability, CI governance and production acceptance remain open. No live
action occurred.

### M960 — F-89 media numeric formatting

The mounted media page had one remaining concrete numeric-formatting leak:
dimensions, file sizes in KB and saved-result counts were rendered as raw
numbers. Those values now use the selected locale's shared number formatter;
asset identifiers, MIME/provider metadata and authored content remain data.
The existing locale-aware created timestamp and lifecycle/role boundaries are
unchanged.

Evidence: the complete media page suite passed 40/40, the full dashboard suite
passed 154 files / 978 tests, dashboard typecheck/lint, `git diff --check` and
`scripts/verify.sh` (`verify: ok`) pass. Product source commit
`c096e360d40308ca4ce4d49c49bf96732533c1dc` is pushed and read back from
`origin/codex/telegram-webhook-hardening`. This closes only the verified media
numeric-formatting source slice; complete catalog adoption, browser/native
acceptance, deployed migration/RLS/runtime, provider receipts, observability,
CI governance and production acceptance remain open. No live action occurred.

### M961 — F-89 Link-in-bio analytics formatting

The mounted model Link-in-bio analytics and Fanvue-attribution surfaces had
raw click and conversion counts despite already localized currency and
percentage values. Provider counts, total/top-target clicks, tracked and
attributed/unattributed conversions, and per-link clicks/conversions now use
the selected locale's shared number formatter. URLs, slugs, provider kinds and
other identifiers remain data.

Evidence: focused Link-in-bio page tests 6/6, full dashboard suite 154 files /
978 passed, dashboard typecheck/lint, `git diff --check` and
`scripts/verify.sh` (`verify: ok`) pass. Product source commit
`bc36636e46754954419eaff1270994fb3fe81c14` is pushed and read back from
`origin/codex/telegram-webhook-hardening`. This closes only the verified
Link-in-bio analytics count-formatting source slice; complete catalog adoption,
browser/native acceptance, deployed migration/RLS/runtime, provider receipts,
observability, CI governance and production acceptance remain open. No live
action occurred.

### M962 — F-89 digest schedule formatting

The mounted digest schedule status exposed a raw eligibility timestamp and raw
retry count. The eligibility value now uses the selected locale's medium
date/time formatter with explicit UTC and an invalid-date fallback; retry
attempts use the selected locale's shared number formatter. Schedule state,
workspace-safety wording and external-delivery boundary remain unchanged.

Evidence: focused schedule-status tests 8/8, full dashboard suite 154 files /
979 passed, dashboard typecheck/lint, `git diff --check` and
`scripts/verify.sh` (`verify: ok`) pass. Product source commit
`502ad7ffda335b179601b333f0824b537f78576e` is pushed and read back from
`origin/codex/telegram-webhook-hardening`. This closes only the verified digest
schedule formatting source slice; complete catalog adoption, browser/native
acceptance, deployed migration/RLS/runtime, provider receipts, observability,
CI governance and production acceptance remain open. No live action occurred.

### M963 — F-89 operator count formatting

The incident/recovery page had raw crash occurrence and job attempt counters,
and Relay history had a raw priority value. These operator-facing counts now
use the selected locale's shared number formatter while persisted state codes,
service names, identifiers and bounded error details remain data.

Evidence: focused incident/Relay tests 12/12, full dashboard suite 154 files /
980 passed, dashboard typecheck/lint, `git diff --check` and
`scripts/verify.sh` (`verify: ok`) pass. Product source commit
`d153addaf23bf9773ccfd18e7cf613bd02a34074` is pushed and read back from
`origin/codex/telegram-webhook-hardening`. This closes only the verified
incident/Relay operator-count source slice; complete catalog adoption,
browser/native acceptance, deployed migration/RLS/runtime, provider receipts,
observability, CI governance and production acceptance remain open. No live
action occurred.

### M964 — F-89 audit chain count formatting

The mounted audit page's chain-integrity badge exposed the verified entry
count as a raw integer. It now uses the selected locale's shared number
formatter; audit identifiers, action codes and bounded detail remain data.

Evidence: focused audit page test 1/1, full dashboard suite 155 files / 981
passed, dashboard typecheck/lint, `git diff --check` and
`scripts/verify.sh` (`verify: ok`) pass. Product source commit
`152eec655413802a878873a899071243104b49fb` is pushed and read back from
`origin/codex/telegram-webhook-hardening`. This closes only the verified
audit count-formatting source slice; complete catalog adoption,
browser/native acceptance, deployed migration/RLS/runtime, provider receipts,
observability, CI governance and production acceptance remain open. No live
action occurred.

### M965 — F-89 variant analytics formatting

The variant experiment, guidance-attribution, evaluation and published-
performance surfaces exposed raw counts, fixed-point values, percentages and
an unformatted provider collection timestamp. They now use one shared
locale-aware formatter for counts, two-decimal metrics, percentages and UTC
date/time values, with invalid collection timestamps rendered as `—`. Variant
IDs, platform names, provider metadata and authored copy remain data.

Evidence: focused variant suites 15/15, full dashboard suite 156 files / 983
passed, dashboard typecheck/lint, `git diff --check` and
`scripts/verify.sh` (`verify: ok`) pass. Product source commit
`360f69b08d73f3b80163aacc1230c11705ca71e7` is pushed and read back from
`origin/codex/telegram-webhook-hardening`. This closes only the verified
variant analytics formatting source slice; complete catalog adoption,
browser/native acceptance, deployed migration/RLS/runtime, provider receipts,
observability, CI governance and production acceptance remain open. No live
action occurred.

### M966 — F-89 Playbook metric formatting

The model Playbook summary exposed raw score, cadence, published-count,
scheduled-count and score-history values. These values now use the selected
locale's shared number formatter, with two decimal places for posts-per-day;
score percentages retain their explicit percent sign and dates remain rendered
through the existing locale-aware UTC date/time formatter.

Evidence: focused Playbook page tests 7/7, full dashboard suite 156 files / 984
passed, dashboard typecheck/lint, `git diff --check` and
`scripts/verify.sh` (`verify: ok`) pass. Product source commit
`dfe3363ae31194c0d758811229682dbbe35865a0` is pushed and read back from
`origin/codex/telegram-webhook-hardening`. This closes only the verified
Playbook metric-formatting source slice; complete catalog adoption,
browser/native acceptance, deployed migration/RLS/runtime, provider receipts,
observability, CI governance and production acceptance remain open. No live
action occurred.

### M967 — F-89 approvals count formatting

The mounted approvals/drafts route passed its visible review-bundle count to
the localized catalog as a raw integer. It now formats that count through the
shared selected-locale number formatter; review state labels, identifiers,
captions, hashes and publication/provider boundaries remain unchanged.

Evidence: focused approvals page tests 5/5, full dashboard suite 156 files /
985 passed, dashboard typecheck/lint, `git diff --check` and
`scripts/verify.sh` (`verify: ok`) pass. Product source commit
`ac4e6f95bfd20ddc367c24c052bf3b234e11d4b3` is pushed and read back from
`origin/codex/telegram-webhook-hardening`. This closes only the verified
approvals count-formatting source slice; complete catalog adoption,
browser/native acceptance, deployed migration/RLS/runtime, provider receipts,
observability, CI governance and production acceptance remain open. No live
action occurred.

### M968 — F-89 calendar count formatting

The model Calendar route passed its visible posts-in-view count to localized
copy as a raw integer. It now formats that count through the selected locale's
shared number formatter; calendar state, UTC navigation bounds, identifiers,
schedule semantics and provider/publication boundaries remain unchanged.

Evidence: focused Calendar page tests 13/13, full dashboard suite 156 files /
986 passed, dashboard typecheck/lint, `git diff --check` and
`scripts/verify.sh` (`verify: ok`) pass. Product source commit
`1195b34ef7a90ae82c3e4f6c8c56288b5d7bdc37` is pushed and read back from
`origin/codex/telegram-webhook-hardening`. This closes only the verified
calendar count-formatting source slice; complete catalog adoption,
browser/native acceptance, deployed migration/RLS/runtime, provider receipts,
observability, CI governance and production acceptance remain open. No live
action occurred.
