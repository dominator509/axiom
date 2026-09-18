# FanThynks — Astra to Luna continuation handoff

Updated: 2026-09-18, after milestone M354 assignment. This is a continuation checkpoint,
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
- Latest application milestone: **M349 exploratory performance patterns**, in
  this handoff's commit. Prior application SHA `4be39a68b91dd4c9fb24a99ece86b8019974ffad`;
  intervening documentation SHA `466a55420722501dcbf450e1d58d4970807dabb1`.
- Worktree was clean immediately before this documentation update. Inspect it
  again on arrival; this handoff's own commit will be newer than M342.
- Current application migrations: **50**, ending
  `0049_weekly_digest_schedule.sql`. Migration0048 adds caption guidance.
- Latest full-matrix source: `d53787420f4b880d911818ca9ed45b3f271c541c`;
  later application changes have focused evidence recorded below.
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
2. Verify branch/HEAD/dirty state and the exact M349 hosted CI result. Preserve
   the passing earlier-SHA receipts as historical.
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
5. After the M354 commit/push, dispatch the next bounded product node from the
   active completion sequence. Continue the full gap list in parallel across
   learning, media/storage, providers/network, UX and release operations; do
   not let a completed Hermes reply become a stopping point.
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

## Handoff maintenance rule

After each meaningful batch, update this file's SHA/CI/process section, move only
evidenced gaps forward, append the ledger, and link a receipt. Record failed
attempts accurately. Keep source, automated, deployed and provider evidence
distinct. Credit exhaustion is a handoff condition, not a reason to claim success.
