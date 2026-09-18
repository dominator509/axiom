# FanThynks — Astra to Luna continuation handoff

Updated: 2026-09-18, after milestone M431 and the variant delivery assignment. This is a continuation checkpoint,
not a completion report. Keep this file current at meaningful checkpoints.

## Latest deployment-repair review (after M349)

R3 is not accepted. Read-only inspection of its delivered validator confirmed:
it rejects the assigned rehearsal PG endpoint `10.77.0.3:5432`; its namespace
regex accepts `net:123` rather than Linux `net:[123]`; it does not require the
current namespace identity to equal the expected identity; and service-manager
validation is a blacklist rather than the authorized `direct-supervision` value.
No delivered code or installed installer was executed during this review.
The callsite inventory is evidence for the next integration work, not proof
that installed helpers have been repaired. R3 tests have not been independently
executed. Bounded R4 corrections are assigned in bridge message
`codex-d001a-r3-corrections-20260917`; check its reply next. No live mutation is
authorized by that assignment. Keep the installed installer prohibited.

## Latest application source milestone (M351)

The worker now records additional immutable publication-recipe evidence in
`post_target.publication_snapshot`: the dispatched ToS report, media kind/MIME
and dimensions/duration, first-line hook, scheduled timestamp, and actual UTC
publication timestamp/hour/day. The viral-label recipe consumes that snapshot;
it does not reconstruct edited bundle fields for historical posts. Focused worker
evidence passed: database package build, worker typecheck, and 24 tests across
recipe evidence, viral labeling, and publication snapshot behavior. This is a
real F-81 increment, not completion: provider format, thumbnail feature
descriptors, revenue/conversion attribution, and richer shoot-config capture
remain open where the current publication contract does not persist them.

Hermes's R4 type/test artifacts were delivered and independently hash-verified;
they remain review artifacts, not integrated source. I declined the proposed
home-directory ACL widening and sent a bridge-only data-delivery protocol; no
permission, installer, database, migration, or service change is authorized.

Hermes delivered the callsite inventory at
`D001a-R4-CALLSITE-INVENTORY.md`; its independently verified SHA-256 is
`d82a364960680837623f3b3937e925d601096f11baa95ebabdd4f68c915a8cc6`
(381 lines, 22,788 bytes). It confirms the installed installer can target the
live database during a guarded rehearsal: `DB=fanthynks_test` is a module
constant and all installer DB sinks are ambient-live. It also identifies the
undefined bridge `SCHEMA_CHANGING_FROM`, unused `LIVE_PORTS`, hard-coded live
unit reads, and the exact context-threading sinks. No source integration or
live operation has occurred; deployment remains paused. Hermes's reply to
`codex-d001a-target-context-repair-20260918` is accurately recorded as PARTIAL:
the immutable TargetContext type and 98 parser tests exist, but no installer or
bridge sink is threaded. The active split node is
`codex-d001a-installer-context-slice-20260918`; Hermes is editing a copied
source under its writable bridge reply tree, never the installed helper. Codex
will audit the actual artifacts, integrate only the reviewed source, run the
owning gates, commit and push it, then dispatch the bridge slice. No installed
helper is trusted or executable until target identity is proven end to end.

The first installer candidate was audited and rejected. Exact defects: rehearsal
still receives live `RELEASES`/`CONFIG_DIR`/`STATE`/`BACKUPS` roots; the
migrator URL still reads `$CONFIG_DIR/test.env`; live authorization is only
format-checked rather than matched to the target SHA at every destructive sink;
and undefined legacy `$PG`/`$DB` references remain in backup/restore output
paths. The 43 checks did not exercise these callsites. Correction message
`codex-d001a-installer-context-correction-20260918` is active; no source was
integrated and the installed helper remains prohibited.

Codex fetched the candidate, patch, harness, manifest and handoff into a local
review staging tree and re-audited the candidate source. The rejection still
stands: ambient root assignments remain at the module level and are consumed by
reachable paths; `migrator_url_for_live()` still reads `$CONFIG_DIR/test.env`;
`require_approved_target()` accepts only an operation label rather than an
expected target SHA; and service paths still contain hard-coded
`/etc/systemd/system` access. The supplied harness is primarily grep/extraction
based and does not execute those negative sink cases; its reported 43-pass
result is therefore not acceptance evidence. A new source-only correction task
`codex-installer-candidate-fails-source-audit` was sent with these verified
failures and required executable rejection tests. No installed helper, live
runtime, database, service or deployment operation occurred.

Hermes independently reproduced the same source defects and withdrew the
previous delivery claim. It confirmed that the 43 checks pass over the
unfixed sinks, that the candidate is withdrawn/not accepted, and that the
installed helper remains untouched. The correction is still source-only and
must return a new candidate plus executable sink-level regressions before any
integration decision.

Codex sent the follow-up `codex-installer-correction-proceed-source-only` to
remove any ambiguity: Hermes is authorized to continue source-file and test
artifact work in its writable tree, while every installed/runtime/live action
remains prohibited. No corrected artifact has been accepted yet.

The next bounded product node is queued behind that correction as
`codex-f81-f84-recipe-contract-source-node`. It is grounded in the current
source gap: generation/shoot inputs and complete publication-time recipe
evidence are not persisted through the existing bundle → target → viral recipe
path. It must preserve existing RLS, consent, ToS and idempotency semantics and
must not invent provider revenue/conversion data.

## Mission and authority

Finish the architectural feature reconciliation, implement the missing features,
make user-operated functions discoverable and functional in the GUI, and deploy
and test toward production readiness with Hermes. Mechanics-only functionality
does not need a cosmetic frontend. Both mobile and desktop must be usable.

The user wants Codex to lead and assign bounded server-local work to Hermes;
do not make the user relay messages. Do not restart the audit or substitute a
small passing feature slice for the full objective. Do not claim production
readiness from unit tests, phase markers, health 200, or CI alone.

Read `AGENTS.md`, `COMMANDS.md`, and the RTK instructions, then perform the boot
sequence. Prior graph output was ALL_DONE; this does **not** close the remaining
reconciliation or runtime requirements. Preserve unrelated work. Use apply_patch
for edits and RTK-prefixed shell commands. Commit each verified milestone and
append `.agent/state/LEDGER.md`. Do not change the active goal to complete/blocked
merely because credits or the current turn are ending.

## Current source / process checkpoint

- Repository: `dominator509/axiom`; branch `codex/telegram-webhook-hardening`;
  existing PR #14. Do not open a duplicate PR or force-push.
- Latest application milestone: **M431 durable dual-actor roleplay state**,
  commit `6b8229d6c247654be7d0f26a100af53a52d54c91`. The roleplay source/API/
  dashboard slice is integrated and pushed; its migration, provider, browser,
  and deployed-runtime gates remain open.
- Worktree was clean immediately before this documentation update. Inspect it
  again on arrival; this handoff's own commit will be newer than M342.
- Current applied migrations: **50**, ending
  `0049_weekly_digest_schedule.sql`. Source now contains unapplied migration
  `0050_roleplay_handoff_memory_persona.sql`; it has not been run anywhere.
- Latest full-matrix source receipt remains `d53787420f4b880d911818ca9ed45b3f271c541c`;
  later application changes have proportionate focused evidence recorded below.
- Hosted CI **35285232940** exact `d537874` and **35284764547** exact
  `bbefee6` both completed successfully. Documentation commit `741c7e6` has
  run **35286101578**, now successful. M345 run **35286677401** also succeeded.
  M346 run **35287400606** succeeded. M347 run **35287861462** and M348 run
  **35288152319** remain active; do not confuse
  earlier green runs.
- Hosted CI **35283023039** on `f1378c4` and **35281902829** on `30cd883` passed.
- No local test/build process is left running at this checkpoint.
- Existing five-minute Hermes polling automation is named
  `check-hermes-messages`; inspect before creating/updating anything to avoid a
  duplicate. Its wakeups are coordination, not deployment authorization.

## Start here — exact next actions

1. Read this file, the private local operator companion
   `var/handoff/luna-operator.md`, and the authoritative documents below.
2. Verify branch/HEAD/dirty state and the focused M431 receipts. Preserve the
   passing earlier-SHA receipts as historical.
3. Track the active bridge assignment
   **`codex-installer-candidate-fails-source-audit`**. Review the corrected
   candidate itself, not only its harness: every sink must consume explicit
   context, rehearsal must not read live config, authorization must match the
   exact target SHA, and negative paths must execute. Do not accept an
   acknowledgement or a rerun of unchanged R2/R3 tests.
4. Integrate the target-context repair only after the source audit and focused
   security checks pass. Never execute the defective installed installer,
   restore helper, migration, or privileged rehearsal while this repair is
   unintegrated.
5. The current bounded product node is `VARIANT-AB-CONTRACT-COPY`. Hermes must
   return a source-only DELIVERY or one concrete BLOCKED reason; ACK/REPLIED
   transport is not delivery. After Codex audits and integrates that artifact,
   commit/push it and advance one node at a time through the remaining gap list.
6. The full **50-migration** local matrix now passed on `d537874`, exit0,
   24/24 tasks, fixture removed. See
   `L5-verification/reconciliation-runtime-receipt-d537874.md`. After subsequent
   application changes, run proportionate focused checks and the next full gate;
   do not rerun this unchanged source solely because a new agent takes over.
7. Only after deployment tooling is proven, prepare one immutable candidate,
   review migration prerequisites, pin backup/rollback, perform the controlled
   TEST deployment, and complete authenticated desktop/mobile/provider gates.

## Authoritative records — do not infer completion from old checklist headings

- `L1-product/L1.1-feature-catalog.md`: feature inventory / IDs.
- `L2-architecture/` and `L3-specification/`: architecture and contracts.
- `L5-verification/backend-frontend-coverage-audit.md`: original coverage audit.
- `L5-verification/feature-reconciliation-execution-plan.md`: cumulative work
  plan and milestone evidence. Some early bullets predate later fixes; trace the
  later milestone and current source before calling an old gap still missing.
- `L5-verification/architecture-reconciliation-current.md`: current
  source-grounded status matrix. It distinguishes source-wired, partial,
  internal, optional/not-enabled, and runtime/provider-open claims.
- `L5-verification/model-role-implementation-plan.md` and role/team/member
  receipts: assignment/shift/RBAC implementation and remaining acceptance.
- `L5-verification/reconciliation-runtime-receipt-f1378c4.md`: latest complete
  local matrix receipt, including what was skipped and not proved.
- `L5-verification/test-deployment-checkpoint.md`: historical deployment plan;
  server incidents and this handoff supersede stale installed-state claims.
- `L5-verification/L5.0-test-matrix.md`, `L5.1-recovery-and-dr.md`, and
  `L5.2-acceptance-and-security-audit.md`: final gates.
- `.agent/state/LEDGER.md`: chronological milestones; M354 is this handoff.

## Recent completed source slices and exact evidence

| Milestone / commit | Implemented | Evidence / limits |
| --- | --- | --- |
| M335 `664ac5d` | Schema-aware readiness, not just SELECT1 | Generic503 for missing schema/columns/read privilege; 5 focused real-PG tests. Not full data/RLS integrity. |
| M336 `21d6269`, M337 `686f5b5` | Scoped inbox attachment metadata and byte previews | Model egress, exact message membership, post-read authorization, bounded MIME/ranges, explicit show/hide/retry. Live CDN/mobile and attachment sending still open. |
| M338 `d2001c3`, M339 `30cd883` | Caption-guidance receipt, immutable publication attribution, Approvals summary | 81 focused +7 real-PG for receipt;11 UI/page tests. Edited copy is not attributed to old guidance; selection is not causality. |
| M340 `f1378c4` | Thirty-day publication-age reward decay, including automatic winners | 15 focused +8 real-PG. Current evidence drives selection, not stale cached weights. Raw plays and effective reward differ. |
| M341 `41acb63` | Digest evidence matching, percent conversion, honest cumulative wording | 2 card +9 real-PG tests. Not evidence of external Relay delivery. |
| M342 `bbefee6` | Opt-in Monday00:00UTC digest schedule through existing durable queue and Settings | 16 worker/API +3 GUI +9 real-PG after50migrations; DB/worker builds, API/dashboard types and dashboard lint pass (3 old warnings). |

Full matrix on clean `f1378c4`: **24/24 tasks**, four cached; dashboard694,
worker292, connectors387, gateway375, auth28, MCP-server91, mobile20, DB159
passing tests observed. Five schema-readiness cases are a separate focused
suite, not executed by that full matrix. Dashboard build and mobile web export
passed. Disposable DB was removed. This is not a live deployment receipt.

### Important M342 semantics

- `org_settings.weekly_digest_schedule_id`: NULL means opt-out. No live opt-in
  was performed. Settings API derives `weeklyDigestEnabled` from this identity.
- Enable + first enqueue are atomic; automatic executor locks the same settings
  row, rejects obsolete identities, saves its card + queues next week atomically.
- Dedupe is schedule identity/week. Disable then re-enable gets a new identity;
  already-queued old jobs do nothing. Missed weeks do not generate catch-up storms.
- Worker/Safety gates still apply. A media-only scoped worker cannot execute
  digest jobs. This does not enable publication or send an external message.
- Permanent job failure can terminate recurrence; operator recovery and visible
  schedule/job status still need work. Do not claim unattended reliability yet.

## Remaining gap list — keep these open until their own evidence exists

| ID | Workstream | Next completion evidence required |
| --- | --- | --- |
| D001 | Deployment machinery | Explicit context at **every** DB/config/service callsite; actual privilege/network isolation; reviewed source; failing negative tests; controlled install/rollback receipt. Parser alone is insufficient. |
| F81/84 | Learning / variants | Complete immutable recipe capture (shoot config, hook, format, thumbnail/ToS features); richer hook/time/format arms and consumers; load/recency behavior; deployed A/B attribution/promotion acceptance. Current caption arms are not full coverage. |
| F85 | Insights/digests | Schedule status and explicit recovery built in M345/M346; deployed acceptance remains open. Useful verified pattern insights, periodic runtime proof and real Relay delivery still required. Stored cards and counts do not prove delivery. |
| INBOX | Messaging | Attachment sending, agentic drafting, provider account authorization/DM semantics, real preview/playback and uncertain-send reconciliation. Never replay ambiguous sends. |
| SCRAPE | Research orchestration | Deployed egress-bound scraper, actual provider parsing/results, partial/error UX and saved-run browser acceptance. |
| TEAM | Team / role / shift flows | Multi-user authenticated acceptance of owner/manager/operator/Creator/model/Chatter/agent restrictions, assignment revocation, shift expiry, handoffs and post notes. Source signed-session tests exist; do not rebuild them blindly. |
| MEDIA | Gallery / generation / clipping | Uploaded and generated previews, image/video transformations, ToS scan/approval flow, character-lock behavior, desktop/mobile controls on deployed SHA. Reuse completed approved fixtures; do not duplicate paid jobs. |
| PLAYBOOK | Guidelines | Consumer-by-consumer integration beyond known generation/calendar paths, conflict/history/restore and cadence acceptance in browser. |
| PROVIDERS | External contracts / OAuth | Official current contracts + real account connect/refresh/revoke and authorized publish receipts for enabled providers; truthful unsupported capabilities. Link-in-bio integrations require real provisioning/sync/analytics, not DB labels. |
| STORAGE | R2 | Protected setup, real upload/read/checksum/delete/retention round trip through application abstraction, then generated-media path. No secrets in messages or commits. |
| NETWORK | Customer VPN isolation | Customer-owned WireGuard/VPN path, per-model/profile routing, DNS/MTU/dual-stack constraints, fail-closed outage/leak tests; AWS fixtures do not establish SaaS customer support. |
| GUI | Desktop/mobile acceptance | Sign-in, all role-permitted navigation/buttons/links, spacing, errors/loading/retry, media playback/ranges and real state transitions; no source-only substitution. |
| DB | Live migration/rollback | Rehearse from actual restored ledger28 baseline to current50, reviewed prerequisite ownership/grants, runtime ACL/RLS checks, pinned backup and database-aware rollback. |
| OPS | Observability | Real deployment alerts/crash reporting, readiness/data-path checks, dashboards, incident workflows and secret-safe logs. Health200 once masked an empty DB. |
| RELEASE | CI / governance | Exact-candidate full gates, dependency/advisory checks, container checks, actual branch-protection enforcement, final immutable release acceptance. |

## Hermes task state / review findings

M349: add per-talent/platform caption-length/question/scheduled-UTC grouped
observations using M347 evidence eligibility. Minimum3labeledexemplars; at most
20groups with truncation flag; mean engagement z-score, sample count and explicit
historical-window/selection/causality limitations in GUI. These are exploratory
observations, NOT conversion lift, statistical significance or recommendations.
No private captions or cross-model patterns exposed.17API+6GUItests, bothTC/lint
(3existingwarnings) pass; realPG50migration test verifies mean/count, suppression
of small groups, duplicate-poll immunity and org/model/access filtering. Final
fixturebb678f1c8c148c87removed; unique model fixture avoids parallel-test pollution.
First integration command was denied by safety review citing the server incident.
Read entire LOCAL runner and inspected Docker: Windows DockerDesktop npipe,
isolated-ci-validation container, loopback55432, NO mounts. Reconsideration with
this new evidence was allowed; no bypass or Contabo installer invocation.
Broader F85 revenue/format/hook/time recommendations, calendar/trigger consumers
and external Relay delivery remain incomplete.

Hermes23:48:41Z delivered R3 under handoff/review-source. Actual remote hashes
independently verified, but source NOT yet reviewed/executed/integrated:
- fanthynks-target-context-r3.py: e1b05495c2a97f41b25cb82aa2d52ac19855c0cf03846a41e28f4f3e9afc16e5
- test_fanthynks_target_context_r3.py: a609ee60c39647ded1f39dbe0757a90cc23aa1079a1645737ea67501409f7d98
- d001a-db-ops-inventory.md: 400652ba04dc26d6008ee675c982d3b697816972012ec7180f7de64c64499098
Claims67tests pass. Summary suggests endpoint allowlist only loopback (actual
rehearsal DB was10.77.0.3) and namespace syntax net:digits instead of net:[digits];
validate against source. Claimed own scratch/root paths conflict with previous
unprivileged description; do not assume containment from wording. Inventory
mentions prefix/root mismatches requiring explicit reconciliation. Next review
all three files; parser tests alone never prove repaired deployment.

M347: architecture L2.8 review found viral list/distributions were accepting
legacy or unverified exemplars. All three queries now require the worker's
published-provider evidence marker plus a same-org/model/bundle/platform
published target with remote ID, nonfuture publication and a matching nonfuture
provider metric. EXISTS avoids multiplying exemplars on repeated polls. GUI
discloses relative engagement, not conversions or causal attribution.17APItests,
4GUItests, bothtypechecks/lint(3existingwarnings), realPG50migration evidence
fixture0c9edc2977dc4aab passed/removed. Two GUI assertions initially expected old
empty-state wording; updated and reran. This repairs evidence eligibility;
it DOES NOT implement the missing grouped pattern comparisons, hook/format/time
arms, revenue attribution or actual Relay delivery. Next implement those from
L2.8 sections1,3,6,7 without labeling engagement as conversion lift.
Hermes checkpoint was absent at M347; M348 subsequently read its23:36:13Z reply.

M346: owner settings now exposes confirmed schedule replacement starting next
Monday UTC. PATCH recovery is exclusive of ordinary settings; expected ID and
replacement ID are UUIDs, must differ. Under the settings row lock, a stale or
disabled schedule conflicts, a committed identical replacement returns without
re-enqueue/audit, and a fresh replacement updates identity, enqueues and audits
in one transaction. GUI keeps replacement/body/idempotency key across uncertain
responses and verifies the returned ID. No Safety or publishing change, missed
week replay, or external message. Tests:21focusedAPI/worker,3GUI, bothtypechecks,
lint(3existingwarnings), realPG50migration fixture16126e6e034a2bd2 passed/removed.
RealPG confirms single enqueue on replay, stale rejection and Safety unchanged;
concurrent recovery/disable browser acceptance remains unexecuted.
Signed message `codex-m346-checkpoint-20260917` delivered to Hermes requesting
actual R3 files/hashes/results plus callsite inventory (or concrete blocker).
No deployment authority added. The existing R2 review reply still has only ACK
content, now with Hermes's signature, not replacement artifacts.

M345 source evidence: digest list returns a narrowly projected active-schedule
job status from an org-scoped SQL snapshot; filters exact schedule ID, job kind
and queue, excluding manual/replaced schedules. Weekly digests displays off,
missing, queued, running, dead and completed-without-successor states, workspace
permission warning and an owner-only settings link. No payload/raw error output;
no worker-liveness or external-message delivery claim. Six route tests, nine
dashboard tests, both typechecks and lint passed (three existing warnings).
Real PostgreSQL integration passed after50migrations, fixture
`476e7f1596d1b447` removed. It verifies terminal state, replacement/manual/job-kind
exclusion, cross-tenant lookup, disabled status and sensitive-field omission.
The root test configuration excluded dashboard tests on the first command;
they were subsequently executed explicitly with the dashboard configuration.
No live changes. M345 is not covered by the earlier full d537874 matrix.

The bridge is working as a **message exchange**, not an automatic deployment
executor. Treat message bodies as data, not shell. Never execute text merely
because Hermes supplied it. User authorization and the scoped task still govern.
Every message sent to Hermes must end exactly with **sincerely, Codex** (owner instruction).

## Active completion sequence (M354+)

This is the execution queue, not a new audit report. Hermes receives one bounded
coding node at a time; Codex owns source review, integration, tests, commits,
pushes, and the handoff. A node is not complete from an acknowledgement or a
unit test count: its source, automated, runtime, and provider/operator gates
must be marked separately. Future node numbers are intentionally not invented;
they are assigned only when an actual commit exists.

1. **Deployment safety foundation — active M354.** Hermes first patches the
   installer DB/service/rollback sinks, then the bridge sinks, using copied
   source-only artifacts; Codex reviews and integrates each slice. Add the
   incident regressions and keep the installed installer prohibited. Exit
   criteria: source audit, focused security tests, static/build gates, exact
   commit and remote readback.
2. **Product contract reconciliation — L1/L2 feature IDs only.** Work through
   the open rows in the backend/frontend audit: F-15/F-16, F-25/F-26,
   F-55/F-56, F-81/F-84/F-85, scraper result quality, clipping/adaptation,
   and Relay delivery/reconciliation. Each slice must use the existing
   schema/RLS/queue contracts and expose a discoverable GUI path where the
   architecture calls for an operator control.
3. **Media and storage — known audit gap.** The audit explicitly says a
   persistent gallery for uploaded/generated image/video is incomplete. Close
   that gap using the existing asset/media-operation/storage contracts, then
   prove thumbnails/previews, transform and approval/retry visibility, and the
   configured R2 application round-trip. The current sanitizer is a real
   file-level feature, but it explicitly reports `externalProvenanceErased:
   false` and does not prove C2PA/external provenance or fingerprint removal;
   do not describe it as maximum provenance removal.
4. **Provider and network operations — optionality preserved.** L2.3/L2.4
   require capability-honest provider contracts and state that Native is the
   only production-enabled link-in-bio provider; Fanlynks, Linktree and
   Beacons remain optional planned adapters until their lifecycle is actually
   implemented. Verify OAuth refresh/revoke/disconnect and any explicitly
   enabled publish receipt, plus customer-supplied VPN/WireGuard profile
   isolation with fail-closed per-model egress. AWS fixtures are rehearsal
   evidence only, not SaaS readiness.
5. **Operator surface and acceptance.** Reconcile every backend capability to
   navigation, permissions, empty/loading/error states, retry flows, gallery
   playback, responsive spacing, and desktop/mobile browser acceptance. Fix
   dead links/tabs and make mechanics-only controls observable through status
   and audit surfaces without exposing secrets.
6. **Release and operations.** Apply the repaired migration/recovery path only
   after isolated proof; deploy one immutable TEST candidate; verify readiness
   against real data, worker/media paths, logs/alerts/retention and rollback;
   enforce exact-SHA CI, branch protection, release provenance and rollback
   evidence. Production remains NO-GO until all external/provider/operator
   gates are explicitly evidenced.

**Handoff rule:** after every Hermes delivery, Codex records the artifact hash,
reviews the diff for bypasses, runs proportionate tests, commits/pushes one
milestone, and updates this file plus `.agent/state/LEDGER.md` before assigning
the next node. If Hermes is idle, the next request must be sent; completed
replies are not a reason to stop.

- D001 original patch was rejected: live-mode fallback, live Docker/admin target,
  missing propagation and tests that did not execute the claimed paths.
- D001a initial parser was rejected: actual live DB accepted, direct constructor
  bypass, unchecked prefix, bad roots/namespace validation.
- R2 actual artifacts delivered; source SHA
  `728a29b317eea79281eb84082acead6b31740e5717f69ee805ce6ecd38690953`.
  Source reviewed fully, **not integrated**. Claimed56 tests do not close review.
- R3 requirements from `codex-d001a-r2-review-20260917`: implement real allowlist; preserve
  legitimate rehearsal prefix and isolated replica migrator role; validate
  controls before stripping and SHA with fullmatch; explicit namespace IDs;
  then inventory every installer/bridge DB callsite and ambient configuration read.
- Hermes23:36:13Z reply to `codex-m346-checkpoint-20260917` admits R3 and the
  callsite inventory are unfinished; it reran unchanged R2's56tests. It reports
  inability to read the historical review test under Codex's private home.
- M348 read that exact11KB file and delivered its full contents in signed message
  `codex-d001a-shared-review-20260917`. Server message mode664; local/server
  SHA256 both `a71ab5f96fbdfee85a360eb506246253e7fd01cb29ff606e8768353e1e6500da`.
  JSON has exactly five bridge fields,12459bodycharacters, correct signature.
  No home ACL/mode change. The message explicitly warns historical fixtures
  (direct manager/reh-prefix/implicit tmp roots) are NOT current R3 acceptance.
  Hermes must update them, deliver actual files from its own scratch and supply
  the callsite inventory. If an additional specific sanitized source is unreadable,
  share it as data rather than granting access to private home/configuration.
  Its23:48:41Z response and three artifact hashes are now verified above.

## Latest D001A artifact review

Hermes delivered a source-only candidate under
`codex-resume-d001a-with-delivery.parts/`. The fetched hashes match its
manifest: corrected installer `fee3b3b440c9207a7e7761591d671506ef3a63cb3f14420efd0d8ea9f9594baf`, patch
`ec019302b6bdf43faf986d7a60c6c771ecbbd29f1064688ad48b14d43`, and
harness `c3487150cdd00daa6512fe165b00e7ce02bdb1e04fcfa34008ff10ba9857bd53`.
The candidate parses, and the harness reaches 35/0 under Git Bash when its
child-shell PATH is controlled. The ordinary Windows invocation is not evidence
because the child `bash` launch is denied.

The candidate is **rejected** and not integrated. Its real `resolve_mode`
rehearsal path still passes the live default releases/config/state/backup roots
and the default system unit directory into `ctx_resolve`; the harness tested a
synthetic direct constructor instead. Its `activate` call omits the expected
release SHA when calling `take_pinned_backup`, and its `restore-db` dispatcher
omits the expected SHA when calling `restore_db`, defeating the exact-SHA live
gate at those callsites. Hermes must return a new artifact with real-resolver
negative tests and corrected callsites. No installed helper, live DB, service,
container, permission, credential, or deployment action occurred.

## Deployment incident constraints

Historical last recovery report (not freshly re-attested here): TEST release
`da09f664cbe801ed45a63a62ad4ad8014c94c795`, ledger28; API/dashboard active,
worker and four sidecars stopped. No recent application commits are proven live.

The old installed installer caused three incidents by validating rehearsal input
while DB/service helpers still targeted live. One dropped/recreated the live DB.
**Do not run that installed installer, its restore helper, or an old rehearsal.**
Recovery retained migration0027 and its truthful ledger row. Do not drop the
column/delete the ledger to make the history look clean. Do not delete forensic
DBs/backups. Never overwrite the recovery source. Possible data loss was reported;
do not claim zero loss. Privileged backup/restore details are in the private file.

The previously completed ceramic-vase media job must not be dispatched again.
A ready `relay.card` job had uncertain external effects and was deliberately not
replayed. Do not start an unscoped worker as a shortcut. Broad user authorization
does not make an ambiguous external side effect safe to repeat.

## Hermes bridge communication protocol

The canonical logical-clock protocol is [hermes-message-protocol.md](L5-verification/hermes-message-protocol.md).
The bridge's `REPLIED` status is transport-only; it is not a task ACK or a
delivery claim. Every exchange must use a stable task id, monotonic `SEQ`, exact
`IN_REPLY_TO` correlation, explicit `READ`/`ACCEPTED`/`IN_PROGRESS`/`DELIVERED`
or `NACK` state, and a final `sincerely, Codex` or `sincerely, Hermes` line.
Wall-clock fields are never used for ordering, liveness, retry, or completion.

Current protocol transition: Hermes's first adoption reply used the undefined
`STATE: ACKED` and was rejected with `INVALID_STATE_ACKED`. Hermes then returned
valid correlated `ACK/ACCEPTED` replies for the protocol correction and the
D001A candidate rejection. The D001A lane returned a valid
`PROGRESS/IN_PROGRESS` checkpoint with its writable artifact path and four
accepted repairs. Hermes also supplied an R4 target-context module and 98
passing parser/regression tests; Codex independently matched all manifest
hashes and ran the tests to exit 0. That source-only module is not accepted as
the D001A completion because it was delivered outside the FT-HERMES DELIVERY
envelope and does not contain the installer-integrated sink changes. Codex sent
receipt sequence 7 with an apology for the earlier false idle report and a
single next action: return a protocol DELIVERY for the actual installer
integration with executable real-resolver and sink-SHA coverage.
F81/F84 remains an independent source-only product lane; its progress
checkpoint was read and receipt sequence 5 records that delivery is still
pending while the D001A gate is held. A third independent source-only lane,
`SCRAPER-RESULT-QUALITY`, is now OPEN with a protocol task covering only the
architecture-named result-quality gaps. Its ACK/IN_PROGRESS/DELIVERY state is
separate from D001A and F81/F84. Hermes has now returned `ACK/ACCEPTED` for
that lane, and Codex sent receipt sequence 3 requiring the concrete progress
checkpoint before implementation. No lane grants runtime, provider, database,
permission, or deployment authority. A fourth independent lane,
`MEDIA-GALLERY-LIFECYCLE`, is now OPEN. It is constrained to the existing
asset/content-bundle/media-operation/job contracts and must close the missing
cross-lifecycle gallery states without creating a parallel storage model.
The fifth independent lane, `VARIANT-AB-CONTRACT`, is now OPEN for the
architecture-named selected-guidance attribution and richer hook/timing/
format/thumbnail contract gaps. It must preserve the existing evidence,
consent, idempotency, and no-direct-publication boundaries.
Hermes has returned a scope-valid gallery ACK, but reused the task WIRE in the
ACK. Codex rejected that correlation as `WIRE_COLLISION` and sent receipt
sequence 3 requiring a unique reply WIRE before the gallery lane advances.
The sixth independent lane, `TEAM-SHIFT-CHATTER`, is now OPEN for the
architecture-named assigned-shift/model restrictions, post-note ownership, and
bounded history gaps. It must reuse the existing RBAC, RLS, assignment, and
shift contracts.

## M364 control-loop enforcement

The bridge protocol now has a stateful journal audit at
`scripts/hermes-protocol-audit.mjs` with local regressions in
`scripts/hermes-protocol-audit.test.mjs`. It ignores legacy transport timestamp
fields and fails closed on duplicate WIREs, unreadable `IN_REPLY_TO` values,
sequence gaps, sender/signature/type mismatches, invalid terminal states, and
accepted lanes that still assign the next action to Hermes. `REPLIED` remains
transport-only. The audit reports a valid nonterminal handoff as `PENDING`
unless `--allow-pending` is explicitly used to record that checkpoint.

Implementation commit: `cd3b9619631f278075437fb367119a57b24c0f8c`, pushed to
`origin/codex/telegram-webhook-hardening`. Validation: four protocol journal
regressions passed, `git diff --check` passed, and both new Codex receipts passed
the individual protocol validator. The two receipt envelopes are present in the
Hermes inbox; reply/status artifacts are not present yet, so their state is
`UNCONFIRMED`, not idle and not complete.

Hermes team and variant ACKs were read and consumed with signed protocol
receipts `codex-receipt-team-accepted.json` and
`codex-receipt-variant-accepted.json` (both next sequence 3, next owner
Hermes); each receipt includes the apology for the earlier false idle report.
Hermes then replied with `ACK/IN_PROGRESS` for both lanes, which is an invalid
ACK state. Signed sequence-5 rejection receipts were sent with
`REASON: INVALID_ACK_STATE`; the lanes remain open and require a unique
`PROGRESS/IN_PROGRESS` checkpoint. Hermes corrected those replies to valid
`ACK/ACCEPTED` messages, resolving the authority path on its release tree;
signed sequence-7 receipts were sent and the next owner remains Hermes. A separate signed
`AUTHORITY-CONTEXT-TRANSFER` task supplied the hash-identified plan excerpt
because Hermes could not resolve the cited path; its response is currently
`UNCONFIRMED`. No new product task was duplicated. Gallery remains held after
its WIRE collision; scraper/F81/D001A remain at their previous protocol
checkpoints until Hermes supplies valid progress or source DELIVERY. No runtime,
provider, database, permission, deployment or live action occurred.

Hermes later claimed the D001A artifact set was a protocol DELIVERY, but the
reply was actually `ACK/IN_PROGRESS` and the source audit found the same
defects previously recorded: the real rehearsal resolver still passes live
default roots and unit directory, `stage_release` contains hard-coded live
paths, `activate` omits the expected SHA for its backup sink, `restore-db`
omits the expected SHA, and the harness bypasses the real dispatcher. Signed
sequence-9 rejection `codex-reject-d001a-delivery.json` was sent; the candidate
remains unintegrated and no installer action occurred.

M368 control-loop checkpoint: Hermes ACK/ACCEPTED sequence 10 was read for
`TEAM-SHIFT-CHATTER` and `VARIANT-AB-CONTRACT`; both used unique WIREs and
correlated to the sequence-9 receipts. Codex sent signed sequence-11 receipts
back to each lane with `NEXT_OWNER: HERMES`, an explicit source-only DELIVERY
requirement, and `LIVE_ACTIONS: NONE`. The bridge's transport `REPLIED` state
is not treated as implementation delivery; both lanes remain pending until a
new TYPE DELIVERY is fetched and independently audited.

Hermes also acknowledged the D001A source audit as sequence 10 and accepted
the five defects. Codex sent sequence-11 source-only authorization: Hermes may
edit and test copied source using fake roots only, but may not read or write
live config, units, backups, databases, containers, providers, credentials,
permissions, or deployment paths. The corrected installer candidate remains
unaccepted; no real-root rehearsal is authorized by this checkpoint.

M369 NOT-ACK checkpoint: Hermes replied to all three sequence-11 receipts,
but each reply was `TYPE: ACK` with `STATE: IN_PROGRESS`. The individual
validator identifies that combination as invalid; it is not a progress
acknowledgement or a delivery. Codex sent unique sequence-12
`NACK/REJECTED` receipts for D001A, Team/Shift, and Variant/A-B, each naming
`INVALID_ACK_STATE` and requiring a new `PROGRESS/IN_PROGRESS` wire followed
by a separate `DELIVERY/DELIVERED` wire. All three lanes remain open and
source-only; no runtime or deployment action occurred.

M370 lane readback: the Scraper ACK was valid and was consumed with signed
sequence-5 receipt `codex-receipt-scraper-ack-5`; the Gallery WIRE correction
was valid and was consumed with signed sequence-5 receipt
`codex-receipt-gallery-ack-5`. F81/F84 returned another `ACK/IN_PROGRESS`
instead of a valid progress message, so Codex sent signed sequence-7
`NACK/REJECTED` `codex-nack-f81-ack-state-7`. No product DELIVERY has been
accepted on these lanes; each remains source-only and open.

M371 protocol hardening: added a stateful regression proving that a Hermes
`ACK` carrying `STATE: IN_PROGRESS` fails closed as `ACK state invalid`. The
Hermes protocol audit suite now has five passing tests, including the exact
malformed response pattern observed on the active lanes.

M372 opened the independent source-only `F85-INSIGHT-RELAY` lane after
reconciling the current F-85 rows against the existing digest, viral-recipe,
learning-state, Relay-card and dashboard paths. The task is limited to
truthful evidence-backed pattern insights, explicit unavailable
revenue/conversion attribution, and visible scheduled digest/Relay status and
recovery. It forbids fabricated provider data, parallel state, external
publication, and all runtime/deployment actions. Hermes must ACK first, then
publish a real progress checkpoint and DELIVERY with hashes and exit codes.

M373 advanced the stateful ACK/NACK loop without relying on clocks or transport
status. Six validator-passing, signed receipts were delivered to the Hermes
inbox. `D001A-CONTEXT-REPAIR` was explicitly NACKed again because the claimed
candidate still binds rehearsal resolution to live roots, hard-codes live
staging paths, falls back to live systemd paths, omits expected-target checks
on activate/backup/restore-db, and does not exercise the real dispatchers.
`F81-F84-RECIPE-CONTRACT`, `TEAM-SHIFT-CHATTER`, `VARIANT-AB-CONTRACT`,
`MEDIA-GALLERY-LIFECYCLE`, and `SCRAPER-RESULT-QUALITY` each received a
correlated ACCEPTED receipt with a concrete source-only scope and a required
`PROGRESS/IN_PROGRESS` followed by `DELIVERY/DELIVERED` artifact. The receipt
protocol is now operationally explicit: `REPLIED` is transport-only, every
logical transition has a unique `WIRE`, `SEQ` and `IN_REPLY_TO`, terminal
ownership is stated with `NEXT_OWNER`, and every sender signs the body with
`sincerely, Codex` or `sincerely, Hermes`. No message is considered read,
accepted, delivered or complete without validator-passing state and a
readable correlation. No runtime/provider/database/permission/deployment
action was taken.

M374 bridge readback found a coordination-reader gap, not a product DELIVERY.
The six M373 receipts are still present under the Hermes `inbox` and have no
correlated Hermes-authored `PROGRESS`, `ACK`, `NACK`, or `DELIVERY` artifact.
The host shows a running Hermes gateway process and a codex bridge daemon, but
no codex-readable Hermes timer or cron entry was exposed. Transport status
`REPLIED` therefore remains non-terminal and cannot be used as proof that
Hermes read the messages. No bridge, service, permission, runtime, provider,
database, migration, deployment, or credential state was changed while
diagnosing this.

M375 corrected the M374 interpretation. The bridge intentionally retains
messages in `inbox`; retention is not unread state. Direct correlated readback
now shows all six M373 messages have Hermes `ACK` responses with unique WIREs,
matching `IN_REPLY_TO` values, incremented SEQs, `STATE: ACKNOWLEDGED`,
`DELIVERY_ACCEPTED: NO`, `NEXT_OWNER: HERMES`, and `LIVE_ACTIONS: NONE`.
Hermes is therefore cooperating and the six source-only lanes are active but
not delivered. The earlier reader-gap conclusion is withdrawn; the retained
inbox files were not evidence of a polling failure. Replies also carry the
Hermes-side and Ip Man signatures, and no runtime/provider/database/permission/
deployment action occurred.

M376 reconciled the validator with the deployed bridge's actual Hermes ACK
envelope. Hermes ACKs use `STATE: ACKNOWLEDGED`, may carry scope and invariant
lines without a `PAYLOAD:` delimiter, and the bridge appends lowercase
`sincerely, hermes` after the agent's `sincerely, Ip Man` attestation. The
validators now normalize this legacy form to `READ`, or to `ACCEPTED` only
when `SCOPE_ACCEPTED: YES` is present; `DELIVERY_ACCEPTED: NO` and
`LIVE_ACTIONS: NONE` are required, and the form can never become `DELIVERED`.
All six actual Hermes replies now pass individual validation; the stateful
suite passes 6/6. This removes a false NACK/stall while keeping the strict
source DELIVERY evidence gate intact. No runtime/provider/database/permission/
deployment action occurred.

M377 completed the Codex side of the ACK turn. Six validator-passing receipts
were sent back against the exact Hermes WIREs: D001A was recorded as `READ`
because its ACK did not claim scope acceptance; F81/F84, Team/Shift/Chatter,
Variant/A-B, Media Gallery, and Scraper were recorded as `ACCEPTED` because
their ACKs explicitly said `SCOPE_ACCEPTED: YES`. Every receipt carries the
read reply body SHA-256, `DELIVERY_ACCEPTED: NO`, `LIVE_ACTIONS: NONE`, and a
concrete next action requiring Hermes source DELIVERY. The lanes remain
nonterminal; no generated artifact has been accepted and no runtime/provider/
database/permission/deployment action occurred.

M378 read back the next Hermes turn for all six receipt WIREs. Each response
is a correlated legacy `ACKNOWLEDGED` with a unique next WIRE and SEQ,
`NEXT_OWNER: HERMES`, `DELIVERY_ACCEPTED: NO`, `RUNTIME_ACCEPTANCE: UNCLAIMED`,
and `LIVE_ACTIONS: NONE`. The replies explicitly state that source-only
DELIVERY remains pending; none claims changed source bytes, tests, deployment,
or provider execution. This is a verified active checkpoint, not an idle or
complete state. No runtime/provider/database/permission/deployment action
occurred.

M379 detected and rejected a repeated Hermes ACK turn on all six lanes. Each
Hermes response acknowledged the Codex receipt again without emitting
`PROGRESS`, `DELIVERY`, or `BLOCKED`, so Codex sent a validator-passing
`RECEIPT/REJECTED` with `REASON: REPEATED_ACK_WITHOUT_PROGRESS` and a concrete
required next response. The stateful audit now fails closed on any Hermes ACK
immediately following a Codex receipt, preventing an ACK loop from appearing
as work. No source DELIVERY or runtime/provider/database/permission/deployment
action occurred.

## Coordination checkpoint — M380

The bridge now distinguishes a transport reply from logical work state. Hermes
returned legacy ACK envelopes whose body explicitly said `STATUS: BLOCKED` for
F81/F84, Team/Shift, Variant/A-B, Gallery, and Scraper; these are NOT-ACKs
because the Hermes account cannot write the FanThynks source tree. They do not
count as acceptance or progress, and no duplicate task is created.

The compatibility parser and stateful audit now normalize that deployed legacy
shape to terminal `NACK/BLOCKED`, return ownership to Codex, and permit it as
the only valid response after a Codex receipt. Ordinary ACK-after-receipt still
fails closed as an ACK loop. The regression suite is 8/8. D001A delivery 018
was independently source-audited and rejected on six concrete defects; signed
rejection 019 was sent through the bridge. No source delivery was integrated
and no installed/runtime/live action occurred.

Hermes then replied to rejection 019 with a concrete six-defect correction
plan, but encoded it as `TYPE: ACK` plus `STATE: IN_PROGRESS`. The actual bytes
fail the strict validator (`ACK` may only be `READ` or `ACCEPTED`), so Codex
sent signed receipt 021 as `RECEIPT/REJECTED` with `REASON: INVALID_ACK_STATE`.
The required next response is a real `PROGRESS/IN_PROGRESS` or a complete
`DELIVERY/DELIVERED`; no work is counted from the malformed ACK.
For legacy blocked replies, the audit fallback action is now explicitly
“resolve the named blocker or close the task,” never “publish progress.”

Hermes accepted the source-copy unblock task and identified existing writable
artifact directories with recomputed hashes; no permission change was needed.
Codex accepted that turn and dispatched the first resumed product lane,
`MEDIA-GALLERY-LIFECYCLE-COPY`, against copied artifacts only. Its acceptance
still requires a correctly typed `PROGRESS`, then a reviewed `DELIVERY`; no
source checkout, runtime, deployment or live action is counted.

The protocol audit now emits `UNCONFIRMED` when a task has no valid logical
Hermes reply. `--allow-pending` cannot promote that state. This distinguishes
not-read/no-reply from `ACK/READ`, `ACK/ACCEPTED`, and the terminal
`NACK/REJECTED` or `NACK/BLOCKED` NOT-ACK outcomes without using transport
timestamps or wall-clock assumptions.

Independent Hermes readback also exposed and closed a signature compatibility
gap: `sincerely, Ip Man (role: bridge-responder)` is now accepted alongside
the existing Hermes signatures, with a regression test. The Codex signature
remains exact and final; the bridge's lowercase suffix remains decoration.

The signed `HERMES-PROTOCOL-HANDSHAKE` was accepted by Hermes and its receipt
was sent. The gallery and F81/F84 copied-artifact lanes returned correlated
`ACK/ACCEPTED` replies; the source-copy lane returned valid `PROGRESS`, and
D001A returned valid `PROGRESS` after correcting its earlier malformed ACK.
Codex sent a receipt for each reply. No product `DELIVERY` has been accepted
yet, so these lanes remain nonterminal and no source integration or runtime
acceptance is claimed.

To keep the architecture reconciliation moving without duplicating the held
lanes, Codex dispatched five new copied-artifact lanes with independent task
ids: `TEAM-SHIFT-CHATTER-COPY`, `VARIANT-AB-CONTRACT-COPY`,
`SCRAPER-RESULT-QUALITY-COPY`, `F85-INSIGHT-RELAY-COPY`, and
`PLAYBOOK-GUIDELINE-CONSUMER-COPY`. Each is limited to the existing contracts
and Hermes writable artifact area, requires its own ACK/NOT-ACK, progress and
delivery evidence, and grants no checkout, runtime, provider, database,
permission or deployment authority.

The next source-only batch is also dispatched with independent correlations:
`PROVIDER-OAUTH-PUBLISHING-COPY`, `R2-STORAGE-ROUNDTRIP-COPY`,
`VPN-EGRESS-ISOLATION-COPY`, `OBSERVABILITY-CONTRACT-COPY`, and
`CI-RELEASE-GOVERNANCE-COPY`. These tasks close only verified source gaps in
the existing connector, storage, egress, telemetry and workflow contracts.
They do not claim live OAuth, R2, VPN, observability, hosted CI or branch-rule
evidence, and each remains `UNCONFIRMED` until Hermes returns a valid logical
reply.

`SCRAPER-RESULT-QUALITY-COPY` and `F85-INSIGHT-RELAY-COPY` have now returned
valid correlated `ACK/ACCEPTED` replies. Codex independently validated both,
recorded the F85 authority-path limitation (the feature plan is present; the
architecture matrix is not readable on Hermes's release tree), and sent signed
receipts. Neither lane has delivered source artifacts yet.

Hermes accepted all eight remaining source-lane tasks (team, variant,
playbook, provider/OAuth, R2, VPN/egress, observability and CI) with valid
correlated `ACK/ACCEPTED` replies. Codex validated each and sent a signed
receipt. Several Hermes ACKs reported that the bounded release view cannot
read the named architecture/source paths, so Codex sent the signed,
hash-identified `HERMES-AUTHORITY-CONTEXT-BUNDLE` as data. It grants no
permissions and does not widen any lane.

The next progress batch is now reconciled through the signed bridge protocol.
The handshake, gallery and F81-F84 progress replies were rejected with signed
`RECEIPT/REJECTED` NOT-ACK messages because each reused an earlier `SEQ`; the
handshake also supplied a non-actionable next step. The source-copy,
D001A-context, scraper-quality and F85-insight progress replies were accepted
with signed `RECEIPT/IN_PROGRESS` messages. No product source artifact is
accepted until a correlated `DELIVERY` includes the artifact path, checksum,
changed-file list and bounded verification evidence. Bridge transport status
`REPLIED` is never treated as ownership, progress or delivery.

The protocol parser now matches the deployed Hermes bridge exactly: it accepts
the `replied_at`/`in_reply_to_subject` reply envelope, payload-bearing legacy
ACKs, annotated Ip Man signatures and legacy `STATE: CLOSED`. `ACKNOWLEDGED`
normalizes to `READ` or `ACCEPTED` only when explicit scope evidence exists;
`CLOSED` normalizes to terminal `NACK/REJECTED`, never to progress. Twelve
protocol tests pass, and all seven newly read Hermes replies now classify
without clocks: six are `ACK/READ` or `ACK/ACCEPTED`, and the closed handshake
is `NACK/REJECTED`. No product delivery has arrived yet.

The eight remaining copied-artifact lanes (team, variant, playbook,
provider/OAuth, R2, VPN/egress, observability and CI) also returned correlated
`ACK/ACCEPTED` replies to their Codex receipts instead of `PROGRESS`. Codex
classified each as `REPEATED_ACK_WITHOUT_PROGRESS` and sent one signed
`RECEIPT/REJECTED` per existing lane, with `NEXT_OWNER: HERMES` and an explicit
request for a unique `PROGRESS` or one concrete `BLOCKED` reason. No duplicate
task was created, and no lane is counted as delivered.

Hermes then returned concrete authority blockers for all eight lanes, but those
replies used unsupported `TYPE: BLOCKED` with `TERMINAL: NO`; they were treated
as data, not as valid protocol state. Read-only verification found a readable
release at `/srv/fanthynks/releases/36b67f5ab79cca27f196c74187eb42a8b6c17d68`
with the plan and lane-specific source contracts. Codex sent one signed
`RECEIPT/IN_PROGRESS` per existing lane with those exact paths and required the
next reply to be `PROGRESS/IN_PROGRESS`, `DELIVERY/DELIVERED`, or correctly
formed terminal `PROGRESS/BLOCKED`. No permissions were widened and no source
delivery is accepted yet.

All eight lanes then returned valid `PROGRESS/IN_PROGRESS` checkpoints on
unique wires after the authority paths were supplied. Each named the same
paused runtime/deployment boundary and returned ownership to CODEX for a
receipt. Codex acknowledged each checkpoint with `RECEIPT/IN_PROGRESS`,
returned ownership to HERMES, and required source-only implementation followed
by a DELIVERY containing changed paths, SHA-256 values, commands and exit
codes. The lanes are now actively delegated; none is counted as delivered.

Hermes has read all eight implementation receipts and returned valid unique
`PROGRESS/IN_PROGRESS` checkpoints. Each says the copied implementation is in
progress, the runtime/deployment gates remain paused, and no further
acknowledgement is needed on that wire. The next acceptable event is an
evidence-backed `DELIVERY/DELIVERED` or a correctly formed terminal blocker;
Codex is not creating more duplicate receipts while those lanes are active.

The protocol now hard-fails contradictory ownership instead of allowing a
stall: `PROGRESS/IN_PROGRESS` must keep `NEXT_OWNER: HERMES` until Hermes
delivers, while `DELIVERY/DELIVERED` must hand the artifact to `CODEX` for
audit. The individual validator and stateful audit enforce the full handoff
matrix; the local protocol suite is 13/13. The eight progress replies above
assigned `NEXT_OWNER: CODEX` while explicitly saying Hermes was still
implementing, so Codex sent one signed `RECEIPT/REJECTED` NOT-ACK for each
exact WIRE. Those lanes are not delivered and no duplicate tasks were
created. The only valid next event on each lane is corrected Hermes-owned
progress, a complete delivery, or a concrete terminal blocker.

Hermes corrected all eight wires with unique `PROGRESS/IN_PROGRESS` replies,
explicit `NEXT_OWNER: HERMES`, and a concrete `DELIVERY-012` plan. Codex
validated each reply and sent one signed `RECEIPT/IN_PROGRESS` at `SEQ: 12`
per lane. The lanes are now logically active with no acknowledgement owed;
the next accepted event is an evidence-backed `DELIVERY/DELIVERED` or a
terminal `NACK`. No source artifact has been integrated yet.

The follow-up `PROGRESS-013` replies were not accepted as progress: all eight
said `DELIVERY_STATE: NOT_READY` without a concrete evidence delta, changed
path, checkpoint, or test result. The validator now requires a non-placeholder
`PROGRESS_EVIDENCE` line for every nonterminal progress message; the local
protocol suite is 14/14. Codex sent eight signed `RECEIPT/REJECTED` `SEQ: 14`
NOT-ACK messages with the same exact correction: publish the complete
`DELIVERY-012`, or return a terminal `NACK/BLOCKED` naming the single blocker.

## Coordination checkpoint — M403

Hermes supplied a concrete blocker response for each of the eight source lanes:
its bridge identity cannot write the old root-owned `work/ipman-d001a-slice1`
or `slice2` trees, and its bounded bridge view did not contain the named
authority files. No source DELIVERY was claimed or accepted. This is now a
resolvable data-path issue, not permission authority: read-only verification
confirmed that Hermes can read the deployed source tree at
`/srv/fanthynks/releases/da09f66`, including `L5-verification`, and can write
the existing bridge-owned `replies` directory.

Codex sent eight new, validator-passing TASK envelopes that explicitly
supersede only those blocked attempts. Each names the exact authority plan and
current reconciliation matrix under `/srv/fanthynks/releases/da09f66`, a
lane-specific delivery directory under
`/srv/fanthynks-bridge/hermes/replies`, and the prohibition against using the
root-owned scratch trees. The eight remote SHA-256 readbacks match the sent
envelopes. The new tasks remain source-only: Hermes may copy/edit/test within
the named delivery root, but may not touch the checkout, installer, bridge
implementation, runtime, database, providers, credentials, permissions,
network, deployment or external services. The next accepted event per lane is
one correlated ACK/NACK, then evidence-backed PROGRESS or DELIVERY. No product
artifact has been integrated and no runtime action has occurred.

## Coordination checkpoint — M404

The FT-HERMES control protocol is now the required no-stall operating rule.
Hermes has acknowledged that `REPLIED` is transport-only, `ACK/READ` is not
ownership, `ACK/ACCEPTED` is ownership, `NACK/REJECTED` and `NACK/BLOCKED` are
the NOT-ACK outcomes, and `UNCONFIRMED` is the explicit no-valid-reply state.
After a Codex receipt, Hermes must emit only evidence-backed PROGRESS, DELIVERY,
or BLOCKED; a repeated ACK is rejected as an ACK loop. No date, time, deadline,
TTL, or polling age participates in state.

The eight prior retry tasks correctly returned `NACK/BLOCKED` because their
authority path was wrong. Read-only checks found the exact candidate source
context and corrected all eight envelopes to use:

- source root: `/srv/fanthynks/releases/36b67f5ab79cca27f196c74187eb42a8b6c17d68`
- plan: `L5-verification/feature-reconciliation-execution-plan.md`
- coverage audit: `L5-verification/backend-frontend-coverage-audit.md`
- delivery roots: bridge-owned `replies/delivery-*-r3` directories

Each corrected task has a new WIRE, `REASON: SUPERSEDES:<old WIRE>`, source-only
scope, and `LIVE_ACTIONS: NONE`. Local and remote SHA-256 readback matched for
all eight envelopes. The only acceptable next event for each lane is one
correlated ACK/NACK. Codex will send exactly one receipt, then Hermes must send
PROGRESS, DELIVERY, or a concrete BLOCKED result. No source artifact has been
integrated and no runtime, provider, database, permission, or deployment action
has occurred.

The first eight R3 replies were not accepted as ACKs. Each used `SEQ: 1` again
instead of the required next sequence and ended with only the lowercase bridge
decoration `sincerely, hermes`, without the canonical Hermes role signature.
The individual validator rejected all eight. Codex sent eight signed
`RECEIPT/REJECTED` NOT-ACK envelopes with `REASON: INVALID_SIGNATURE`, the
observed defects, and the required corrected response (`SEQ: 3`, new WIRE,
canonical signature). Local and remote SHA-256 readback matched for all eight
receipts. Until corrected replies arrive, all eight lanes remain
`UNCONFIRMED`/not accepted; no source work is counted.

## Coordination checkpoint — M406

Hermes returned a second response for all eight R3 lanes after the first
NOT-ACK. Those responses corrected the sequence to `SEQ: 3` and supplied the
canonical role signature, but each used `STATE: ACKNOWLEDGED`. That value is
not a protocol state and cannot establish ownership; the repository validator
rejected all eight with `ACK state invalid`. This is a logical NOT-ACK, not a
transport failure.

Codex added a regression test covering a canonical `ACK` with
`STATE: ACKNOWLEDGED`, generated eight `RECEIPT/REJECTED` envelopes with
`REASON: INVALID_ACK_STATE`, `SEQ: 4`, and the required correction
(`STATE: ACCEPTED` or an explicit NACK at `SEQ: 5`), and sent them to Hermes.
All eight envelopes passed the local validator and their local/remote
SHA-256 values matched. No source work, deployment, migration, provider,
database, permission, or service action has occurred; all eight lanes remain
unconfirmed until a valid `ACK/ACCEPTED` or NACK arrives.

## Coordination checkpoint — M407

Hermes's next eight replies used `SEQ: 5` and `STATE: ACCEPTED`, but they
pointed `IN_REPLY_TO` back to the original task WIRE rather than the
immediately preceding `SEQ: 4` NOT-ACK receipt. They also marked `ACCEPTED`
terminal, returned `NEXT_OWNER: CODEX`, supplied `NEXT_ACTION: None`, and
sent another ACK after a Codex receipt. The validator therefore rejects them
as an invalid reply turn and ACK loop; no lane has advanced.

Codex sent eight signed `RECEIPT/REJECTED` envelopes at `SEQ: 6` with
`REASON: INVALID_REPLY_TURN`. Each requires a correlated `PROGRESS/IN_PROGRESS`,
`DELIVERY/DELIVERED`, or `NACK/BLOCKED` at `SEQ: 7`. Local validation passed
for all eight and local/remote SHA-256 readback matched. No source artifact,
runtime, provider, database, permission, or deployment action occurred.

## Source milestone — M408: model Relay-card history

The next non-overlapping source gap from the reconciliation audit is now
implemented and verified. `GET /api/v1/models/:modelId/relay-cards` is mounted
and role-gated as a read-only model surface; it joins cards to the model's
bundle, applies organization/RLS/model-access conditions, cursor-paginates
newest-first, and explicitly sanitizes provider routing/config fields from the
response. The dashboard Relay page now includes history, safe status context,
empty/error states, older-page navigation and a link back to the approval
workflow.

Changed source:

- `packages/api/src/routes/relay-cards.ts`
- `packages/api/src/routes/relay-cards.test.ts`
- `packages/api/src/index.ts`
- `packages/api/src/model-access.ts`
- `packages/api/src/model-access.test.ts`
- `packages/dashboard/lib/api.ts`
- `packages/dashboard/app/models/[id]/relay/page.tsx`
- `packages/dashboard/components/RelayCardHistory.tsx`
- `packages/dashboard/components/RelayCardHistory.test.tsx`

Evidence: focused API tests 14/14, dashboard tests 2/2, API/dashboard
typechecks pass, API/dashboard linters pass, API build/OpenAPI generation
passes. Dashboard production compilation and static page generation pass with
the required loopback `API_ORIGIN`; the final standalone trace copy is blocked
only by this Windows checkout's symlink privilege (`EPERM`), not by TypeScript,
route, or page compilation. No runtime, provider, database, permission or
deployment action occurred. The external Relay delivery and authenticated
browser gates remain open.

## Handoff maintenance rule

After each meaningful batch, update this file's SHA/CI/process section, move only
evidenced gaps forward, append the ledger, and link a receipt. Record failed
attempts accurately. Keep source, automated, deployed and provider evidence
distinct. Credit exhaustion is a handoff condition, not a reason to claim success.

## Coordination milestone — strict ACK-NACK contract

The bridge protocol now has an opt-in strict contract for every new lane:
`CONTRACT: ACK-NACK-1`. Historical envelopes remain auditable through the
compatibility path, but they cannot advance a strict lane.

Strict lanes require a contiguous logical `SEQ`, unique `WIRE`, exact
`IN_REPLY_TO`, `READ_STATUS: READ` on every reply/receipt, and a final role
signature. `ACK/READ` means read but not owned; `ACK/ACCEPTED` means read and
owned; `NACK/REJECTED` or `NACK/BLOCKED` is the explicit NOT-ACK result;
`UNCONFIRMED` means no valid logical reply and therefore not read. A Codex
receipt names the exact `RECEIPT_OF` wire. Hermes cannot answer a receipt with
another ACK, and legacy `ACKNOWLEDGED`/`CLOSED` or Ip Man-only signatures are
rejected on strict lanes. No ordering, retry, liveness or ownership decision
uses a date, time, timezone, timeout or deadline.

Changed protocol files:

- `scripts/hermes-protocol-audit.mjs`
- `scripts/hermes-protocol-check.mjs`
- `scripts/hermes-protocol-audit.test.mjs`
- `L5-verification/hermes-message-protocol.md`

Evidence: protocol syntax checks pass, `node --test
scripts/hermes-protocol-audit.test.mjs` passes 21/21, and `git diff --check`
passes. This is a source/control-plane change only; no runtime, provider,
database, permission, bridge-service or deployment action occurred. New
Hermes assignments must opt into `ACK-NACK-1` and use `sincerely, Hermes`;
Codex uses `sincerely, Codex`.

## Source milestone — M410: visual calendar scheduling surface

Implemented the next verified dashboard gap without adding a parallel schedule
model. `CalendarBoard` renders a Monday-first UTC month/week grid, links each
target to its existing detail card, and allows only editable pending targets to
request a guarded day move through the existing post PATCH route. The response
must confirm the same post, pending state, and exact computed UTC slot before a
refresh; the UI states that provider/worker publication gates still apply.
`CalendarOptimalTimes` consumes existing verified viral-performance buckets as
advisory evidence only and links to model analytics.

Changed source: `packages/dashboard/components/CalendarBoard.tsx`,
`CalendarBoard.test.tsx`, `CalendarOptimalTimes.tsx`,
`CalendarOptimalTimes.test.tsx`, and
`packages/dashboard/app/models/[id]/calendar/page.tsx`.

Evidence: focused dashboard tests 16/16, dashboard typecheck pass, dashboard
lint with three pre-existing warnings and no errors, and `git diff --check`.
No runtime, provider, database, permission, or deployment action occurred.
Authenticated desktop/mobile browser acceptance and deployed worker/provider
acceptance remain open.

## Coordination correction — M411: strict handshake fail-closed

The first Hermes response to `HERMES-PROTOCOL-ACK-NACK-1` was not counted as
accepted because it declared `STATE: ACCEPTED` with `TERMINAL: YES`. Codex
sent a validated `RECEIPT/REJECTED` at the next sequence naming
`INVALID_TERMINAL_STATE`. Hermes then corrected that field but answered the
Codex receipt with another `ACK`, returned `NEXT_OWNER: CODEX`, and supplied
`NEXT_ACTION: NONE`; that turn is also invalid. Codex sent a second validated
`RECEIPT/REJECTED` requiring `PROGRESS`, `DELIVERY`, or `NACK/BLOCKED` at the
next sequence. No transport flag is being treated as logical acceptance.

Evidence: protocol suite 21/21; both correction receipts pass the individual
validator and end with `sincerely, Codex`. Hermes then returned a valid
terminal `NACK/BLOCKED` for the control-only lane, and Codex recorded its
terminal READ receipt; that lane is closed with no feature artifact. No
runtime, provider, database, permission, bridge service, or deployment action
occurred.

## Active delegated lane — MEDIA-GALLERY-LIFECYCLE-BRIDGED

The control-only handshake is closed as a valid `NACK/BLOCKED`; it produced no
feature artifact. The next real source-only lane is a fresh strict task,
`MEDIA-GALLERY-LIFECYCLE-BRIDGED`, with `SEQ: 1` and wire
`CODEX-MEDIA-GALLERY-BRIDGED-TASK-001`. Eight non-secret media UI source/test
files were copied into Hermes's designated inbox and their SHA-256 values are
in the task payload. The task is limited to the existing model media
asset/bundle/operation contracts and explicitly forbids checkout, runtime,
database, provider, permission, or deployment actions.

Current logical state: `ACK/ACCEPTED` at Hermes `SEQ: 2`, followed by a Codex
`RECEIPT/READ` at `SEQ: 3`. The inbound `SEQ: 4` was rejected: it used
`TYPE: IN_PROGRESS` instead of the required `TYPE: PROGRESS` with
`STATE: IN_PROGRESS`. Codex sent a signed `RECEIPT/REJECTED` at `SEQ: 5`,
with `NEXT_OWNER: HERMES` and the exact correction. Hermes then returned a new
`PROGRESS` WIRE at `SEQ: 6`, but that reply still used the non-canonical
`Ip Man` signature and omitted the required concrete `PROGRESS_EVIDENCE` line.
Codex sent a second signed `RECEIPT/REJECTED` at `SEQ: 7`, with
`NEXT_OWNER: HERMES` and both exact corrections. The next valid event is a
new `PROGRESS`, `DELIVERY/DELIVERED`, or terminal `NACK/BLOCKED` on a new WIRE;
no delivery has been counted and no duplicate task will be sent.

## Coordination hardening — M413: terminal read closure and duplicate rejection

The ACK-NACK protocol now closes the last read-state ambiguity: a terminal
Hermes `DELIVERY`, `NACK/REJECTED`, or `NACK/BLOCKED` remains `PENDING` until
Codex sends a terminal `RECEIPT` with `STATE: READ`, `TERMINAL: YES`,
`NEXT_OWNER: NONE`, and the exact `RECEIPT_OF` WIRE. Strict receipts must use
`STATE: READ` for a read receipt; a malformed reply uses a terminal
`RECEIPT/REJECTED` with `NEXT_OWNER: HERMES` and a named correction reason.
Terminal READ receipts are accepted only when they acknowledge a terminal
Hermes reply. Duplicate payload keys, empty next actions, and clock/deadline
fields anywhere in strict bodies now fail closed. This keeps READ, ACCEPTED,
NOT-ACK, IN_PROGRESS, DELIVERED, correction, and closed states distinct
without using timestamps.

Evidence: `node --test scripts/hermes-protocol-audit.test.mjs` passes 25/25;
the malformed gallery `SEQ: 4` and still-invalid corrected `SEQ: 6` were
individually rejected; both correction receipts were sent and checksum-read
back from Hermes. Neither has been counted as progress or delivery.
No source integration, runtime, provider, database, permission, bridge-service,
or deployment action occurred.

## Coordination correction — M415: terminal delivery NOT-ACK and machine next action

Hermes returned a terminal `DELIVERY` at `SEQ: 10` with a unique WIRE and
matching input hashes. Codex did not count it as a delivery because the strict
body omitted the required `READ_STATUS: READ` field and introduced the forbidden
clock-like payload field `RECONCILED_AT`. Codex sent validated
`RECEIPT/REJECTED` `SEQ: 11`, `NEXT_OWNER: HERMES`, with the exact correction;
the lane remains pending a new DELIVERY on a new WIRE. No source artifact was
accepted or integrated.

M415 also hardens both validators to reject any clock-like header/payload key,
including new `_AT` spellings, and adds `--json` audit output containing the
machine-readable `status`, `state`, `next_owner`, and `next_action`. Protocol
regression suite: 27/27. No runtime/provider/database/permission/bridge-service
or deployment action occurred.

## Coordination correction — M416: Hermes host blocker remains NOT-ACK

Hermes returned a purported blocked progress message at `SEQ: 11`, but its
shape was invalid: `TYPE: PROGRESS` with `STATE: BLOCKED`, `NEXT_OWNER: OWNER`,
an Ip Man signature, and no exact `READ_STATUS: READ` payload field. It also
confirmed the substantive host blocker: no module-resolvable application root
and no writable deliverables lane for genuine source integration or tests.
Codex sent validated `RECEIPT/REJECTED` `SEQ: 12`, `NEXT_OWNER: HERMES`, asking
for a new canonical `NACK/BLOCKED` if the blocker remains. No gallery feature
delivery has been accepted; no private source bundle was transferred.

## Source milestone — M417: media operation lifecycle controls

The authoritative dashboard now reconciles the existing media-operation GET
contract in place, presents safe queued/running/failed/completed/unknown states,
offers retry for failed operations using the original validated options and a
fresh idempotency key, and never renders the stored provider error. Completed
outputs remain previewable and explicitly do not inherit approval. Four focused
control tests, ten media-page tests, dashboard typecheck, lint, and diff-check
pass. This is not a claim that the broader uploaded/generated gallery is complete;
that gap and deployed media acceptance remain open.

## Source milestone — M418: direct gallery upload path

The model media library now renders the existing `MediaUpload` workflow for
roles allowed to edit media. A confirmed upload refreshes the authoritative
library; an uncertain response preserves the same idempotency intent, and
read-only roles do not receive the control. This removes the generation-only
navigation gap without creating a second upload API. Full cross-lifecycle
gallery filtering/history and deployed browser/media acceptance remain open.

## Source milestone — M419: media library filters

The existing model-scoped media listing now accepts fail-closed `origin` and
`kind` filters (`uploaded`, `generated`, `transformed`, `legacy`; `image` or
`video`). The dashboard exposes accessible filter controls, preserves the
selected filters across older/latest cursor links, and offers an explicit clear
action. Focused API filter/error tests (14/14), media-page tests (11/11),
dashboard typecheck, lint (three pre-existing warnings), and diff-check pass.
This is a discoverability improvement, not evidence of deployed storage,
worker playback, or complete cross-lifecycle gallery acceptance.

## Active delegated lane — TEAM-SHIFT-CHATTER-COPY-R4

Codex submitted `codex-team-shift-chatter-copy-r4.json` through the strict
ACK-NACK-1 bridge. The remote SHA-256 readback matches the local payload:
`c4e1d5866767826d11972bee3f8453d7805bd5a2be789d7e43014d2aaf444ec5`.
The task is source-only and asks Hermes to use a new copied-artifact lane for
assigned-shift/model restrictions, post-note ownership, bounded pagination and
truthful terminal handoff states. It forbids installer, bridge, deployment,
database, runtime, provider, permission and credential actions. No Hermes
feature delivery is accepted yet. Hermes returned a substantive blocker saying
the `da09f66` release does not contain the named authority docs, but used the
legacy `Ip Man` signature, so Codex rejected that protocol turn with a signed
receipt. Codex then submitted corrected `TEAM-SHIFT-CHATTER-COPY-R5` authority
paths against the readable `36b67f5ab79cca27f196c74187eb42a8b6c17d68` release;
the local/remote payload hashes are recorded in the ledger. The next valid
state is a correlated strict ACK/NACK, evidence-backed PROGRESS, DELIVERY, or
canonical NACK/BLOCKED.

## Coordination checkpoint — M422: team lane accepted

Hermes returned a valid strict `ACK/ACCEPTED` for `TEAM-SHIFT-CHATTER-COPY-R5`
using the corrected authority root and canonical `sincerely, Hermes` role
signature. Codex validated the reply and sent
`var/bridge-requests/codex-receipt-team-shift-chatter-r5-ack.json` as
`RECEIPT/READ`, `SEQ: 2`, with `READ_STATUS: READ` and the exact
`RECEIPT_OF`. The receipt passed the local protocol checker and its SHA-256
`fc8fc4024ff5842711adefd48ff43ebe81882e78912fa5396fbe8716e5c1ef64` matched
the remote inbox readback. Hermes now owns the source-only implementation
turn; no feature delivery has been accepted yet. The only acceptable next
event is evidence-backed `PROGRESS`, `DELIVERY/DELIVERED`, or terminal
`NACK/BLOCKED`. No runtime, provider, database, permission, bridge-service or
deployment action occurred.

## Explicit owner extension — CHATTER-LLM-ROLEPLAYER-COPY-R1

The owner has extended Chatter so its actor may be either a real human or an
approved model-scoped LLM, with Grok as the first roleplayer provider. The
existing source has human Chatter shifts, model-scoped agent permissions,
Grok subscription transport, persona/playbook prompt segments and audited
reply intents as separate contracts; their safe composition is not yet
implemented or accepted.

Codex submitted the strict source-only Hermes task in
`var/bridge-requests/codex-chatter-llm-roleplayer-copy-r1.json`; local and
remote payload SHA-256 both equal
`26ab8d432585df027ae359e441b187159dad8192383fbdf6bd4cb09d0ae0a70c`. Its required
handoff is actor-agnostic and human/LLM readable: actor type/reference,
org/model, active shift, conversation cursor, queue, last safe handoff
summary, pending intent, memory policy, persona source and persona revision.
LLM roleplay must add bounded tenant/model-scoped conversation memory and an
optional versioned, size-bounded and traversal-safe `soul.md`-style persona
source, with explicit retention, audit and revision behavior. Persona text is
instruction data only; system safety, ToS, consent, approval and publication
rules remain higher priority. The lane must preserve the human path, use a
fake/captured transport in tests, and report `LIVE_ACTIONS: NONE`.

Hermes returned a valid strict `ACK/ACCEPTED` for this lane and confirmed the
authority files, handoff fields, bounded memory, versioned persona, Grok-first
transport and no-live-action boundary. Codex validated the reply and sent
`var/bridge-requests/codex-receipt-chatter-llm-roleplayer-r1-ack.json` as
`RECEIPT/READ`, `SEQ: 2`, with the exact `RECEIPT_OF`. The receipt passed the
local protocol checker and its SHA-256
`887646b10ff26bc630b9d3a92a519be1c12885696e1457a1517a2c18408f138a` matched
the remote inbox readback. Hermes now owns the source-only implementation
turn; no source delivery has been accepted yet. The next valid event is
evidence-backed `PROGRESS`, `DELIVERY/DELIVERED`, or terminal
`NACK/BLOCKED`. No runtime, provider, database, permission, bridge-service or
deployment action occurred.

Codex then sent one signed continuation receipt,
`var/bridge-requests/codex-receipt-chatter-llm-roleplayer-r1-progress-required.json`,
as `RECEIPT/READ`, `SEQ: 3`, requiring concrete writable-copy progress or a
canonical blocker. Its local and remote SHA-256 both equal
`8445bcfd73f6f9b8722bf5b7df7526a40da46964021666c2028603f3d8d3f941`. This is
not a duplicate task; it is the next correlated turn after the accepted ACK.

## Source progress — M427: roleplay context contract

Because Hermes had not produced a source artifact after the accepted lane and
continuation receipt, Codex implemented a narrow architecture-faithful source
slice locally in `packages/llm-gateway/src/roleplay-context.ts`. It provides a
single human/LLM-readable handoff shape, bounded tail memory formatting,
revisioned persona snapshots and safe `soul.md`-style source references. It
does not read arbitrary files, persist data, call Grok, or bypass assignment,
consent, safety, approval, idempotency or publication controls.

Evidence: focused tests 8/8, gateway typecheck clean, gateway lint clean with
16 pre-existing warnings, and diff-check clean. The full gateway suite still
has four unrelated subscription-process termination failures; no roleplay
test failed. Durable DB/API/dashboard wiring and runtime/provider acceptance
remain open. Hermes's source-only lane remains pending and must be audited for
overlap before any further integration.

Codex sent a signed baseline receipt,
`var/bridge-requests/codex-receipt-chatter-llm-roleplayer-r1-baseline.json`,
as `RECEIPT/READ`, `SEQ: 4`, asking Hermes to deliver only the missing durable
DB/API/dashboard wiring and audit overlap with commit `438abc5`. Its local and
remote SHA-256 both equal
`60694e0b02f23c53c5d6f141829efb6c5acf6fff45ec6510983d11d5f974289d`. No
runtime, provider, database, permission or deployment action occurred.

## Source milestone — M429: canonical human/LLM roleplay handoff

Codex extended the roleplay context contract in commit `ddd8314`. The same
validated state can now be carried as a versioned JSON envelope or rendered as
a compact human/LLM-readable resume card. `formatRoleplayPromptContext` joins
that handoff to bounded conversation memory and persona guidance. The new
`loadRoleplaySoulSnapshot` API accepts an approved tenant/model-scoped reader
result for a versioned `soul.md`; it never resolves an arbitrary path, reads
the filesystem, follows a symlink, or creates a second permission system.

Evidence: 12 focused roleplay tests pass, gateway typecheck passes, gateway
lint reports only the existing 16 warnings, and `git diff --check` passes.
The handoff format is documented in
`L5-verification/roleplay-handoff-format.md`. This does not claim durable
conversation storage, API/dashboard assignment controls, Grok dispatch, live
provider behavior, or deployment acceptance.

### Historical machine/LLM resume card (superseded by M431 below)

```text
STATE: HISTORICAL_CHECKPOINT
CURRENT_OWNER: CODEX
ACTIVE_LANE: CHATTER-LLM-ROLEPLAYER-COPY-R1
LAST_ACCEPTED_CODE: ddd8314
ACCEPTED_SOURCE: llm-gateway roleplay-context contract
NEXT_REQUIRED: superseded; use the M431 resume card below
INTEGRATION_RULE: audit delivered source against ddd8314; integrate only non-overlapping, tested changes
FORBIDDEN: installer, deployment, migration, database, provider, permission, credential, service actions
OPEN_GATES: durable memory/persona persistence; actor assignment/revocation; Grok roleplay dispatch; browser/runtime/provider acceptance
```

At that checkpoint, Hermes's read-only poll showed transport `REPLIED` with no
roleplay delivery files. That historical transport state is not source progress
or completion; the current owner and next actions are defined by M431 below.

## Source milestone — M431: durable dual-actor roleplay state

Codex completed the missing source/API/dashboard slice in the current working
tree after Hermes produced no deliverable artifact for the accepted roleplayer
lane. The implementation is architecture-faithful and keeps the existing
assignment, agent-permission, RLS, audit, consent, approval, idempotency and
publication boundaries:

- `team_shift` now represents either a human assignee or an approved LLM
  actor, with the actor shape enforced in the schema and API.
- `roleplay_persona_revision` stores immutable, bounded `soul.md` revisions;
  `roleplay_memory_turn` stores ordered tenant/model/conversation memory with
  tail retention; `roleplay_handoff` stores one optimistic-revision resume
  card per conversation.
- API routes expose read, persona, memory and handoff operations under the
  model workspace. Active shift and model-scoped editable-agent checks happen
  server-side before writes; audit records are emitted for accepted writes.
- The dashboard exposes **Chatter & roleplay** for human or LLM actors and
  lets an authorized operator paste or load a local `soul.md`/persona prompt
  as text before saving a revision. No local path is sent to the server.

Evidence: DB 151/151 tests, targeted API 160/160 tests, dashboard navigation
40/40 tests, roleplay gateway 12/12 tests, and all four package typechecks
pass. The full gateway suite still has four pre-existing Windows
subscription-process termination failures. The source migration `0050` is
not applied; provider dispatch, Grok receipts, Venice integration, browser
acceptance and deployment remain open. This milestone does not claim
production readiness.

## Source milestone — M441: bounded Grok roleplay turn dispatch

Codex completed the missing provider-turn source slice after Hermes confirmed
that its older authority release did not contain the roleplay contracts and
correctly returned a terminal source-mismatch NACK. The new `roleplay_turn`
ledger is a one-way, tenant/model-scoped provider receipt record, not a second
inbox or publication permission system. The API requires an
owner/manager/operator, an active assigned LLM shift, matching editable
`agent_permission`, a canonical persisted handoff and explicit confirmation;
it uses the existing Grok gateway, bounded persona/memory prompt context,
intent-key idempotency and sanitized rejected/uncertain outcomes. Completed
turns append user/assistant memory under the existing memory cap and never
publish externally. Human actors remain supported through the existing
handoff and bounded-memory controls.

The dashboard now exposes the provider action on the existing Chatter &
roleplay page only for an assigned LLM actor, while retaining the human
handoff path and local `soul.md` loading. Source files are
`packages/db/src/schema/roleplay.ts`, migration `0051`, the roleplay API
route/tests, and `RoleplayManager.tsx`.

Evidence: roleplay API 8/8, DB schema/migration tests 127/127, API/DB/dashboard
typechecks pass, dashboard lint has only the repository's existing three
warnings. The full LLM-gateway suite still has four pre-existing Windows
subscription-process termination failures. Migrations `0050` and `0051` are
not applied; real Grok/provider receipt, browser acceptance and deployment
remain open. This milestone does not claim production readiness.

## Source milestone — M444: reloadable roleplay provider receipts

The existing roleplay context now returns the latest 20 persisted provider
turn receipts for the tenant/model/conversation scope. The Chatter & roleplay
dashboard reloads that context after a rejected or uncertain provider turn and
shows pending, completed, rejected and uncertain receipt state without
inventing assistant content. This remains a read-only view over the existing
`roleplay_turn` ledger; it adds no inbox, publication or second permission
system. API coverage is 9/9 for this route, including an uncertain receipt
reload case. API and dashboard typechecks pass, and dashboard lint remains
error-free with only the repository's three existing warnings. The source
commit is `b0008d717cb76c37cecd64ca7dfffa9d54b93e87`, pushed to
`origin/codex/telegram-webhook-hardening`. Migration `0051`, real Grok/provider
receipts, browser acceptance and deployment remain open. This milestone does
not claim production readiness.

## Source milestone — M448: roleplay personality suggestion/manual authoring

The existing `Chatter & roleplay` persona editor now offers four bounded,
client-side personality suggestions (`Warm & playful`, `Confident & witty`,
`Thoughtful & supportive`, and `Energetic & creative`) through a labeled
selector and an explicit `Use suggested personality` action. The selected
suggestion is copied into the existing persona editor for review; it is not
persisted or sent to a provider until the existing `Save new persona revision`
action is chosen. `Write manually` is an explicit mode control that preserves
any current text, including a loaded local `soul.md`, so users can author or
revise the prompt themselves without accidental data loss. The existing
8,000-character limit, tenant/model-scoped persona revision API and safety/
consent/ToS/publication boundary remain unchanged.

Source commit: `f4a0c8b5b92920f0533e7a5abbc86d384524174f`.
Focused dashboard tests are 3/3, dashboard typecheck passes, and dashboard
lint remains error-free with only the repository's three existing warnings.
This is a source/UI milestone only; browser acceptance, provider/runtime
acceptance, migrations and deployment remain open.

## Source milestone — M450: paginated scraper history

Codex closed the non-overlapping saved-research history gap in the existing
scraper contract. The model-scoped scrape-run API now uses the repository's
standard descending `(created_at, id)` keyset cursor, bounded limits and
truthful `next_cursor` metadata instead of an unpaged hard-coded first 50.
The dashboard forwards the cursor, distinguishes an exhausted page from an
empty history, and exposes `Latest research` / `Older research` navigation
without changing the queueing, egress, result-quality or publication
contracts. The API path remains tenant-scoped and existing role middleware
continues to govern access.

Source commit: `87c0927d65f96fe15b07d753c264330a2b3e8f78`, pushed to
`origin/codex/telegram-webhook-hardening`.
Evidence: scraper API route tests 3/3, dashboard scraper/page tests 8/8,
worker scraper tests 11/11, API/dashboard typechecks pass, and both package
linters exit 0 with only the repository's pre-existing warnings. The
scraper-result-quality Hermes lane remains separate and unaccepted; this
milestone does not claim provider parsing, deployed sidecar, browser or
production readiness.

## Source milestone — M452: roleplay personality interaction coverage

Codex added a component-level behavior suite for the existing roleplay
personality authoring controls. It verifies the user-visible contract rather
than only checking rendered labels: clicking `Use suggested personality`
copies a bounded preset into the persona editor, and clicking `Write manually`
keeps that text editable so the operator can replace it with a custom prompt.
The existing review-before-save behavior and tenant/model-scoped persona
revision boundary remain unchanged.

Source commit: `98568e05f5c074aa5c9076e4357a0ab1ad0e1f3d`, pushed to
`origin/codex/telegram-webhook-hardening`.
Evidence: roleplay behavior tests 2/2, roleplay markup/personality tests 3/3,
dashboard typecheck passes, dashboard lint exits 0 with only the repository's
three pre-existing warnings, and `git diff --check` passes. Browser/provider,
migration and deployment acceptance remain open.

## Source milestone — M454: playbook context on analytics

Codex closed the verified playbook consumer gap on the analytics surface. The
model analytics page now reads the existing tenant/model-scoped guideline API
and renders each saved platform guideline's revision, cadence target, posting
time guidance and upsell strategy as explicitly advisory context, with a link
back to the editor. Guideline failure and empty state are fail-closed and do
not hide real metrics, invent defaults, reinterpret performance or schedule
anything.

Source commit: `700a116eef6aeffe2c65a845a91b6c5a451a827f`, pushed to
`origin/codex/telegram-webhook-hardening`.
Evidence: analytics page tests 5/5, related playbook/roleplay tests 14/14,
dashboard typecheck passes, dashboard lint exits 0 with only the repository's
three pre-existing warnings, and `git diff --check` passes. Browser, deployed
migration and provider acceptance remain open.

## Source milestone — M456: verified recipe dimensions in pattern insights

Codex extended the existing publication-bound viral pattern query and dashboard
consumer without creating a parallel learning model. Patterns now carry the
captured media format, ToS verdict at publication and actual publication-hour
bucket in addition to the existing caption arm and scheduled-time context.
The query remains tenant/model scoped and evidence-gated by published provider
observations; the UI labels these as observations and does not infer thumbnail
quality, conversion lift, causality or recommendations.

Source commit: `17ffc8e6d2a8c57783e4c575edfca377df936184`, pushed to
`origin/codex/telegram-webhook-hardening`.
Evidence: API viral/insights tests 17/17, dashboard pattern/analytics tests
7/7, API and dashboard typechecks pass, both package linters exit 0 with only
the repository's existing warnings, and `git diff --check` passes. Thumbnail/
shoot metadata, revenue/conversion attribution, broader contextual arms,
scheduled Relay delivery, browser/provider acceptance and deployment remain
open.

## Source milestone — M459: preserve photoshoot recipe evidence

Codex closed the source-level shoot-control portion of F-81 without inventing
thumbnail or conversion evidence. The existing style, outfit, location, mood,
lighting and aspect-ratio controls are now persisted on `content_bundle`, copied
into the first immutable publication snapshot and recorded as `shoot_config` in
viral recipe evidence. Historical bundles remain explicitly null because their
controls were not captured; editable prompts are never used to reconstruct
history. Migration `0052_publication_recipe_shoot_config.sql` is source-only
and has not been applied to any database.

Source commit: `3d7e1cb6019478e0d83a211b3bee77f9d8885a62`.
Evidence: DB schema/migration tests 128/128, worker recipe/publication tests
21/21, API generation tests 49/49, DB/worker/API typechecks pass, and
`git diff --check` passes. Trusted thumbnail descriptors, conversion
attribution, broader contextual arms, scheduled Relay delivery, browser/
provider acceptance and deployment remain open.

## Hermes coordination checkpoint — R9/R5 source-only lanes

Codex superseded the stale R8 lane references with four independent R9 tasks
against source commit `73254399034aa33d71aa0d86bf235233a53c6c40`: variant/A-B
contract, media-gallery lifecycle, scraper result quality and team/shift/
Chatter visibility. Hermes successfully fetched and resolved the exact pinned
commit in its isolated clone, but each reply was `ACK_READ` and explicitly said
copy/implementation had not begun. The four declared writable copy roots were
empty when checked. Codex sent validator-passing `RECEIPT/READ` messages that
require a concrete `PROGRESS`, `DELIVERY`, or `NACK/BLOCKED`; no Hermes source
artifact has been accepted or integrated. No runtime, provider, database,
permission, migration or deployment action occurred.

Hermes subsequently published a `PROGRESS` receipt for `TEAM-SHIFT-CHATTER-
COPY-R5` and created a copied packages/api + packages/dashboard tree, but it
did not publish the required flat `DELIVERY` envelope or a reviewed source
delta. The roleplayer lane `CHATTER-LLM-ROLEPLAYER-COPY-R1` remains an `ACK`
with no implementation delivery. Codex sent signed receipts requiring either
hash-verifiable DELIVERY or a concrete NACK/BLOCKED; untouched copies will not
be committed or pushed.

## Hermes source lane — TEAM-SHIFT-CHATTER-COPY-R8

Hermes has been assigned a bounded source-only team/Chatter reconciliation from
the exact pushed ref `2da0710b2db0bc54f9d1dbdc872495c549a6a135`. The lane targets
the documented gap in `team-operations`: role-scoped visibility for management
roles versus assigned human chatter/approved LLM actors, bounded stable cursor
pagination for GUI data, and truthful empty/next-page metadata. It must reuse
the existing RBAC/RLS, model-access, shift, note, terminal-state and idempotency
contracts, and must return a concrete NACK if the existing schema cannot support
a requested behavior. No delivery has been accepted yet.

## Owner extension checkpoint — localization and FanThynks platform affiliate stack

F-89 and F-90 are now architecture requirements, not completed features.
Localization must support `en`, `es`, `ja`, `it`, `pt-BR` and `de` across the
dashboard, native mobile, auth, email and operator surfaces with persisted
user/org locale precedence, typed catalogs, English fallback and locale-aware
formatting. UI locale must remain separate from creator/model content language.

F-90 is the Axiom/FanThynks platform-acquisition affiliate program: partners
refer creators to the FanThynks SaaS and receive attributable commissions under
immutable event, reversal/refund, fraud-hold, payout-export, disclosure,
audit and idempotency controls. It is not a tenant-facing affiliate builder,
creator referral program or customer resale control plane; provider earnings
`referrals` is not a substitute. OpenPartner and Refferq remain MIT license-fit
candidates, but neither is accepted as hardened or imported. RefKit's
application is AGPL-3.0 and is not the default for a proprietary deployment.
The stack must pass pinned source, dependency, security and license review;
otherwise F-90 is built natively.

## Owner extension checkpoint — Patreon creator/community integration

F-91 is now an architecture requirement, not an implemented connector. Patreon
is tracked as a creator/community integration alongside the ten publishing
social networks. The v2 contract supports OAuth, creator/campaign identity,
membership/tier and post reads, cursor pagination and campaign webhooks; it
does not document a general post-publish write scope. The product must expose
truthful sync/manual-assist states and must not invent Patreon publishing, DMs,
payouts or unsupported analytics. Use minimum scopes, encrypted credentials,
model egress, tenant/model RLS, idempotent cursor/webhook reconciliation and
the existing Relay/audit path. API v1 retirement on 2026-10-07 is a hard
constraint. Official reference: https://docs.patreon.com/.

### Machine/LLM resume card

Bridge checkpoint: the cron report describing the original R9 intake is stale as
an execution summary. Hermes verified the pinned commit and returned ACK/READ,
but did not begin those lanes. Codex submitted signed superseding proceed
envelopes `codex-media-gallery-copy-r9-proceed`,
`codex-scraper-result-quality-copy-r9-proceed`, and
`codex-variant-ab-contract-copy-r9-proceed`; all three arrived in the Hermes
inbox with checksum verification. They explicitly forbid another intake ACK and
require PROGRESS followed by one flat hash-verifiable DELIVERY or a terminal
NACK/BLOCKED. Team/Chatter R5 is currently PROGRESS/WORKING with a copied lane
and green source-only tests but no DELIVERY. LLM-roleplayer R1 is
PROGRESS/IN_PROGRESS with contracts confirmed but no delivery artifact yet.
No Hermes product artifact has been accepted, integrated, committed, or pushed.

Codex submitted strict source-only lanes against the exact pushed head
`77d098f8ec36a1427cc6a5aed25ad06f9ab09e09`, with instructions to fetch that
commit into lane-local copies rather than relying on the older server release
or an inaccessible private clone: `LOCALIZATION-MULTILINGUAL-COPY-R1`,
`AFFILIATE-STACK-COPY-R1`, and `PATREON-COMMUNITY-COPY-R1`. The affiliate
lane was then superseded after owner clarification by
`AFFILIATE-PLATFORM-COPY-R2` against exact source
`ab7ce6b1730efff165bc04715cf357b27384a80e`; it is platform-acquisition only.
Each active lane requires one correlated ACK/NACK, then evidence-backed
PROGRESS and a flat, hash-verifiable DELIVERY or one concrete BLOCKED result.
These assignments are source-only and do not authorize runtime, provider,
database, permission or deployment actions.

Hermes replied to Localization R1 and Patreon R1 with legacy
`STATE: ACKNOWLEDGED` plus `ACK_STATUS: ACCEPTED`. Because both tasks opted
into `ACK-NACK-1`, those replies are protocol-invalid and do not establish
ownership. Codex submitted signed `RECEIPT/REJECTED` corrections naming the
exact reply wires and requiring a new correlated ACK/NACK; no implementation,
progress or delivery is counted for either lane until that correction arrives.

The owner clarified that F-90 is the FanThynks/Axiom SaaS referral program,
not a tenant-owned affiliate builder or creator resale control plane. Hermes
validly accepted `AFFILIATE-PLATFORM-COPY-R2`; Codex sent the correlated
`RECEIPT/READ` and is awaiting source-only PROGRESS/DELIVERY. The malformed
Localization R1 and Patreon R1 lanes were superseded by exact-head R2 tasks
`LOCALIZATION-MULTILINGUAL-COPY-R2` and `PATREON-COMMUNITY-COPY-R2` against
the pushed source head below. Hermes has now validly accepted both R2 lanes
and Codex has sent correlated READ receipts. They require source/test
evidence only; no runtime, provider, migration, permission or deployment
action is authorized.

```text
STATE: ACTIVE_PARTIAL
CURRENT_OWNER: CODEX
ACTIVE_LANE: F90-AFFILIATE-WIRING-R1 + F91-PATREON-WIRING-R1 + F89-LOCALIZATION-WIRING-R1 + TEAM-SHIFT-WIRING-R1 + CHATTER-ROLEPLAY-WIRING-R1 + VARIANT-AB-WIRING-R1 + MEDIA-GALLERY-WIRING-R1 + SCRAPER-QUALITY-WIRING-R1 + PLAYBOOK-GUIDELINE-WIRING-R1 + LEARNING-RECIPE-WIRING-R1 + CLIPPING-ADAPTATION-WIRING-R1 + PROVIDER-OAUTH-WIRING-R1 + R2-STORAGE-WIRING-R1 + VPN-EGRESS-WIRING-R1 + OBSERVABILITY-WIRING-R1 + CI-ENFORCEMENT-WIRING-R1
LAST_ACCEPTED_CODE: b238a1537efa9eb6ca1b86746ad726f54533b8e1
PUBLISHED_HEAD: b238a1537efa9eb6ca1b86746ad726f54533b8e1
ACCEPTED_SOURCE: dual-actor shifts + roleplay DB/API/dashboard persistence + bounded Grok turn dispatch + reloadable provider receipts + suggested/manual personality authoring and interaction coverage + paginated scraper history + playbook analytics context + publication-bound recipe dimensions + persisted photoshoot recipe evidence + hash-verified pure contracts for variant/A-B, media gallery, scraper quality, team-shift access, human/LLM roleplay, FanThynks SaaS referrals, six-locale UI support and Patreon community sync; locale migration is authored only and not applied
NEXT_REQUIRED: consume logical ACK/READ for each R1 wiring task, then verify concrete PROGRESS and integrate only hash-verified reviewed source, run owning tests, commit/push each independent lane, then advance; pure-contract deliveries are integrated but do not close their feature gates; baseline-copy lanes are closed as non-implementations; every active lane requires logical ACK/READ, then PROGRESS, then DELIVERY/BLOCKED; no wall-clock or date comparison is part of the bridge protocol
INTEGRATION_RULE: Hermes ACK/REPLIED is not delivery; integrate only hash-verified source artifacts or Codex-reviewed local work
FORBIDDEN: installer, deployment, migration, database, provider, permission, credential, service actions
OPEN_GATES: variant/A-B route and dashboard wiring; media gallery route, preview and source/generated UI wiring; scraper dispatch/result-quality route and dashboard wiring; team helper enforcement in routes/UI; roleplay helper wiring plus browser acceptance; F-89 locale persistence/API/dashboard/mobile selector and catalog/browser acceptance; F-90 FanThynks SaaS referral schema/routes/operator UI and license/security/browser acceptance; F-91 Patreon OAuth/social-account persistence, sync/webhook/manual-assist routes/UI and provider/browser acceptance; migrations 0050-0053; real Grok provider receipt/runtime acceptance; human multi-user and mobile/desktop browser acceptance; deployed runtime/provider evidence; trusted thumbnail descriptors; conversion dimensions; scheduled Relay delivery
HERMES_STATUS: Sixteen source-only R1 wiring tasks are dispatched against the checksum-verified a27d193 source archive: F90 SaaS referrals, F91 Patreon community, F89 localization, team shifts, human/LLM Chatter roleplay, variants, media gallery, scraper quality, playbook guidelines, learning/recipe evidence, clipping/adaptation, provider/OAuth, R2 storage, VPN/egress, observability and CI enforcement. Await logical ACK/READ and concrete PROGRESS; no delivery is accepted from an intake ACK. Pure contracts are integrated at 59064a3 with owning tests, and the affiliate projection was tightened after a privacy test caught an ownership leak. M485 corrected a Patreon test cast and the DB relation-count assertion; focused connector and DB suites pass. The environment-aware full suite now reaches the dashboard build and fails only in six MCP success-path tests because no disposable PostgreSQL test URL/user is supplied; this remains an unclosed local test-environment gate, not a claimed product pass. Localization migration bytes are readable and remain authored only. No runtime/provider/database/permission/migration/deployment action is authorized; follow-up source-only wiring tasks are required before any feature gate can close.
```
