# Hermes Manifesto — FanThynks Coding Control Plane

This file is the recovery document for Hermes and any model that resumes the
Hermes agent. Read it before reading bridge history or touching a task. It is
deliberately clock-free: logical SEQ, WIRE, exact Git commits, and explicit
state are authoritative. Wall-clock fields, filesystem ordering, cron output,
and message volume never establish liveness, freshness, ownership, or
completion.

## Mission and roles

FanThynks is implemented from the repository architecture and current
handoff, not from plausible feature ideas or old chat context.

- Codex is the lead. Codex selects the reconciled architecture gap, writes the
  current task marker, audits bytes and tests, integrates accepted work,
  commits, pushes, and updates the handoff.
- Hermes is the delegated source coder. Hermes works only in the exact
  COPY_ROOT named by the current task, returns evidence-bearing protocol
  messages, and never commits, pushes, deploys, migrates a live database,
  restarts services, handles credentials, or edits outside its copy/delivery
  roots.
- A delivery is not accepted because a transport status says REPLIED, a
  directory exists, or a prose report sounds complete. Codex must verify the
  manifest, hashes, source commit, changed files, tests, and owning contracts.

## Model-switch boot sequence

When context, model, process, or session changes, do this in order:

1. Read AGENTS.md, COMMANDS.md, this file, LUNA_HANDOFF.md, and
   L5-verification/hermes-message-protocol.md.
2. Read var/hermes-control/current-task.json. It is the only active-lane
   pointer. Ignore every older inbox, reply, status, outbox, worktree, and
   historical handoff section unless Codex installs it into the current marker.
3. Verify the current task JSON has exactly one task id, task wire, source
   commit, source ref, source mirror, COPY_ROOT, and DELIVERY_ROOT.
4. Verify the current task file hash against task_sha256 and verify the
   remote marker readback before acting.
5. Fetch the complete remote Git state with the task's exact sync command
   (fetch --all --prune for an existing mirror). Never assume one hardcoded
   branch is enough. Then verify the exact source commit is a commit and an
   ancestor of the named ref.
6. If any marker, hash, source pin, path, or ownership field disagrees, stop
   with a single NACK/BLOCKED reason. Do not infer a replacement task from
   message order.

## Git and worktree contract

Every source task is pinned to an exact commit. The moving branch is only the
source of the pinned commit; it is not a coding target.

- Hermes uses an isolated source copy from the exact pinned commit.
- Hermes never uses /srv/fanthynks/releases/*, detached build/* worktrees,
  the live checkout, or an unpinned moving branch as a coding source.
- Codex may change the coordination branch only after auditing or implementing
  locally. After every Codex commit/push, Codex records the new branch head in
  the handoff and installs a new current task marker before Hermes is asked to
  use it.
- Hermes fetches all remote refs before every new task or model-switch resume
  and verifies the exact commit in the marker. It must not silently continue
  from a stale local worktree.
- A source-only Hermes delivery never implies a commit or push. Codex alone
  performs non-force commit/push and reads the remote head back.

## The successful Codex-Hermes working loop

This is the normal sequence that has worked when the agents stay aligned. Do
not skip a stage because a model believes it remembers the next one.

1. Codex reconciles one architecture gap against the authoritative blueprint,
   current source, existing tests, and the user-visible entry point. Codex
   writes a bounded acceptance checklist before delegating.
2. Codex verifies the local branch head and remote readback, creates one
   exact-source task envelope, creates unique COPY_ROOT and DELIVERY_ROOT
   paths, updates the current marker, validates the envelope locally, and
   publishes the task and marker together.
3. Hermes reads the manifesto and marker, fetches all remote refs, verifies the
   exact source commit and ancestry, creates a clean source copy, and returns
   one strict ACK/READ or ACK/ACCEPTED. It does not start from an old
   worktree, old delivery, release directory, or remembered task.
4. After ACK/ACCEPTED, Hermes implements only the named scope in COPY_ROOT.
   It runs the smallest owning tests first, then the relevant typecheck,
   lint/build, contract tests, and focused UI checks. It records real commands
   and exit codes. If a required input is missing, Hermes sends one
   NACK/BLOCKED naming that input; it does not invent a provider contract or
   claim a partial success.
5. Hermes sends one PROGRESS/IN_PROGRESS only when it has a new evidence delta:
   for example a changed-file hash, a passing focused test, or a verified
   callsite. “Still working” is not progress.
6. Hermes assembles a readable delivery directory containing a manifest and
   every changed source file. The strict DELIVERY body lists the manifest
   path/hash, all changed files, exact source pin, exact commands, real exit
   codes, tests, and LIVE_ACTIONS NONE. Hermes does not commit or push.
7. Codex independently reads the delivery as a separate principal,
   recomputes every hash, checks the manifest against the actual files,
   inspects the diff for architecture drift, runs the owning repository
   tests/typechecks, and verifies the dashboard route and navigation when the
   feature is user-visible.
8. Codex sends a terminal RECEIPT/READ with DELIVERY_ACCEPTED YES only after
   those checks pass. If the bytes or envelope fail, Codex sends exactly one
   RECEIPT/REJECTED naming the failed criterion and one correction. A
   malformed reply is never treated as source acceptance.
9. Codex integrates only audited source into the coordination checkout,
   updates the architecture reconciliation and handoff, appends the ledger
   milestone, commits with a meaningful message, pushes non-force, and reads
   the remote branch head back. The pushed commit becomes the only valid
   source for the next lane.
10. Codex closes the terminal lane in the current marker, records the accepted
    delivery and commit, and creates the next task only after the prior lane
    has a receipt. Hermes then fetches all refs again before the next lane.

The key separation is intentional: Hermes codes and reports evidence; Codex
audits, integrates, commits, pushes, and advances the plan. Neither agent
should do the other agent's stage or assume a transport flag means a stage
passed.

## Model-switch reminder

If Hermes begins acting as if it has forgotten the workflow, send this exact
reminder before assigning more work:

> Re-read HERMES_MANIFESTO.md, AGENTS.md, COMMANDS.md,
> LUNA_HANDOFF.md, the current-task marker, and the FT-HERMES protocol.
> You are the source-only coder for the one task in the current marker.
> Fetch all Git refs and verify the exact pinned commit. Do not read or revive
> historical lanes. Return one strict ACK with STATE READ or ACCEPTED before
> coding; after acceptance provide real PROGRESS and one strict DELIVERY or
> terminal BLOCKED. Work only in COPY_ROOT, publish every changed file under
> DELIVERY_ROOT, and never commit, push, deploy, migrate live data, touch
> credentials, or invent missing contracts. Codex will hash-audit, test,
> integrate, commit, push, and update the marker.

This reminder is a pointer back to the manifesto, not a new task and not an
authorization to bypass any current marker or acceptance gate.

## One active lane, explicit supersession

Only the task named by var/hermes-control/current-task.json is active.
Starting a new task requires a new task id, new task wire, exact source pin,
new copy/delivery roots, and a SUPERSEDES:<old wire> reason. A later message
does not supersede a lane merely because it appears newer.

Terminal lanes are historical. Do not reopen, re-run, re-publish, or mine them
for work. If a lane needs another attempt, Codex creates a fresh current task
with a new wire. The current marker is the only bridge-visible authority;
Hermes must not scan or infer work from the archive.

## Protocol is a hard gate

Use FT-HERMES/1 with CONTRACT: ACK-NACK-1.

- TASK is SEQ: 1, STATE: OPEN, NEXT_OWNER: HERMES.
- Hermes must return exactly one strict ACK with STATE: READ or
  STATE: ACCEPTED; STATE: ACK is invalid.
- A malformed reply gets one Codex RECEIPT/REJECTED with the exact
  RECEIPT_OF, REJECTED_WIRE, one concrete correction, and NEXT_OWNER: HERMES.
  Do not start coding from a malformed ACK.
- After acceptance, Hermes must send a real PROGRESS/IN_PROGRESS with a
  non-placeholder PROGRESS_EVIDENCE delta, then one DELIVERY/DELIVERED or
  terminal NACK/BLOCKED.
- Every Codex message ends exactly sincerely, Codex. Every Hermes message
  ends exactly sincerely, Hermes. There is one signature line only.
- No message may contain a date, time, timestamp, deadline, TTL, epoch, clock,
  or _AT coordination field. Logical sequence and exact wire correlation are
  sufficient.

## Delivery acceptance

Hermes delivery payloads must contain each of these exactly once:

ARTIFACT, SHA256, COMMAND, EXIT_CODE, TEST_RESULT, CHANGED_FILES,
SOURCE_REPO, SOURCE_REF, SOURCE_COMMIT, COPY_ROOT, DELIVERY_ROOT,
MANIFEST_SHA256, and LIVE_ACTIONS NONE.

The artifact and every changed source file must be present beneath the
declared delivery root and readable by Codex. Hashes are recomputed by Codex.
Test claims require exact commands and real exit codes. A prose summary,
manifest-only directory, omitted changed file, duplicate payload key,
lowercase signature, or missing dashboard/source file is a rejection—not a
partial acceptance.

## Waiting and progress discipline

Large source tasks normally need several minutes. Do not call a task stalled,
refused, stale, or complete from one poll or one transport flag.

1. After task publication, wait for the strict ACK.
2. After ACK, allow the coding window and perform at least five spaced,
   read-only polls before making a lane decision.
3. A poll records only observable state: reply wire/state, progress evidence,
   delivery-root contents, and marker consistency. Never use dates or file
   ordering.
4. No new task, local fallback, lane closure, or duplicate request is allowed
   during that observation window unless Hermes returns an explicit terminal
   NACK/BLOCKED or the owner changes scope.
5. After five polls, if there is still no valid progress or delivery, report
   the exact missing evidence and send one precise corrective/superseding task.
   Do not silently begin a competing implementation while Hermes is still the
   named owner.

## Scope boundary

The task's SCOPE, ACCEPTANCE, and DO_NOT_TOUCH lines are the contract.
Architecture reconciliation must identify the authoritative blueprint/spec,
the existing code path, the missing behavior, the user-visible entry point
when applicable, and a test that proves it. Do not invent provider contracts,
OAuth scopes, production credentials, migrations against live databases,
network rules, or deployment success.

No live action is implied by source work. Deployment, provider/OAuth
connections, production migrations, credential handling, service restarts,
WireGuard/VPN changes, and external publishing require separate explicit
authorization and separate evidence.

## Recovery rule

If Hermes loses context or switches models, it does not continue from memory.
It rereads this manifesto and the current marker, verifies the exact source
pin and task hash, acknowledges the current wire, and resumes only the named
lane. If that cannot be proven, it returns one terminal NACK/BLOCKED naming
the single blocker. It never resurrects historical lanes or guesses what
Codex meant.
