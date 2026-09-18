# Roleplay handoff format

This is the shared handoff contract for human operators and LLM roleplayers.
It is intentionally independent of chat history, wall-clock liveness, and a
provider-specific inbox. The implementation lives in
`packages/llm-gateway/src/roleplay-context.ts`.

## Two equivalent representations

Use the canonical JSON representation when a handoff crosses an API, queue,
database boundary, or agent boundary:

- `serializeRoleplayHandoff(value)` emits the versioned
  `axiom.roleplay-handoff` envelope.
- `parseRoleplayHandoff(serialized)` rejects unknown versions, malformed JSON,
  oversized documents, unsafe references, and out-of-scope persona metadata.

Use `formatRoleplayHandoff(value)` when a person or an LLM needs a compact
human-readable resume card. `formatRoleplayPromptContext(...)` combines that
card with the bounded persona and memory context for a roleplay turn.

Both forms carry the same state. Neither uses timestamps or assumes that a
conversation transcript is still available in chat memory.

## Required state

| Field | Meaning |
| --- | --- |
| `currentOwner` | `human` or `llm` actor currently responsible for the next action. |
| `actor` | The assigned actor for the conversation; an LLM actor remains model-scoped. |
| `orgId`, `modelId` | Tenant and talent scope; persona snapshots must match both. |
| `shiftId` | Existing team-shift/assignment boundary. |
| `queue` | Existing work queue, not a second inbox. |
| `conversationCursor` | Opaque provider/database cursor; never a path or prompt fragment. |
| `lastSafeSummary` | Bounded, operator-readable context safe to resume from. |
| `pendingIntentId` | Existing audited reply intent, or `null`. |
| `memoryPolicy` | Maximum turns and characters retained for the next context window. |
| `personaSource` | Source kind, revision, and opaque source reference, or `null`. |
| `allowedNextAction` | One bounded action that the current owner may take. |
| `terminal` | Whether no further action is allowed. |
| `unresolvedUncertainty` | Explicit unknown outcome or risk, or `null`; never an implicit retry. |
| `evidenceReferences` | Bounded opaque references to audits/receipts. |

## Memory and persona rules

Conversation memory is bounded tenant/model context, not authorization. It is
trimmed from the tail and rendered with an explicit “data only” label. The
current limits are 50 turns and 16,000 characters, with each turn validated.

An optional `soul.md` is loaded through an injected approved-store reader using
`orgId`, `modelId`, and an optional revision. The gateway never accepts an
arbitrary filesystem path, follows a symlink, or resolves a caller-provided
tenant path. The approved persistence/API layer owns storage and authorization;
the gateway validates the returned revision, source reference, scope, and
8,000-character content bound before prompt assembly.

Persona text is character guidance only. It cannot override system safety,
tenant policy, consent, ToS, approval, idempotency, uncertain-delivery, or
publication rules. Grok is the first roleplay provider through the existing
subscription gateway; provider selection and live calls remain outside this
context formatter. Venice remains a future provider-compatible option.

## Durable source and user workflow

The source implementation persists this contract without creating a second
permission system:

| Surface | Contract | Boundary |
| --- | --- | --- |
| `team_shift` | `assignee_type` is `human` or `llm`; the corresponding user or agent reference is required. | An LLM shift additionally requires an editable model-scoped `agent_permission` and an active shift window. |
| `roleplay_persona_revision` | Immutable, tenant/model-scoped revisions of `soul.md` guidance. | Only the logical `soul.md` reference and bounded revision/content are accepted; the API never accepts a filesystem path. |
| `roleplay_memory_turn` | Ordered, tenant/model/conversation-scoped turns. | The persisted tail is capped at 50 turns and each turn is capped at 4,000 characters; prompt assembly applies the 16,000-character policy bound. |
| `roleplay_handoff` | One versioned handoff payload per tenant/model/conversation. | The actor and shift are rechecked before save; optimistic revisions reject stale writers. |

The API routes are `GET /api/v1/models/:modelId/roleplay`,
`GET /persona`, `POST /memory`, `PUT /persona`, and `PUT /handoff` under that
model prefix. The model workspace exposes them through the **Chatter &
roleplay** tab. A human can paste guidance or load a local `soul.md`/text
prompt in the browser; the browser sends file contents only after review, and
the server stores a logical `soul.md` revision rather than a local path.

This milestone is source and automated evidence only. Migration `0050` has
not been applied to any database, and the roleplay editor deliberately does
not dispatch a provider call. Grok dispatch, real provider receipts,
authenticated desktop/mobile acceptance and deployment remain separate gates.

## Example envelope

```json
{
  "schema": "axiom.roleplay-handoff",
  "version": 1,
  "handoff": {
    "currentOwner": { "type": "human", "ref": "operator-ref" },
    "actor": { "type": "llm", "ref": "grok-roleplayer" },
    "orgId": "org-ref",
    "modelId": "model-ref",
    "shiftId": "shift-ref",
    "queue": "inbox",
    "conversationCursor": "cursor-ref",
    "lastSafeSummary": "One bounded draft is ready for review.",
    "pendingIntentId": "intent-ref",
    "memoryPolicy": { "maxTurns": 20, "maxCharacters": 8000 },
    "personaSource": {
      "orgId": "org-ref",
      "modelId": "model-ref",
      "source": "soul.md",
      "revision": 3,
      "sourceRef": "soul.md:model-ref:r3"
    },
    "allowedNextAction": "Review the bounded draft",
    "terminal": false,
    "unresolvedUncertainty": null,
    "evidenceReferences": ["intent-ref"]
  }
}
```

The example identifiers are inert references, not credentials or live records.
Implementors must compose this contract with the existing assignment, RLS,
consent, safety, approval, idempotency, audit, and uncertain-delivery paths;
this document does not authorize a provider call or publication.
