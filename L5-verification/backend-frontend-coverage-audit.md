# Backend-to-frontend coverage audit

Source baseline: `8c48f71df3bbfa8f2beb43f89c03332962a89f64`.

## Verdict and evidence boundary

FAIL: not all operator-facing backend capabilities are controllable through the dashboard. Existing navigation coverage is not feature coverage. This is a repository-static wiring audit, not a claim that every endpoint, provider or browser interaction was executed successfully. Live permission-matrix, mobile/desktop interaction and external-provider acceptance remain open. No live settings, accounts, jobs or publication state were changed for this audit.

Scope inspected: API route registrations and middleware in `packages/api/src/index.ts`; route declarations under `packages/api/src/routes`; LLM and Relay routes; dashboard page/component call sites and `lib/api.ts`; mobile endpoint/screen call sites; MCP manifest; Rust sidecar route declarations. The feature catalog and architecture remain the requirements, not the smaller set of existing pages.

Labels: **partial** means some controls exist but the family is incomplete; **absent** means no dashboard workflow was found in the inspected page/component/client inventory; **wired** means a source call path exists, not runtime acceptance; **internal** means a direct user button would be inappropriate, but its user-facing outcome still needs acceptance.

## Capability-family coverage

Backend paths below are relative to `/api/v1` unless noted. Evidence paths are relative to the repository root.

| Capability and backend evidence | Dashboard evidence / disposition | Result |
| --- | --- | --- |
| Models list/detail/create/PATCH/DELETE (`routes/models.ts`) | Home, `NewModelForm`, profile and `CharacterLockEditor`; general name/handle/bio/avatar editing, activation and deletion controls not found | Partial |
| Network metadata/health (`routes/network.ts`) | `NetworkForm` submits mode/address/expected IP; no full WG peer fields, live health action or failover editor | Partial |
| Encrypted egress credentials, config CRUD, bind/unbind/sync/status/health (`routes/egress.ts`) | No `/egress` control calls found. Network metadata save is not credential provisioning or binding | Absent |
| Social account list/connect/delete; Fanvue authorize/callback/refresh; Threads authorize/callback (`routes/social.ts`, `fanvue-auth.ts`, `threads-auth.ts`) | Network account table and approval account selector; no connect/disconnect/onboarding workflow | Partial |
| Fan contacts, timeline, touchpoint creation, custom-request create/status (`routes/fans.ts`) | Fans page reads two lists; no timeline/detail, contact creation, touchpoint or ticket mutation controls | Partial |
| Consent records/status/create/revoke (`routes/consent.ts`) | No vault page, status panel, creation or revoke controls | Absent |
| Calendar and post schedule/reschedule/cancel (`routes/posts.ts`) | Calendar reads month-filtered cards; approval can schedule, but existing-post PATCH/DELETE controls are absent; no drag/drop week/month view | Partial |
| Bundle list/detail/create/media/approve/revise/reject/video-review (`routes/bundles.ts`) | Approval controls, `BundleMedia`, `VideoReview`; creation also occurs through generation/upload. Arbitrary raw bundle creation does not need a duplicate UI. No general all-state media/history library | Partial |
| Generation, source-image selection, retry, prompt suggestion (`routes/generate.ts`) | `GenerateForm`, `GenerationProgress`, `GenerationRetry`, `SavedGenerationRetry`, `MediaPromptSuggestion` provide call paths | Wired; runtime acceptance incomplete |
| Image/video upload (`routes/media-upload.ts`) | `MediaUpload` exists; persistent source-media browsing and source-video library not found | Partial |
| Native link-in-bio CRUD/analytics (`routes/linkbio.ts`) | `LinkbioPanel` enables/disables native provider and edits links; analytics page call exists. External adapters explicitly unavailable | Wired native only |
| Analytics/viral exemplars (`routes/analytics.ts`, `viral.ts`) | Analytics page displays 30-day data and viral data; broader filtering/detail controls not established | Partial |
| Playbook score/read/record (`routes/playbook.ts`) | Score display exists; no guideline/cadence management UI. Recording computed evidence is not necessarily an operator action | Partial |
| Audit list/verify (`routes/audit.ts`) | Audit page calls both; source wiring present | Wired |
| Incident list/replay (`routes/incidents.ts`) | Incidents page plus `ReplayButton`; source wiring present | Wired |
| Crash report ingestion/list/resolve (`routes/crash-reports.ts`) | No dashboard crash triage/resolve workflow; incident jobs are not the same resource | Absent |
| Digest list/generate (`routes/digests.ts`) | No dashboard workflow. Native mobile has list/generate calls and controls | Absent on web; mobile partial parity |
| Org settings publishingEnabled/viralSharing (`routes/org-settings.ts`) | No dashboard settings workflow; mobile exposes viral sharing, not equivalent full administration | Absent on web |
| Kill switch read/enable/disable (`routes/killswitch.ts`) | Banner and `KillSwitchControl` exist; owner-only permission awareness remains a UI gap | Partial |
| Grok subscription status/login attempts/cancel (`llm-gateway/src/routes.ts`) | `GrokConnection` and `lib/grok-connection.ts` wired; credential presence correctly distinguished from generation access | Wired subset |
| Subscription disconnect and other provider login/status (`llm-gateway/src/routes.ts`) | Grok attempt cancellation is not subscription disconnect; no general provider onboarding/disconnect UI found | Partial |
| Grok R2 configuration read/write/delete (`llm-gateway/src/routes.ts`) | `GrokR2Storage` provides all three controls; saved state is not a successful storage round trip | Wired |
| Chat/tokenkiller/stream/providers/stats (`llm-gateway/src/routes.ts`) | Some consumption through generation; no generic chat/stats console. Internal chat primitives need not all become buttons | Internal / incomplete operator visibility |
| Relay card/command, webhook adapters (`relay/src/routes.ts`, API registration) | Dashboard approvals overlap some actions; no channel pairing/binding management UI found. Native Relay screen reads digests/crashes, not proof of full card lifecycle control | Partial |
| MCP analytics/inbox/generation/publishing/network tools (`mcp-server/src/manifest.ts`) | No agent grant/tier/token administration UI found; raw tool invocation is not required as a separate dashboard | Absent administration |
| Media transcode/resize/watermark/clip/video variants (`crates/media-plane/src/main.rs`) | Upload/ToS consume part of media infrastructure; no user watermark/crop/clip editor found. Sidecar routes alone do not establish full editing feature implementation | Partial / internal primitives |
| Social/competitor scraping (`crates/scraper/src/main.rs`) | No competitor-management/benchmarking workflow found; endpoint existence is not product completion | Absent workflow |
| Vision classification, hash, frames, encryption/decryption, telemetry, health, OAuth callbacks | Keep internal or service-authenticated; expose results/settings through scoped workflows, never raw secret/decrypt or arbitrary sidecar execution controls | Intentionally internal |

## Confirmed cross-cutting defects

1. **Permission-aware UI is incomplete.** API registration makes egress, network, kill switch and org settings owner-only. Network page catches load failure as `null` and still renders an editable form. Social account load failure is converted to an empty account list. An operator can see an apparently configurable surface that cannot succeed. Do not resolve this by removing backend authorization.
2. **Saving is not activation.** NetworkForm only calls the metadata PUT. Credential fields and plane bind/sync are separate backend contracts with no corresponding workflow. A successful metadata save cannot mean a tunnel is ready.
3. **Frontend parity differs by platform.** Native mobile has digest and sharing controls missing from the responsive website. Native mobile's endpoint wrappers do not prove every operation is rendered or permitted; mobile browsers use the dashboard, not Expo.
4. **Persistent media management is incomplete.** Bundle media preview and source-image selection exist, but neither constitutes a gallery for uploaded/generated image/video across all lifecycle states.
5. **The documented all-feature gate is not established.** `L5.0-test-matrix.md` promises an F-01..F-88 preservation check. Existing navigation tests establish reachability of existing pages, not presence and usability of every required feature.

## Required acceptance evidence before closing these findings

For every operator capability: name its architecture feature, mounted backend contract, permitted roles, reachable UI control, validated payload, visible success/error/empty states, persistence after reload, and desktop/mobile browser result. Test forbidden roles as well as allowed roles. Destructive operations need confirmation; retries must preserve user-intent idempotency; asynchronous operations need terminal status and reconciliation. Do not bypass safety gates or dispatch publication merely to satisfy coverage.

Remaining audit depth: complete field-by-field and role-by-role runtime execution; inspect all worker-only architectural features for missing orchestration rather than merely missing buttons; verify every F-01..F-88 requirement individually. This document is a coverage finding, not a new execution plan, and does not certify architecture completeness or production readiness.

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
