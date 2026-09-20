# Backend-to-frontend coverage audit

Source baseline: `4a3bb9e0511e83aff2781612a98436d08b8039ee`.

## Verdict and evidence boundary

FAIL: not all operator-facing backend capabilities are controllable through the dashboard. Existing navigation coverage is not feature coverage. This is a repository-static wiring audit, not a claim that every endpoint, provider or browser interaction was executed successfully. Live permission-matrix, mobile/desktop interaction and external-provider acceptance remain open. No live settings, accounts, jobs or publication state were changed for this audit.

Scope inspected: API route registrations and middleware in `packages/api/src/index.ts`; route declarations under `packages/api/src/routes`; LLM and Relay routes; dashboard page/component call sites and `lib/api.ts`; mobile endpoint/screen call sites; MCP manifest; Rust sidecar route declarations. The feature catalog and architecture remain the requirements, not the smaller set of existing pages.

Labels: **partial** means some controls exist but the family is incomplete; **absent** means no dashboard workflow was found in the inspected page/component/client inventory; **wired** means a source call path exists, not runtime acceptance; **internal** means a direct user button would be inappropriate, but its user-facing outcome still needs acceptance.

## Current reconciliation snapshot (working tree, 2026-09-16)

The table below supersedes the original inventory where later remediation milestones
changed the source tree. It is still a static reconciliation: no row is marked
runtime-accepted merely because its unit tests pass.

| Feature IDs | Current source/UI result | Remaining evidence or implementation gap |
| --- | --- | --- |
| F-01 | **Wired**: model workspaces, create/edit, character lock, avatar URL, activate/deactivate | Authenticated desktop/mobile lifecycle acceptance and role matrix remain deployment evidence |
| F-02, F-04, F-43 | **Wired/partial**: owner network config, encrypted credentials, health, model-scoped apply, Rust fail-closed plane | Privileged Linux namespace, WireGuard/proxy leak and real egress acceptance remain open |
| F-03, F-31 | **Partial**: Fanvue OAuth/MCP and worker connector paths exist; the authenticated Grok connection/storage route shell is catalog-backed across six launch locales | Live provider OAuth, upload/post/analytics/vault rehearsal and browser acceptance remain open |
| F-05, F-08 | **Wired**: fan contacts and custom-request lifecycle are reachable from Fans | Browser persistence and long-history acceptance remain open |
| F-06, F-07 | **Source-wired / partial**: Fanvue top-spender/status ingestion, account metrics, CRM tier updates, idempotent normalized touchpoints, authenticated read, and operator sync queue are implemented | Deployed migration/RLS, live provider OAuth/scopes, worker execution, multi-provider event adapters, and browser/mobile/provider acceptance remain open |
| F-09 | **Internal**: pre-post executor exists and is in the generation/publish chain | Runtime script/container acceptance remains open; no separate button is required |
| F-10 | **Source-wired / partial**: schedule page, DST-aware reschedule/cancel controls, visual month/week board, accessible date-based move control, and advisory viral optimal-time suggestions exist | Browser/mobile acceptance, provider-backed scheduling, and deployed runtime evidence remain open |
| F-11 | **Wired/partial**: model-scoped cascade-template CRUD and a responsive Cascade schedules page persist ordered platform offsets and expand approved bundles into ordinary scheduled targets; the route loaded/error shell is catalog-backed across six launch locales | Live account/consent/capability/worker acceptance and browser persistence remain open; expansion deliberately does not bypass approval or publication gates |
| F-12 | **Wired**: Safety page and kill-switch API/worker interlock exist | Live response-time and multi-worker drain rehearsal remain open |
| F-13, F-15, F-16 | **Wired/partial**: model-scoped variant experiments provide draft/running/paused/completed lifecycle, deterministic assignment, exposure/outcome capture, and winner promotion; the authenticated route title and load-failure shell are catalog-backed across six launch locales | Statistical validity and live worker/provider acceptance remain open |
| F-14 | **Internal/partial**: media-plane primitives exist | User-configurable per-model watermark policy and CDN/runtime acceptance are not established |
| F-17, F-18 | **Wired/partial**: authenticated model-scoped scrape runs persist bounded requests/results, dispatch a worker job, and expose status/error controls; the mounted result/history UI and authenticated route title/load-failure shell use the shared six-locale catalog | Deployed sidecar rehearsal and benchmark history acceptance remain open |
| F-19, F-20, F-21 | **Wired/partial**: model-scoped trigger-rule CRUD/UI and a metrics-driven worker evaluator now exist for bounded follow-up generation or operator relay cards | Churn-rescue subscription events, provider moderation coverage, and live metrics/worker acceptance remain open |
| F-22, F-23 | **Partial**: native link-bio short links and click/UTM analytics are real | Subscription-event attribution/ROI join and custom-domain acceptance are not established |
| F-24, F-25, F-26 | **Wired/partial**: team membership, role-scoped shifts, handoff notes, operational queue assignment, bounded team-history pagination and dashboard older-history controls have model-scoped API/UI controls; Chatter roleplay consumes its authorized personal shift roster; the owner-gated workspace-members route shell and model-scoped Team & shifts route shell are catalog-backed across six launch locales | Multi-user browser/RLS acceptance, Grok provider/runtime receipts and deployed migration acceptance remain open |
| F-27 | **Wired**: authenticated model-scoped monthly PDF route and Analytics download link now render from the analytics/playbook/viral store | Browser download, branding review, and deployment acceptance remain open; no background report schedule is claimed |
| F-28 | **Wired**: digest enqueue/list page and relay-card persistence exist | Worker delivery and external channel acceptance remain open |
| F-29, F-30 | **Wired/partial**: persisted image/video clip, resize, transcode, and caption-adaptation controls dispatch retry-safe media operations; the shared bounded media descriptor contract now enforces tenant/model-scoped object keys and MIME/size limits across generated assets, transform outputs, upload metadata, and authenticated previews | Deployed image/video rehearsal, live R2 round-trip, retention/deletion and browser/mobile acceptance remain open |
| F-32, F-36, F-37 | **Wired/partial**: ToS→approval, photoshoot generation, retry/revise, and video review are user-visible | Real video frame scan/provider generation and browser terminal-state acceptance remain open |
| F-33, F-34, F-35 | **Internal/partial**: LLM gateway/TOKENKILLER/provider paths exist | Provider cache toggles and provider-by-provider live acceptance are not a dashboard workflow |
| F-38, F-39, F-40, F-42 | **Partial/internal**: channel/connectors and LLM/provider mechanics exist | Community setup, Venice/vLLM live configuration, and public-agent acceptance are not exposed as complete workflows |
| F-44, F-45, F-47 | **Wired**: REST, `/api/mcp`, dynamic manifest and tiered tools are implemented | External Bearer/MCP client rehearsal and rate/audit evidence remain open |
| F-46 | **Wired/partial**: owner-only per-model grants, one-time capability issuance, durable token registry/revocation, and Agent access UI now exist | External MCP-client rehearsal, provider-side token delivery, and role/browser acceptance remain open |
| F-48, F-52, F-53 | **Wired native**: first-party page, short links, click analytics, and native editor ship | Cross-provider normalization is limited to native until future adapters exist |
| F-49, F-50, F-51 | **Planned by specification**: Fanlynks, Linktree, and Beacons are explicitly rejected/hidden | Do not represent them as connected; implement only as a separately scoped provider project |
| F-54, F-55, F-56, F-57 | **Wired/partial**: revisioned model-scoped playbook guidelines are editable in the dashboard and injected into generation context | Scheduler/browser acceptance remains open |
| F-58–F-67 | **Wired static contract subset**: connector tests cover the corrected TikTok, Discord, Threads, Instagram, and YouTube request/response semantics; unsupported paths remain explicit | OAuth/onboarding, current provider-contract probes, account management, and live publish/metrics/moderation evidence remain open |
| F-68, F-69, F-70, F-72 | **Wired/partial**: signed relay cards/commands, dashboard approvals, model-scoped Relay-card history, and an approval deep-link are source-wired | External channel delivery, uncertain-outcome reconciliation, and complete editor/deep-link lifecycle acceptance remain open |
| F-71 | **Wired source/UI**: model-scoped Telegram/Discord/Signal/iMessage binding CRUD and Relay page now exist | Adapter credential/configuration and real channel delivery remain deployment evidence |
| F-73–F-78 | **Partial**: incidents, crash triage, replay, structured logs, metrics and health primitives exist | Sentry/GlitchTip release/source-map upload, Grafana/OTel deployment, crash-loop paging and live DLQ rehearsal remain open |
| F-79–F-85 | **Partial/internal**: metric ingestion, labels, recipes, embeddings, retrieval, bandit and insights are implemented; the Relay-card state contract now distinguishes durable `stored` digest evidence from `pending`/`sent`/`failed`/`unknown` external-delivery states, with source migration 0056 authored and the dashboard/mobile surfaces exposing the distinction | Operator controls/history, scheduled/external Relay delivery, migration application and worker/runtime acceptance remain incomplete |
| F-86 | **Wired setting/partial**: org-level sharing toggle and scoped viral retrieval exist | Cross-model sharing acceptance and privacy rehearsal remain open |
| F-87 | **Wired source/UI**: metadata-only consent vault, revoke, and publication gate are reachable | Encrypted document-store/provider and expiry rehearsal remain open |
| F-88 | **Partial**: Expo app restores auth and exposes settings/digest/Relay | It is not feature-parity with the responsive dashboard; mobile browser and native acceptance remain open |
| F-89 | **Source-wired/partial**: shared six-locale catalog and normalization, persisted user/org preference API, dashboard provider/navigation/settings wiring, authenticated owner workspace-settings headings/controls/descriptions/save/error/retry states, authenticated shell workspace/home/role/pending/footer/system-health copy, login hero/form labels/errors/session advice, server-rendered assigned-shift access/empty/error/pagination/handoff copy with `Intl` UTC formatting, incidents/crash triage and recovery labels/messages with locale-aware UTC dates, reusable team-shift controls and TeamOperationsManager labels/errors/roles/notes, localized digest page/schedule/recovery controls and Relay history/delivery surfaces with locale-aware UTC timestamps, model analytics and earnings labels with locale-aware counts/percentages/USD/date formatting, accessible `lang`, and mounted mobile selector/DashboardScreen/RelayScreen labels, statuses and date/count formatting now consume the same catalog; authored content remains separate | Remaining dashboard/email/operator adoption, every date/number/currency formatting surface, browser/native mobile acceptance, and deployed migration/RLS/runtime evidence are open |
| F-90 | **Wired/partial**: native platform-level affiliate schema/authored migration 0054, owner-gated API and dashboard controls cover partners, campaigns, attribution, SaaS conversion/commission/reversal, fraud holds, audit/idempotency and non-transfer payout CSV output; the owner workflow now consumes the six-locale catalog with locale-aware USD, percentage and date formatting | Migration application, billing/reconciliation integration, license/security/legal review, browser acceptance and payout/operator acceptance remain open; provider earnings referrals are not reused and tenant affiliate/reseller features are out of scope |
| F-91 | **Wired/partial**: Patreon now has authored migration 0055 and Drizzle tables for campaigns, memberships, posts, sync state and webhook events; model-egress OAuth/PKCE with encrypted persistence; bounded read/sync routes; durable cursor/replay guards; HMAC webhook persistence; a model dashboard; and a native mobile community surface with model scoping, redacted status/read views and operator-only sync controls | Deployed migration/RLS/runtime acceptance, real provider OAuth/webhook/sync receipts, browser/mobile acceptance and operational reconciliation remain open; no publish/DM/payout/member-mutation/unsupported-analytics claim is allowed |

### Executed remediation queue

The source implementation queue has now completed variant/A-B controls, authenticated
scrape orchestration, team/shift operations, media clipping/adaptation, and playbook
guideline management. Remaining work is primarily runtime/provider evidence: live
provider contracts and OAuth/publishing, an actual R2 round trip, privileged VPN
isolation, browser/mobile acceptance, live migration rehearsal, external observability
deployment, and GitHub branch/ruleset enforcement. External provider adapters remain
separately gated because claiming them without provider contracts would recreate the
audit defect.

## Capability-family coverage

Backend paths below are relative to `/api/v1` unless noted. Evidence paths are relative to the repository root.

| Capability and backend evidence | Dashboard evidence / disposition | Result |
| --- | --- | --- |
| Models list/detail/create/PATCH/DELETE (`routes/models.ts`) | Home, `NewModelForm`, `ProfileEditor`, `ModelLifecycleControls`, and `CharacterLockEditor` expose profile fields, activation/deactivation, soft-delete and character-lock changes with role gates | Wired source/UI; browser persistence, multi-user/RLS and deployed migration/runtime acceptance remain open |
| Network metadata/health (`routes/network.ts`) | `NetworkForm` submits mode/address/expected IP; model Network page now exposes egress credentials, bind/unbind/sync/status/health controls with role-aware failure states | Wired source/UI; privileged VPN rehearsal remains open |
| Encrypted egress credentials, config CRUD, bind/unbind/sync/status/health (`routes/egress.ts`) | Network page reaches the model-scoped egress contracts; secrets are never rendered back | Wired source/UI; deployed tunnel/kill-switch acceptance remains open |
| Social account list/connect/delete; Fanvue authorize/callback/refresh; Threads authorize/callback; Patreon authorize/callback/sync (`routes/social.ts`, `fanvue-auth.ts`, `threads-auth.ts`, `patreon.ts`) | Model Network page exposes provider OAuth entry links, bounded connected-account state, and role-gated disconnect controls; approval account selection reuses the connected-account contract | Wired source/UI; live OAuth/refresh/revoke/provider acceptance and browser onboarding remain open |
| Fan contacts, timeline, touchpoint creation, custom-request create/status (`routes/fans.ts`) | Fans page provides bounded contact pagination, fan detail/timeline loading, contact upsert, touchpoint recording, custom-request creation and ticket status controls with model scoping | Wired source/UI; provider sync, browser persistence and long-history acceptance remain open |
| Consent records/status/create/revoke (`routes/consent.ts`) | Model Consent vault lists metadata-only records, shows publication-relevant state, creates references/digests and exposes role-gated revoke controls; document bytes and credentials are never accepted | Wired source/UI; encrypted document-store/provider and expiry rehearsal remain open |
| Calendar and post schedule/reschedule/cancel (`routes/posts.ts`) | Calendar reads bounded month/week windows and exposes visual month/week navigation, guarded drag rescheduling, accessible date-based moves, and existing-post PATCH/DELETE controls; the API preserves DST ambiguity and publication-state locks | Wired source/UI; browser/mobile/provider-backed scheduling and deployed runtime acceptance remain open |
| Cascade template CRUD/expansion (`routes/cascade-templates.ts`) | Model workspace Cascade schedules page creates, enables/disables, deletes and expands templates with stable mutation identity | Wired source/UI; runtime/provider acceptance remains open |
| Trigger-rule CRUD/evaluation (`routes/trigger-rules.ts`, `worker/executors/trigger.ts`) | Model workspace Automation rules page configures threshold/action rules; metrics polling enqueues evaluation | Wired source/UI/internal worker; provider metrics, churn events, moderation adapters, and live acceptance remain open |
| Bundle list/detail/create/media/approve/revise/reject/video-review (`routes/bundles.ts`) | Approval controls, `BundleMedia`, `VideoReview`; creation also occurs through generation/upload. Media operations expose explicit queued/running/failed/completed status, refresh, safe retry, and transformed-result preview. The model media library now projects the existing asset/media-operation source/result graph and renders saved/unknown lifecycle state without implying approval. Arbitrary raw bundle creation does not need a duplicate UI. | Wired source/UI; deployed media acceptance remains open |
| Generation, source-image selection, retry, prompt suggestion (`routes/generate.ts`) | `GenerateForm`, `GenerationProgress`, `GenerationRetry`, `SavedGenerationRetry`, `MediaPromptSuggestion` provide call paths | Wired; runtime acceptance incomplete |
| Image/video upload (`routes/media-upload.ts`) | `MediaUpload` is reachable from generation and directly from the model media library; confirmed uploads refresh the saved asset list and preserve uncertain-request reconciliation. The listing now projects operation status and source/result relationships from existing tables, with explicit unknown state when no operation is attached. | Deployed upload/playback, R2 round-trip, browser/mobile and approval/runtime acceptance remain open |
| Native link-in-bio CRUD/analytics (`routes/linkbio.ts`) | `LinkbioPanel` enables/disables native provider and edits links; analytics page call exists. External adapters explicitly unavailable | Wired native only |
| Analytics/viral exemplars (`routes/analytics.ts`, `viral.ts`) | Analytics page displays 30-day totals, per-platform/daily metrics, viral exemplars, playbook context and private PDF download; labels, accessibility text, counts, percentages and empty/error states consume the shared six-locale catalog | Wired source/UI; broader filtering/detail controls, provider metrics, browser/PDF and deployed runtime acceptance remain open |
| Monthly PDF report (`routes/reports.ts`) | Analytics page exposes a model-scoped download link; generated artifact is private and no-store | Wired; browser/PDF visual acceptance remains open |
| Playbook score/read/record (`routes/playbook.ts`) | Score display plus revisioned Playbook guideline CRUD/editor are reachable from the model workspace | Wired source/UI; scheduler/browser acceptance remains open |
| Audit list/verify (`routes/audit.ts`) | Audit page calls both; source wiring present | Wired |
| Incident list/replay (`routes/incidents.ts`) | Incidents page plus `ReplayButton`; source wiring present | Wired |
| Crash report ingestion/list/resolve (`routes/crash-reports.ts`) | Incidents page lists open/resolved/ignored reports, preserves independent cursors, and exposes operator-gated idempotent resolve controls with localized labels, messages and UTC date formatting; incident jobs remain a separate resource | Wired source/UI; deployed/browser role acceptance and external crash sink/paging remain open |
| Digest list/generate (`routes/digests.ts`) | `/digests` lists bounded cards, exposes owner schedule status/recovery, and gives operational roles an explicit generate action; native mobile also has list/generate calls and controls | Wired source/UI; worker delivery, external Relay acceptance, and full mobile parity remain open |
| Org settings publishingEnabled/viralSharing (`routes/org-settings.ts`) | Owner Settings page exposes viral-sharing, weekly-digest and publishing-worker controls with save confirmation, idempotent retry and localized safety explanations; mobile parity remains partial | Wired source/UI; deployed migration/RLS/runtime and browser/mobile acceptance remain open |
| Kill switch read/enable/disable (`routes/killswitch.ts`) | Localized Safety page, owner-only explanation without restricted API calls, fail-closed unknown state, global banner, and enable/disable control are source-wired | Wired source/UI; deployed/runtime and browser role acceptance remain open |
| Grok subscription status/login attempts/cancel (`llm-gateway/src/routes.ts`) | `GrokConnection` and `lib/grok-connection.ts` wired; credential presence correctly distinguished from generation access | Wired subset |
| Subscription disconnect and other provider login/status (`llm-gateway/src/routes.ts`) | Grok has resumable login/cancel/disconnect controls; OpenAI and Anthropic now expose authenticated status, streamed login instructions, explicit disconnect, bounded output and confirmation controls on the shared connections page | Wired source/UI; live provider CLI/OAuth, browser and deployed acceptance remain open |
| Grok R2 configuration read/write/delete/verify (`llm-gateway/src/routes.ts`) | `GrokR2Storage` provides save/status/verify/remove; verification performs an application-scoped write/read/checksum/delete probe | Wired source/UI; live bucket round trip remains open |
| Chat/tokenkiller/stream/providers/stats (`llm-gateway/src/routes.ts`) | Some consumption through generation; no generic chat/stats console. Internal chat primitives need not all become buttons | Internal / incomplete operator visibility |
| Relay card/command, webhook adapters (`relay/src/routes.ts`, API registration) | Model Relay page, `RelayCardHistory`, and `RelayBindingManager` expose bounded card history, approval deep-links, and model-scoped Telegram/Discord/Signal/iMessage binding CRUD | Wired source/UI; adapter credentials/configuration, external delivery, and deployed channel acceptance remain open |
| MCP analytics/inbox/generation/publishing/network tools (`mcp-server/src/manifest.ts`) | Agent access page administers grants/tokens; raw tool invocation is not required as a separate dashboard | Wired administration; external client acceptance remains open |
| Media transcode/resize/watermark/clip/video variants (`crates/media-plane/src/main.rs`) | Media page exposes persisted clip/resize/transcode controls and approvals expose caption adaptation with reapproval | Wired source/UI; deployed sidecar rehearsal remains open |
| Social/competitor scraping (`crates/scraper/src/main.rs`) | Scraping page creates bounded authenticated runs and reports queued/running/completed/failed state | Wired source/UI; deployed sidecar rehearsal and benchmark history remain open |
| Vision classification, hash, frames, encryption/decryption, telemetry, health, OAuth callbacks | Keep internal or service-authenticated; expose results/settings through scoped workflows, never raw secret/decrypt or arbitrary sidecar execution controls | Intentionally internal |

## Confirmed cross-cutting defects

1. **Permission-aware UI is incomplete.** API registration makes egress, network, kill switch and org settings owner-only. Network page catches load failure as `null` and still renders an editable form. Social account load failure is converted to an empty account list. An operator can see an apparently configurable surface that cannot succeed. Do not resolve this by removing backend authorization.
2. **Saving is not activation.** NetworkForm only calls the metadata PUT. Credential fields and plane bind/sync are separate backend contracts with no corresponding workflow. A successful metadata save cannot mean a tunnel is ready.
3. **Frontend parity differs by platform.** Native mobile has digest and sharing controls missing from the responsive website. Native mobile's endpoint wrappers do not prove every operation is rendered or permitted; mobile browsers use the dashboard, not Expo.
4. **Persistent media management is source-wired but not runtime-accepted.** The model media library now provides authenticated image/video previews, upload/generated provenance, cursor-filtered listing, operation lifecycle projection, source/result relationships, and transform/retry visibility over the existing asset/media-operation tables. Deployed worker/playback, R2 round-trip, browser/mobile, and approval/runtime evidence remain open.
5. **The documented all-feature gate is not established.** `L5.0-test-matrix.md` promises an F-01..F-88 preservation check, and F-89/F-90/F-91 are now owner extensions. Existing navigation tests establish reachability of existing pages, not presence and usability of every required feature.
6. **Localization remains only partially cross-cutting.** The dashboard shell/navigation/settings, authenticated login, shifts/team operations, digest/Relay surfaces, mounted mobile Dashboard/Relay screens and persisted locale precedence now share a typed catalog, but remaining dashboard pages, email and operator errors still need adoption plus a full date/number/currency formatting audit.
7. **Platform affiliate state is source-wired but not operationally accepted.** The native F-90 contract is separate from provider earnings/referral fields and now has schema/API/dashboard source paths. Migration application, billing/reconciliation, license/security/legal, browser, payout and operator acceptance remain open. Tenant-owned affiliate programs are not part of F-90.

## Required acceptance evidence before closing these findings

For every operator capability: name its architecture feature, mounted backend contract, permitted roles, reachable UI control, validated payload, visible success/error/empty states, persistence after reload, and desktop/mobile browser result. Test forbidden roles as well as allowed roles. Destructive operations need confirmation; retries must preserve user-intent idempotency; asynchronous operations need terminal status and reconciliation. Do not bypass safety gates or dispatch publication merely to satisfy coverage.

Remaining audit depth: complete field-by-field and role-by-role runtime execution; inspect all worker-only architectural features for missing orchestration rather than merely missing buttons; verify every F-01..F-91 requirement individually. This document is a coverage finding, not a new execution plan, and does not certify architecture completeness or production readiness.

## Remediation evidence after baseline

- M193: Fans page now includes a role-gated contact add/update form against the existing upsert route. Optional blank fields preserve existing values; uncertain submissions retain the request body/key and lock editing until reconciliation. Eleven payload/page tests and dashboard typecheck pass. This narrows the fan-contact gap only: timeline, ticket controls, pagination and deployed browser save/reload acceptance remain open.
- M194: Added role-gated custom-request creation (optional fan, description and price) and existing-ticket status controls on Fans. Fourteen focused tests cover payloads, rendering, role visibility and same-intent transport retry; dashboard typecheck passes. No billing, messaging or publication side effects added. Browser persistence acceptance, timeline and pagination remain open; this supersedes the missing ticket-controls portion of M193, not the overall CRM finding.
- M195: Contact links now load the existing fan-detail API within Fans, showing up to 100 saved interactions and linked tickets. Selected fan must match the current talent before rendering. Query validation, escaped interaction content, scoped rendering and existing partial-load cases covered; full dashboard suite 349 tests passes, typecheck/lint pass. No live inbox sync claimed. Timeline-entry creation, contact pagination and deployed desktop/mobile acceptance remain open.
- M196: Wired contact cursor pagination with next/first navigation, preserved list position when opening/closing a fan, and distinguished exhausted pages from an empty contact database. Fifteen focused page/client tests and typecheck pass. Contact pagination is now source-wired; live traversal and timeline-entry creation remain unverified/incomplete respectively.
- M197: Selected fan timelines now expose an operational-role interaction recording form using the existing touchpoint route. Direction is explicitly historical, not a send command; save-time timestamp semantics are visible. Thirteen focused page/form tests cover payload validation and same-intent retry; typecheck/lint pass. Basic CRM mutations are source-wired, not deployed/browser accepted; automated cross-platform ingestion and history beyond the backend's 100-entry cap are not established.
- M198: Network page now matches owner-only backend access: other roles receive an explanation rather than unusable controls. Owner load failure blocks editing instead of implying empty configuration; account-load failure is distinct from no connections. Nine focused tests, typecheck and lint pass. This addresses network permission/error presentation only; full egress credential/bind workflow and other role-aware surfaces remain open.
- M200: Saved non-direct configs now expose owner-only encrypted credential entry: complete proxy username/password or WireGuard private/peer/preshared keys, endpoint, assigned IPv4 address and allowed IPs. Uses existing egress PATCH encryption path with replacement acknowledgment, no secret readback, bounded generic errors and same-intent retries. Ten focused render/payload/page tests and typecheck pass. Saving is explicitly not activation; per-model activation/health, deployed credential round trip and privacy enforcement remain open.
- M201-M202: Owner live-status readout and explicit model-scoped apply controls now exist. API validates model ownership and targets a distinct Rust sync-model endpoint so older sidecars reject rather than ignore scope. Reconciliation filters both configuration application and stale-binding teardown. Source wiring no longer lacks apply/status controls; deployed behavior, credentials, Linux isolation and live leak tests remain open.
- M203 combined verification: dashboard 368/368 tests passed. First full API run: 580 passed, two import-hook timeouts left 56 skipped; those 56 passed at one worker, and the complete API suite passed 636/636 at maxWorkers=2 with unchanged timeouts/assertions. API typecheck passed. Rust formatting drift corrected and fmt check passed. This does not establish default-concurrency reliability, hosted CI or deployed acceptance.
# M204: Network activation interaction hardening

The owner-facing activation control now validates the sidecar's `synced`, `bound`,
and `skipped` response before reporting reconciliation. Empty/malformed 2xx
responses remain uncertain. Routing changes are not automatically retried by the
browser mutation helper; an explicit retry preserves the uncertain intent key.
Definitive validation/auth/not-found rejections require renewed approval and a
new key. Successful reconciliation displays bound/skipped counts and explicitly
does not claim tunnel health.

Evidence: 10 interaction regressions exercise explicit approval, concurrent-click
suppression, model-only payload, uncertain retries, rejected intents, and invalid
successful responses. Full dashboard suite: 378 tests across 46 files passed;
dashboard typecheck and focused lint exited 0 (existing Next pages-directory lint
warning). No live routing changes or deployment performed. Privileged isolation,
provider connectivity, and authenticated browser acceptance remain open.
# M205: Calendar reschedule and cancellation controls

Calendar cards now expose the existing PATCH/DELETE post APIs to operational
roles for pending targets without a remote publication ID. Explicit confirmation
is required. Rescheduling validates a future local timestamp using the existing
DST-aware schedule converter. In-flight duplicate submits are blocked; uncertain
retries retain the original action/body/key and never automatically retry.
Successful responses must identify the post and confirm its new state/time.
The server remains authoritative for dispatch-marker and publication-lock checks.

Evidence: calendar role/state visibility tests and mutation tests for reschedule,
cancellation, uncertain retries, empty successful responses, and input validation.
Full dashboard suite: 382 tests in 47 files passed; typecheck and focused lint
exited 0 (existing Next pages-directory lint warning). No live schedule changes.
Drag/drop week view, account retargeting controls, media previews, and deployed
authenticated browser acceptance are not established by this change.
# M206: Basic talent profile editing

The overview now exposes the existing model PATCH route for creator name, handle,
and brand note, including clearing the note. Owner/manager/operator roles see the
editor; read-only roles also no longer see the character-lock editing control.
Writes exclude character-lock and activation fields. An uncertain save retains
the original body/key; successful responses must confirm identity and values.
The editor remounts on the saved profile timestamp to avoid stale default fields.

Evidence: seven focused component/page tests and dashboard typecheck passed;
focused lint exited 0 with the existing Next pages-directory warning. No live
profile was edited. Avatar editing, activation/deactivation enforcement, and
deployed browser acceptance remain open. Hosted CI 35047124075 for the earlier
af8fe4b revision completed successfully; it does not cover M204–M206.
# M207: Crash report triage on Incidents

Incidents now lists existing crash-report records with open/resolved/ignored
filters and forward pagination. Operational roles can invoke the existing resolve
endpoint; its mutation now also uses operational-role middleware server-side.
Resolution checks returned report identity/status, preserves uncertain intent,
and explicitly does not claim to repair software or replay jobs. Job recovery
shows full escaped error detail, hides replay for known uncertain provider
outcomes/read-only users, and no longer claims queue health from an empty page.

Evidence: four dashboard regressions, dashboard typecheck, 68 API wiring/crash
route tests passed. Focused dashboard lint exited 0 with the existing Next warning.
No live report resolved or job replayed. Browser/mobile acceptance, job-list
pagination, and runtime operator-role acceptance remain open.
# M208: Recovery job pagination

The existing incidents cursor is now forwarded by the dashboard API client and
exposed through Older failed jobs / Latest failed jobs controls. Job and crash
pagination preserve each other's cursor and crash status; changing crash status
resets only the crash cursor. Repeated query parameters are not forwarded as
ambiguous cursors. Job load failures remain alerts rather than empty results.

Evidence: ten focused incident-page/API-client tests and dashboard typecheck
passed; focused lint exited 0 with the existing Next warning. Deployed browser
acceptance remains open; no replay or other live mutation was dispatched.
# M209: Saved media library

A Media library tab now lists the existing talent-scoped asset store, including
uploads and generated files, with image/video previews and forward pagination.
Two read-only routes in the existing media router project non-storage metadata
and serve owned assets through the existing hash-verified authenticated preview
reader (including Range requests). No migration or new storage service is added.
The UI explicitly separates media presence from compliance/approval status.

Evidence: 15 dashboard navigation/library tests, 12 media-router tests, API and
dashboard typechecks, focused lint passed. The initial library test cleanup
incorrectly returned a mock function; corrected before the passing rerun. No live
media accessed or modified. Source/generated provenance labels, selecting stored
references directly for generation, preview error UX and deployed browser
acceptance remain open; this does not claim full media workflow completion.
# M210: Media library preview recovery

Library cards now reuse the existing authenticated bundle viewer with an explicit
model/asset identity alternative. This provides bounded HEAD requests, media-type
validation, loading/error states, manual saved-media retry, and aspect-ratio-safe
image/video display. Retry cannot generate or publish media. The bundle identity
path remains unchanged.

Evidence: eleven focused preview/library tests, dashboard typecheck and focused
lint passed. The tests cover library image/video byte-load failures and manual
retry alongside existing deadline/cleanup/HTML-response checks. Actual browser
playback and deployed acceptance remain unverified.
# M211: Consent vault GUI

The existing metadata-only consent-record and immutable-revoke APIs are now
reachable from every talent workspace through a Consent vault tab. The UI lists
grant/revoke state, validity, subject and digest, explicitly excludes document
bytes, and exposes add/revoke only to owner/manager/operator roles. Create and
revoke controls preserve idempotency identity after uncertain responses and
validate returned record identity/state.

The media library now links an owned image directly into the existing video
generation form. The generator opens in video mode with that source selected,
shows an authenticated source preview link, and still requires the operator to
review the prompt before queueing.

Evidence: 16 consent/navigation/page tests and 33 generation/library handoff
tests passed; dashboard typecheck and focused lint passed (existing Next
pages-directory warning). No live consent, media, or generation mutation was
performed. Provider acceptance, browser/mobile acceptance, social connector
workflow coverage, and deployment remain open.
# M212: Social-account lifecycle judgment

The connected-account table now exposes provider-backed disconnect/revoke to
owner, manager and operator roles, with confirmation, stable uncertain-request
identity, and response validation. Connection creation was intentionally not
faked: the existing API requires an encrypted credential envelope and the
repository has no completed OAuth/onboarding UI for these platform rows. That
gap remains explicit rather than presenting a plaintext token form.

Evidence: eight focused network/disconnect tests, dashboard typecheck and
focused lint passed. No provider revoke or live account mutation was performed.
# M213: Workspace settings GUI

The existing owner-only org-settings GET/PATCH routes now have a discoverable
Settings page. It exposes only the real `viralSharing` and `publishingEnabled`
switches, explains their scope, keeps emergency halt on the Safety page, and
validates the returned persisted values. Non-owners receive an explicit access
message; load failures are not rendered as defaults.

Evidence: 16 focused settings/navigation tests, dashboard typecheck and focused
lint passed. No workspace setting was changed live. This does not imply that a
mechanics-only worker/netns/ledger control needs a separate GUI.
# M214: Weekly digest GUI

The existing digest-week enqueue and relay-card list APIs now have a primary
navigation page. Operational roles can queue the current weekly digest; the UI
requires a confirmed job receipt, does not auto-retry a possibly paid/queued
mutation, and explains that queueing is not publication. Durable cards are
rendered with cursor pagination and load failures are distinct from an empty
history. Read-only roles can review cards but cannot queue a digest.

Evidence: three focused digest tests, dashboard typecheck and focused lint
passed. No digest was queued live. Worker completion and deployed browser
acceptance remain open.

# M220: Model lifecycle and avatar controls

The existing model PATCH/soft-delete contracts are now reachable from the
overview for operational roles. Avatar URL editing uses the existing nullable
field with bounded HTTP(S) validation. Deactivation requires confirmation and
retains media, bundles, and audit history; reactivation uses PATCH. Both paths
preserve one idempotency key/body across an uncertain response and validate the
returned model identity and `isActive` state.

Evidence: model route 23-test suite, profile/lifecycle/overview 14 focused
dashboard tests, API/dashboard typechecks, and diff check pass. No live profile
was changed; role, deployed, and browser acceptance remain open.

# Current source update — M408

The current checkout now exposes the previously missing model-scoped Relay-card
history workflow without weakening the external-delivery boundary:

- `packages/api/src/routes/relay-cards.ts` serves cursor-paginated history only
  through the model's owning organization and role/model access condition.
- The response projection and an explicit response sanitizer omit
  `externalRef` and `config`, which may contain provider routing details.
- `packages/dashboard/app/models/[id]/relay/page.tsx` and
  `packages/dashboard/components/RelayCardHistory.tsx` expose the history,
  empty/error states, older-page navigation and an approval-workflow link.
- Focused API authorization/serialization tests, dashboard tests, package
  typechecks and linters pass. This remains source evidence only; it does not
  prove external Relay delivery or deployed browser acceptance.

# M221: Relay binding workflow

Added model-scoped Relay binding GET/POST/PATCH contracts over the existing
`relay_binding` table and exposed a Relay delivery tab in each talent workspace.
The UI supports Telegram, Discord, Signal, and iMessage destination references,
role-aware enable/disable controls, confirmation, response validation, and
uncertain-intent retry. It deliberately never accepts bot credentials; those
remain deployment-owned. The page explains that a saved binding is not proof of
adapter configuration or external delivery.

Evidence: relay-binding route tests, overview navigation tests, API/dashboard
typechecks and diff check pass. No channel binding was created or external
message sent. Real adapter configuration and worker delivery remain open.

# M222: Media origin provenance

Added an additive `asset.origin` field (`uploaded`, `generated`, or legacy)
with a migration-safe `legacy` fallback. The upload route records `uploaded`,
the media-generation executor records `generated`, and the talent media
library now labels source uploads separately from generated output. Existing
assets are not guessed or relabelled.

Evidence: DB schema/migration 122 tests, media-upload 12 tests,
media-generation 14 tests pass. No migration was run against a live database;
deployment and browser gallery acceptance remain open.

# M223: Monthly performance report

Added an authenticated, model-scoped monthly PDF endpoint that aggregates
scheduled/published posts, provider metrics, latest Course Adherence Score, and
viral exemplar counts for a validated `YYYY-MM` calendar window. The Analytics
page now exposes a direct download link. The artifact is generated in-process,
marked private/no-store, and contains no provider credentials or user-supplied
HTML. This is on-demand report generation; a background monthly scheduler and
external white-label branding review remain separate deployment/product work.

Evidence: three report-route tests, API/dashboard typechecks and dashboard lint
pass. No live report was downloaded; runtime database and browser/PDF rendering
acceptance remain open.

# M224: Durable agent permission administration

Added owner-only model-scoped agent grant CRUD and a discoverable Agent access
page. Issuing a grant creates a short-lived signed bearer token and records only
non-secret token metadata; the raw token is shown once. The MCP HTTP transport
now checks both the global revocation denylist and the durable token/grant
registry inside the model's RLS context, so deleted or changed grants fail
closed across API processes. Token revoke is durable and audited.

Evidence: agent route 3-test suite, MCP auth durable-grant regression, DB schema
and migration tests, API/dashboard typechecks, dashboard lint, and overview
navigation update pass. No live grant/token was issued; external MCP client and
browser role acceptance remain open.

# M225: Cross-platform cascade schedule templates

Added a model-scoped `cascade_template` resource and migration with ordered platform
steps, bounded offsets, enable/disable/delete controls, and an operator-facing Cascade
schedules page. Expansion accepts only a future base time and an approved content
bundle, verifies model-scoped consent, media capability, and connected-account
resolution for every destination, then creates ordinary `post_target` rows and
`publish.target` jobs in the same transaction with deterministic target idempotency.
The workflow explicitly does not bypass approval, ToS, consent, kill-switch, or worker
gates.

Evidence: DB schema/migration tests, cascade route tests covering auth, validation,
persistence and future-only expansion guards, API/dashboard typechecks, dashboard lint,
and middleware registration checks. No live schedule was expanded; provider accounts,
worker execution, and authenticated browser/mobile acceptance remain open.

# M226: Metrics-driven trigger rules

Added authenticated model-scoped trigger-rule CRUD with bounded metric thresholds,
supported platform validation, cooldowns, and safe action configuration. Added the
`trigger.evaluate` worker job after real metrics ingestion. A matching threshold can
enqueue a new content-generation bundle or an operator relay card; it cannot publish
directly and the resulting work still passes ToS, approval, kill-switch, and worker
gates. The model workspace now exposes Automation rules with role-aware controls and
same-intent retry handling.

Evidence: trigger route tests, API/worker/dashboard typechecks, and full regression
coverage for the existing dashboard/API/DB slices. Churn-rescue subscription events,
connector moderation APIs, provider metrics, and deployed worker acceptance remain
open.

# M227: Variant, scraper, team, media, and playbook source reconciliation

Implemented the next five architecture slices as additive, tenant-scoped workflows:
variant experiments with deterministic assignments and winner promotion; bounded
authenticated scrape runs with durable worker state; team membership, shifts, notes,
and queue operations; persisted media clip/resize/transcode operations plus approval-safe
caption adaptation; and revisioned playbook guidelines injected into generation context.
Each mutation has role/model ownership checks, idempotency where it creates durable work,
and visible dashboard loading/empty/error states. No operation publishes directly.

Evidence: API, DB, worker, and dashboard tests; package typechecks; migration dry-run
through migration 0034; and `git diff --check`. Live sidecar, database, multi-user,
browser, and mobile acceptance remain open.

# M228: Provider contract and R2 verification reconciliation

The connector test suite now verifies the source-level contracts for TikTok Direct Post
initialization/status/revoke, Discord 204 webhook responses and token deletion, Threads
media parameters/carousel/post insights, Instagram carousel containers, and the absence
of the deprecated YouTube favorite/share metric. These are static contract checks, not
live provider proofs. The references are the official [TikTok Direct Post API](https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post),
[Discord Webhook resource](https://docs.discord.com/developers/resources/webhook), and
[YouTube videos resource](https://developers.google.com/youtube/v3/docs/videos).

Grok R2 now has an explicit dashboard verification action and an application-scoped
write/read/checksum/delete probe; credentials remain encrypted and are not returned.
The live bucket round trip has not been run from this workspace.

# M229: Regression and release-gate checkpoint

Focused API middleware, worker sanitizer, dashboard R2, LLM gateway R2, connector, DB,
and typecheck gates pass. The full package suites are resource-sensitive when run in
parallel: API and dashboard import hooks can exceed the default 30-second Vitest hook
timeout, and the sanitizer's real FFmpeg image fixture can exceed it under contention;
the affected suites pass when isolated. This is recorded as a test-harness execution
constraint, not suppressed as a product pass.

The deployed test release remains the separately verified `da09f664cbe801ed45a62ad4ad8014c94c795`
artifact with successful hosted CI. Current source typecheck and application compilation
pass; the Windows production packaging step cannot create Next standalone symlinks under
the current non-elevated checkout and therefore needs a Linux/CI packaging run or an
explicitly approved Windows symlink-capable environment. Current source changes are not
yet committed or deployed. GitHub rulesets read empty, and branch-protection
write/readback is still an external operator gate because the connected GitHub
integration cannot manage that endpoint. Security scan evidence is clean for tracked
secrets, patched-dependency fixtures, pnpm audit, and `.env` handling; cargo-audit could
not refresh the RustSec advisory database because this workstation could not reach the
GitHub advisory repository.

# M410: Visual calendar scheduling surface

The model calendar now has a real responsive month/week board instead of a
details-only list. It groups scheduled targets into a Monday-first UTC grid,
provides link access to the corresponding post details, and exposes a drag
affordance only for editable pending targets that have not been handed to a
provider. A drop uses the existing authenticated `PATCH /api/v1/posts/:id`
contract with an idempotency key, verifies the returned identity/state/time
before refreshing, and states that publication still requires the normal
worker/provider gates.

The calendar also consumes existing verified viral-performance buckets as
advisory time-window suggestions. It never schedules, publishes, or claims
causality, and links back to the model analytics evidence. Focused calendar
tests (16/16), dashboard typecheck, lint (three pre-existing warnings only),
and diff-check pass. Browser/mobile interaction, provider execution, and
deployed runtime acceptance remain open.

# M513: Media gallery lifecycle projection

The model media library now projects the existing `asset`, `media_operation`, and
`asset_variant` records into one tenant/model-scoped gallery response. Each item
reports the newest operation state when one exists, an explicit `unknown` state
when an asset has no attached operation, the operation identity, and source/result
asset IDs. The API deliberately omits operation errors, storage keys, provider
responses, and credentials. The dashboard renders authenticated previews, source
and result anchors for the current page, lifecycle badges, and the existing
transform/retry controls; it never treats gallery presence or transform completion
as ToS approval or publication authorization.

Evidence: API media-upload route tests 15/15, dashboard media-page tests 11/11,
API typecheck, and dashboard typecheck pass. No migration, runtime service,
provider, R2, database, browser, or deployment action occurred. Deployed media
playback/R2 round-trip and full desktop/mobile acceptance remain open.

# M519: Patreon community lifecycle source wiring and reconciliation correction

The earlier static rows for the owner extensions were stale relative to the
current checkout. F-90 is source-wired as a native FanThynks SaaS acquisition
program: authored migration 0054 and Drizzle tables cover platform programs,
partners, campaigns, attribution, conversions, commission events, holds,
payout exports and audit; authenticated owner-only API routes and the `/affiliate`
dashboard cover disclosure-gated partner/campaign operations, reports, holds
and non-transfer CSV export. No third-party affiliate repository was imported,
and provider earnings `referrals` remains separate.

F-91 is source-wired but remains partial at the production-readiness boundary.
The connector is integrated with authored migration 0055, tenant/model-scoped
normalized tables, model-egress OAuth/PKCE and encrypted account persistence,
bounded campaign/member/post sync routes, durable cursor replay protection,
signed webhook event persistence and a model dashboard for status, sync health,
normalized records and unsupported actions. The campaign normalizer now uses
the provider creator relationship or OAuth identity fallback and fails closed
when neither is available. The native mobile surface now selects only
server-returned models, keeps provider references redacted and bounded, and
exposes sync controls only to workspace operators; the model-access middleware
also scopes social-account and Patreon metadata reads to the assigned model.
Deployed migration/RLS, provider OAuth/webhook/sync, browser/mobile and
operational acceptance remain open.

Evidence: 26 connector tests, 3 Patreon route tests, 14 social/OAuth tests,
128 DB schema/migration tests, API/worker/dashboard typechecks, dashboard
navigation tests and API/dashboard production builds pass. This update does
not close migration application, license/security/legal, browser, mobile,
provider or deployment gates; no live action occurred.

# M521: Full isolated matrix regression closure

The disposable workspace matrix exposed and closed two reachable-surface
regressions and two stale source expectations. The Patreon model page is now
linked from `ModelTabs`; Chatter actor labels prefer the authenticated
display name with email fallback; the dashboard session type declares that
field; the DB relation-count assertion includes exported roleplay relations;
and the mobile locale selector uses the existing `panel` theme token. The
final isolated run passed all 24 workspace tasks, including API 1,117,
dashboard 728, DB 165 plus 5 skipped, connectors 413, relay 272, worker 301
plus real PostgreSQL integration, MCP 91, LLM gateway 387, core 61, auth 28
and mobile 23. Dashboard production build and mobile web export passed, and
the disposable fixture was removed. No live, provider, migration, database,
permission, service or deployment action occurred.

# M580: F-89 operator formatting lane

The current source audit confirmed that the mounted Audit, Approvals, Playbook
history, AgentPermissionManager and TriggerRuleManager surfaces still contain
raw visible English and/or host-locale date/count/percentage formatting. A
bounded Hermes source-only task now targets those exact callsites using the
existing six-locale catalog and formatting contract. This does not claim the
source lane complete and does not change the separate browser/mobile, deployed,
migration/RLS or runtime evidence requirements.

# M581: F-89 mobile Relay localization lane

The mounted mobile `DashboardScreen` and `RelayScreen` still contain raw
language/delivery labels and host-locale date/count formatting despite the
existing persisted selector. A bounded Hermes source-only task now targets
those screens through the existing six-locale catalog. Native/browser,
deployed, migration/RLS and runtime evidence remain open.

# M582: strict Hermes ACK correlation

The desktop operator-formatting lane is not accepted because its Hermes ACK
reused the task WIRE as the reply WIRE. Codex issued a strict correction
receipt requiring a unique correlated ACK. No implementation or source
delivery is counted until that receipt is followed by a valid ACK and a
hash-verifiable DELIVERY; the five named operator surfaces remain open.

# M583: F-81/F-84 trusted vision evidence

The current source still omits thumbnail descriptors from publication-bound
recipe evidence because the local vision result is not yet carried as a
trusted, asset-bound receipt. A bounded Hermes source-only lane now targets
the existing vision/client/ToS/recipe path. Conversion attribution remains
explicitly unavailable without an authoritative provider field; no inferred
or synthetic conversion evidence is accepted.

# M584: operator ACK state correction

Hermes' corrected desktop operator-formatting reply fixed the prior WIRE
collision but still declared `STATE: OPEN`, which is invalid for an ACK under
the strict transport contract. Codex sent and validated a unique correlated
rejection receipt; remote SHA-256 is
`288a5433ab6ba1889a9dc3e13bcd8e6507f75ddf07023a18b6f0725c8b507a4f`.
The operator source lane remains open until a valid `ACCEPTED` or `READ` ACK
and then a hash-verifiable implementation delivery are received. This does
not alter the separate browser, mobile, deployed, provider or runtime gates.

# M585: F81/F84 source transport cleared

The F81/F84 vision lane's source-access block was cleared with an exact
tracked-source archive from commit `ac7961b9444fea4ec538e84c5980afca84e69ea6`.
The bridge archive checksum is
`92fffb7bf4d02352420ba3d7ece86411e41afa2bc590234c7f7577df18e92e11`, and the
protocol-valid resume task checksum is
`a9a099c041bb4429f6389f47aab4e925499ef34d6d6246ce6bb0e85bdb0ba1b9`.
This proves transport only; trusted thumbnail evidence, source tests,
integration, browser/mobile, provider and deployment gates remain open.

# M593: trusted vision evidence is source-wired

The F-81/F-84 source gate is now closed at commit
`81ef2069aae36256bed673c093ec5fbe16212cd6`. The local Rust vision receipt is
versioned and bounded, accepted only when it is un-overridden and sourced from
the Rust engine, then bound to the existing asset ID and SHA-256 before the
worker persists it on the ToS report. The publication snapshot and viral recipe
paths copy only validator-approved descriptors; malformed, fallback,
override, divergent and asset-mismatched values remain unknown. The owning
tests, typechecks, builds and lints pass. This closes source wiring only;
conversion/revenue attribution, runtime/provider/browser/mobile, migrations/RLS
and deployment acceptance remain open.

# M599: Audit surface localization

The mounted Audit page now consumes the shared six-locale catalog and the
server-locale UTC formatter. Chain validity, entry labels, empty and failure
states are localized, and raw backend error text is no longer rendered. Core
catalog tests passed 74/74; the dashboard suite, typecheck and lint passed with
only existing warnings. Approvals, playbook, agent-access and automation-rule
surfaces remain open for the same operator-formatting treatment.

# M601: mounted operator-page localization

The approvals/review, playbook, agent-access and automation-rule pages now use
the six launch catalogs and server-locale UTC formatting where they render
timestamps. Access, empty, unavailable, review-state and no-state-change copy
is localized; raw backend errors are not surfaced. Existing page behavior,
dashboard, typecheck and lint gates pass with only existing warnings. Child
component catalog adoption and browser/native acceptance remain open.

# M603: AgentPermissionManager localization

The reusable `AgentPermissionManager` is now connected to the typed six-locale
catalog rather than emitting English-only capability, tier, token lifecycle,
confirmation, validation and owner-boundary copy. Agent references, token
values and token timestamps remain unmodified data. Core catalog coverage,
focused mounted rendering and the full dashboard suite pass; source commit is
`f920eb07bfe09fabb2ecdd96fe862f862df09d7c`. This closes one reusable child
surface only; remaining raw child labels, browser/native, provider,
migration/RLS, runtime and deployment evidence remain open.

# M607: TriggerRuleManager localization

The reusable `TriggerRuleManager` now uses the typed six-locale catalog for
rule descriptions, metrics, action choices, empty/read-only states,
validation, confirmation, retry and mutation status. Rule names, provider
identifiers, thresholds and authored styles remain data, while last-fired
timestamps use the selected locale. Focused Spanish editable and German
read-only mounted-render coverage passes; the English control labels are not
emitted on those paths. Core 74/74, focused component 2/2, full dashboard
757/757, core build/lint, dashboard typecheck and diff checks pass. Dashboard
lint retains only the three pre-existing warnings in
`MediaBundleCreate.behavior.test.tsx`. Source commit is
`ea3ad70c33399edb8a8fc37dd76e04b9856ec661`. Browser/native, provider,
migration/RLS, runtime and deployment evidence remain open.

# M609: PlaybookGuidelineManager localization

The reusable `PlaybookGuidelineManager` now uses the typed six-locale catalog
for editor labels, revision state, placeholders, save/retry/error feedback,
restored-draft status and the owner-only boundary. Platform identifiers and
authored upsell strategy text remain data. Focused Spanish editable and German
read-only mounted-render coverage passes without the English save labels.
Core 74/74, focused component 2/2, full dashboard 759/759, core build/lint,
dashboard typecheck and diff checks pass. Dashboard lint retains only the
three pre-existing warnings in `MediaBundleCreate.behavior.test.tsx`. Source
commit is `ee4fceedabeb8308055cd7af260584e25f8d214b`. Browser/native, provider,
migration/RLS, runtime and deployment evidence remain open.

# M667: F-31 assigned-LLM inbox drafting source coverage

The local source now covers the previously open agentic inbox-drafting path.
`inbox-agent-draft.ts` verifies tenant/model access, active LLM shift,
`agent_permission.can_edit`, active exact Fanvue connection, roleplay handoff,
latest `soul.md`, bounded memory and bounded Grok output before creating a
pending LLM draft. Migration 0058 adds draft provenance, roleplay-turn linkage
and human approval state; the transition trigger prevents post-creation
identity/body/turn mutation. Replay is idempotent and scope/provider failures
are fail-closed.

The authenticated API mounts private draft generation and human approval. The
dashboard renders actor provenance and approval state, while `reply-dispatch`
requires the approving human before the existing explicit send action. No
automatic send or publish path exists. API drafting/inbox tests 28/28 and
dashboard tests 12/12 pass; full API is 1,097 passed/50 skipped, DB is
155 passed/17 skipped and the complete build passes. Migration/provider/
browser/mobile/deployed acceptance remains open; source commit
`7ff39ea66cc601c1c2e0659d5e2f36cdb942f3d5` is pushed to
`origin/codex/telegram-webhook-hardening`; no live action occurred.

# M669: F-89 Calendar localization source coverage

The model Calendar page now uses the shared server locale resolver for access,
navigation, empty/error, creator scheduling, post details and status copy. Its
visual board uses the selected locale for weekday/day labels and accessible
calendar-cell names, and its guarded date-move feedback is localized without
changing mutation or publication gates. The schedule form localizes action,
confirmation, retry and failure states. Advisory optimal-time windows are
catalog-backed and their scores use `Intl.NumberFormat` for the selected
locale. All six launch catalogs contain the Calendar key family.

Evidence: Calendar page/board/schedule/optimal-time tests 20/20, core tests
80/80, core build, dashboard typecheck and `git diff --check` pass. This is
source evidence only; browser/native-mobile rendering, remaining catalog
adoption, deployed migration/RLS/runtime and provider acceptance remain open.

# M586: F-89 mobile Relay localization integrated

The readable Hermes mobile delivery was independently audited and integrated at
source commit `94416816354926e2e0282420e360defa1a9655dd`. Mounted
`DashboardScreen` and `RelayScreen` now render their visible language,
delivery/status, empty/error/retry and locale-aware date/count states through
the shared six-locale catalog. Core catalog-completeness and mounted-screen
behavior tests are included. During review Codex corrected the mobile Vitest
root/env boundary so tests cannot load the repository deployment environment,
and removed contradictory empty-state copy from Relay error rendering.

Mobile 19/19, core 74/74 and dashboard 753/753 tests pass; mobile/core
typechecks and linters pass; mobile TypeScript plus Expo web export passes.
This closes only the source gate for this slice. Native/browser, deployed,
migration/RLS, provider and remaining dashboard/email/operator localization
acceptance remain open.

# M795: model team route-shell localization

The model-scoped Team & shifts page now resolves the persisted interface locale
through the shared server-locale helper. Its loaded title and unavailable/load-
failure states use typed catalog keys in English, Spanish, Japanese, Italian,
Brazilian Portuguese and German. The route still preserves owner-only model
assignment visibility, role-scoped edit capability and the existing team,
shift, handoff-note and Chatter operations; no backend contract or mutation
semantics changed.

Evidence: focused team route tests 7/7, core catalog tests 28/28, core and
dashboard typechecks, core build, changed-file ESLint and `git diff --check`
pass. Source commit is
`0b7d4b232d9f590e56a1e80013c79d5491b063a2`, read back from
`origin/codex/telegram-webhook-hardening`. This is source/UI evidence only;
multi-user browser/RLS, Grok/provider, migration, runtime and deployment
acceptance remain open.

# M797: variant-experiments route-shell localization

The model-scoped variant-experiments page now resolves the persisted interface
locale through the shared server-locale helper. Its loaded title and
unavailable/load-failure states use typed catalog keys in English, Spanish,
Japanese, Italian, Brazilian Portuguese and German. The route preserves
model-scoped edit capability and all existing experiment/candidate API and
mutation semantics.

Evidence: focused experiments route tests 2/2, core catalog tests 28/28, core
and dashboard typechecks, core build, changed-file ESLint and `git diff
--check` pass. Source commit is
`f8aaaff7464672234e78cd55043965def328d7e5`, read back from
`origin/codex/telegram-webhook-hardening`. This is source/UI evidence only;
browser/mobile, statistical validity, worker/provider, migration, runtime and
deployment acceptance remain open.

# M799: portfolio home-shell localization

The authenticated portfolio home now resolves the persisted interface locale
through the shared server-locale helper. Hero, setup, summary, empty/error,
roster, profile-status, direct-action and pagination copy use typed catalog keys
in English, Spanish, Japanese, Italian, Brazilian Portuguese and German.
Dynamic model names, handles, biographies and backend error data remain data;
existing listing, count, cursor and navigation behavior is preserved.

Evidence: existing home behavior tests 7/7, core catalog tests 28/28, core and
dashboard typechecks, core build, changed-file ESLint and `git diff --check`
pass. Source commit is
`4a3bb9e0511e83aff2781612a98436d08b8039ee`, read back from
`origin/codex/telegram-webhook-hardening`. This is source/UI evidence only;
browser/mobile, provider, migration, runtime and deployment acceptance remain
open.

# M818: F-89 media approval child-control localization

The remaining nested media approval controls now use the shared six-locale
catalog. `GenerationRetry` covers retry guidance, consent, reviewed-prompt
actions and bounded failures; `MediaPromptSuggestion` covers suggestion
consent, diff/review labels, character-lock context and provider failures; and
`MediaOperationControls` covers transform history, operation/status labels,
clip/resize/transcode controls, retry feedback and safety summaries. Existing
approval interlocks, role checks, idempotency keys, API payloads and raw
provider/user-authored data are unchanged.

Evidence: core catalog/completeness tests 34/34; dashboard focused media
approval tests 57/57; core/dashboard typechecks pass; core/dashboard lint
exits 0 with four pre-existing dashboard `any` warnings; dashboard production
build passes with explicit non-secret `API_ORIGIN`; `scripts/verify.sh`
prints `verify: ok`; source commit
`6ac4c8c0e965fba69d090366f302f9e4c216c9a1` is pushed and read back from
`origin/codex/telegram-webhook-hardening`. This closes only the source and
automated UI-localization slice. Browser/native, deployed media/runtime, R2,
provider, migration/RLS and production acceptance remain open. No live action
occurred.
