# Hermes source-task envelope template

This is the copy-paste contract for every new source-only Hermes lane. It is
part of the handoff protocol, not prose guidance. The local validator is
`scripts/hermes-protocol-check.mjs` and must pass before a message is sent.

## Transport

The JSON filename must equal `msg_id`. The JSON object contains exactly these
five fields and no others:

```json
{
  "msg_id": "codex-<lane>-<sequence>",
  "from": "codex",
  "sent_at": "1970-01-01T00:00:00Z",
  "subject": "<short subject>",
  "body": "<the signed FT-HERMES block>"
}
```

`sent_at` is a compatibility sentinel only. It is never compared, displayed,
or used for ordering. Ordering is `SEQ` plus exact `WIRE` correlation.

## TASK sent by Codex

```text
FT-HERMES/1
CONTRACT: ACK-NACK-1
TYPE: TASK
TASK: <stable-task-id>
WIRE: CODEX-<unique-wire>
SEQ: 1
IN_REPLY_TO: NONE
STATE: OPEN
TERMINAL: NO
NEXT_OWNER: HERMES
NEXT_ACTION: Create the exact source copy, implement only the named scope, run the named checks, and return one valid DELIVERY or terminal BLOCKED
REASON: NONE
PAYLOAD_SHA256: NONE
PAYLOAD:
READ_STATUS: NOT_APPLICABLE
SOURCE_REPO: github.com/dominator509/axiom
SOURCE_REF: refs/heads/codex/telegram-webhook-hardening
SOURCE_COMMIT: <40-lowercase-hex-commit>
SOURCE_SYNC_COMMAND: <exact fetch/clone command>
SOURCE_MIRROR_ROOT: <absolute mirror path>
SOURCE_MIRROR_LAYOUT: bare-mirror — refs/heads/*
SOURCE_REF_VERIFY_COMMAND: <exact command>
SOURCE_COMMIT_VERIFY_COMMAND: <exact command>
SOURCE_ANCESTRY_VERIFY_COMMAND: <exact command>
COPY_ROOT: <absolute writable source-copy path>
DELIVERY_ROOT: <absolute readable delivery path>
WORKTREE_KIND: source-copy — exact commit; never a moving branch checkout
SCOPE: <bounded file and behavior scope>
ACCEPTANCE: <bounded behavior and test criteria>
LIVE_ACTIONS: NONE
DO_NOT_TOUCH: installer, deployment, live or disposable database, migrations, providers, OAuth, credentials, permissions, systemd, network, runtime services, commit, push, generated output, and paths outside COPY_ROOT/DELIVERY_ROOT
sincerely, Codex
```

Hermes must answer exactly one correlated `ACK/READ` or `ACK/ACCEPTED` before
implementation. `ACK` is not a valid state; the only strict ACK states are
`READ` and `ACCEPTED`. An ACK has one `READ_STATUS: READ` payload field and one
canonical final `sincerely, Hermes` signature.

## Required DELIVERY shape

Hermes must not send prose reports or duplicate payload keys. The body must be
one flat block, validated before publication:

```text
FT-HERMES/1
CONTRACT: ACK-NACK-1
TYPE: DELIVERY
TASK: <same stable-task-id>
WIRE: HERMES-<new-unique-wire>
SEQ: <next logical sequence>
IN_REPLY_TO: <exact Codex WIRE being answered>
STATE: DELIVERED
TERMINAL: YES
NEXT_OWNER: CODEX
NEXT_ACTION: Independently hash-verify the manifest and changed source files, run the owning checks, and accept or reject this delivery
REASON: NONE
PAYLOAD_SHA256: NONE
PAYLOAD:
READ_STATUS: READ
ARTIFACT: <one manifest or archive path relative to DELIVERY_ROOT>
SHA256: <64 lowercase hex hash for ARTIFACT>
COMMAND: <exact command used to validate ARTIFACT>
EXIT_CODE: 0
TEST_RESULT: PASS
CHANGED_FILES: <bounded comma-separated list>
SOURCE_REPO: github.com/dominator509/axiom
SOURCE_REF: refs/heads/codex/telegram-webhook-hardening
SOURCE_COMMIT: <exact commit audited>
COPY_ROOT: <absolute source-copy path>
DELIVERY_ROOT: <absolute delivery path>
MANIFEST_SHA256: <64 lowercase hex hash>
LIVE_ACTIONS: NONE
sincerely, Hermes
```

`ARTIFACT`, `SHA256`, `COMMAND`, `EXIT_CODE`, `TEST_RESULT`, and
`LIVE_ACTIONS` are mandatory. Each appears exactly once. Per-file hashes belong
inside the referenced manifest; they are not repeated as duplicate payload
keys. A source DELIVERY without real command output and exit codes is not a
delivery. A second signature, lowercase signature, `STATE: ACK`, or prose-only
evidence is invalid.

## Codex audit and closure

Codex reads the exact delivery bytes as `codex-fanthynks`, recomputes all
hashes, reruns owning checks, and only then integrates, commits, pushes and
reads back the remote branch. A valid terminal Hermes reply is closed with:

```text
TYPE: RECEIPT
STATE: READ
TERMINAL: YES
NEXT_OWNER: NONE
PAYLOAD:
READ_STATUS: READ
RECEIPT_OF: <exact Hermes WIRE>
DELIVERY_ACCEPTED: YES|NO
LIVE_ACTIONS: NONE
```

If a malformed reply must be corrected, Codex sends one `RECEIPT/REJECTED`
with the exact `RECEIPT_OF`, a named `REASON`, `NEXT_OWNER: HERMES`, and one
concrete correction. If the source bytes are independently verified but the
transport remains malformed, Codex may integrate them as a clearly recorded
fallback and close the terminal reply with `DELIVERY_ACCEPTED: NO`; the
malformed envelope is never counted as Hermes acceptance.
