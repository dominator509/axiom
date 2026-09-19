# Current architecture reconciliation

Date: 2026-09-18  
Repository: `dominator509/axiom`  
Source checkpoint: `05ac7900f771feb52f679b5219e9cb14398358be`

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
| Variants and A/B (F-13/F-15/F-16) | Model-scoped lifecycle, assignments, exposure/outcome capture, attribution and winner/reward source paths exist. | Remaining guidance/hook/timing evidence, statistical/runtime acceptance and deployed worker/provider acceptance. |
| Team and shifts (F-24/F-25/F-26) | RBAC, shift lifecycle, handoff/post-note routes and dashboard controls exist. The dual-actor Chatter source slice now adds human/LLM shift records, active-shift/agent-permission checks, durable roleplay handoffs, bounded memory and revisioned `soul.md` persona storage/API/UI. | Dedicated Chatter pagination, authenticated multi-user browser/RLS acceptance, Grok roleplay dispatch/provider receipts and deployed migration/runtime acceptance remain open. |
| Playbook (F-54/F-55/F-56/F-57) | Revisioned guideline storage/editor, calendar checks, generation/caption enrichment and read-only analytics context exist in source. Analytics renders saved platform guidance as advisory context without changing metric calculations or scheduling. | Browser acceptance, stale-editor/history acceptance, deployed migration acceptance, and any future consumer path not covered by the current source audit. |
| Scraper and research (F-17/F-18) | Authenticated bounded scrape runs, worker dispatch, model egress binding and partial-result/error handling exist. | Deployed sidecar/provider isolation, benchmark history and result-quality acceptance. |
| Viral loop (F-79–F-86) | Metric/evidence filtering, publication-bound recipe evidence (hook, scheduled/actual time, bounded shoot controls, media format and ToS verdict), labels, recipes, embeddings/retrieval and parts of reward/digest logic exist. | Trusted thumbnail descriptors, revenue/conversion attribution, all contextual arms, cross-model opt-in behavior, scheduled insight/Relay delivery and runtime acceptance. |
| Connectors and OAuth (F-03/F-31/F-58–F-67) | Static connector contracts and capability declarations exist for supported paths. | Live OAuth, refresh/revoke/disconnect, account onboarding, provider upload/publish/metrics receipts and browser acceptance. Snapchat remains capability-honest manual-assist where its API does not support organic posting. |
| Patreon creator/community integration (F-91) | **New owner extension:** no Patreon connector, OAuth route, membership sync, post-history reader or webhook consumer is source-wired in this checkout. The architecture now records Patreon as a read/sync/event integration, not a fabricated publisher. | Implement API v2 OAuth with minimum scopes, campaign/member/tier/post sync, cursor checkpoints, signed webhook verification, tenant/model RLS, encrypted secrets, manual-assist UI and reconciliation receipts. No publish/DM/payout/unsupported analytics claim without an official contract. |
| Link-in-bio (F-48–F-53) | The Native provider is the current production-enabled default. | Fanlynks, Linktree and Beacons are optional planned adapters and must remain hidden/rejected until their full lifecycle exists; a database row is not evidence of a connection. |
| Localization and language switching (F-89) | **New owner extension:** no shared locale catalog, persisted UI-language preference, or complete mobile/web language switch is currently established. Existing formatting still contains hard-coded `en-US` paths. | Add `en`, `es`, `ja`, `it`, `pt-BR`, and `de` UI locales with an explicit user switch, organization default, browser-first-run detection, BCP-47 normalization, ICU messages, locale-aware formatting, accessible `lang` metadata, and parity across dashboard, native mobile, auth, emails and operator errors. Content language and UI language must remain separate. |
| FanThynks platform affiliate program (F-90) | **New owner extension:** no FanThynks platform-acquisition affiliate, partner, conversion, commission or payout-control plane was found. Fanvue earnings `referrals` is provider data, not this feature. | Add platform-scoped attribution and immutable commission events, partner portal, SaaS conversion/reversal and fraud states, payout export/provider adapter, disclosures and audit/idempotency. Tenant-owned affiliate programs and creator resale controls are out of scope for this lane. No third-party stack is approved until its source, dependency, security and license review passes. |
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
month/week visual board and guarded pending-post day moves. The board reuses the
existing post PATCH contract and verifies the returned identity, state, and
schedule before refreshing. It also renders advisory time windows derived from
verified viral-performance buckets without scheduling or publishing. This
changes only the source-wired column; authenticated browser/mobile interaction,
provider execution, and deployed runtime acceptance remain open.

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

No public Patreon sandbox is documented. Source contract tests will therefore
use redacted JSON fixtures, pagination samples and HMAC signature vectors; a
live creator account, OAuth receipt, webhook delivery, sync receipt and manual
browser acceptance remain separate open gates. This architecture addition does
not implement or authorize live provider activity.
