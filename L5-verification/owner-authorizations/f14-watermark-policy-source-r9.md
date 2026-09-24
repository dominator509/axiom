# Owner authorization: F-14 watermark-policy source lane

This is a repository authorization record for source-only work. It does not
authorize deployment, migration execution, provider access, credential access,
permission changes, or runtime actions.

`AUTHORIZATION_STATUS: APPROVED`

`OWNER: Dominic Sarria-Wiley (repository owner)`

`AUTHORIZATION_BASIS: The owner directly instructed Codex in the current task to reconcile the Codex/Hermes coding loop, use Hermes for bulk coding, keep Codex as audit/integration owner, and continue the remaining architecture feature work without drift. F-14 is the currently selected feature lane in the canonical LUNA_HANDOFF.`

`SOLE_WRITER: HERMES`

`CODEX_ROLE: Audit the isolated delivery, run the repository gates, integrate only a passing delivery, commit and push the reviewed result. Codex does not edit the Hermes copy while this lane is active.`

`WRITABLE_COPY_ROOT: /srv/fanthynks-bridge/hermes/codex-f14-watermark-policy-source-r10`

`DELIVERY_ROOT: /srv/fanthynks-bridge/hermes/deliveries/codex-f14-watermark-policy-source-r10`

`SCHEMA_SOURCE_POLICY: Hermes may author the source migration and matching packages/db/src/schema changes required by the existing F-14 persistence contract inside the isolated copy only. The migration is source-only and must never be executed by Hermes or Codex as part of this lane.`

`APPLICATION_SOURCE_POLICY: Hermes may edit the existing packages/api, packages/dashboard and crates/media-plane F-14 paths in the isolated copy only. Reuse existing org/model/asset/media-operation ownership, RLS, idempotency and approval contracts; do not create parallel media state.`

`DELIVERY_REQUIREMENT: Return one evidence-bearing PROGRESS and one flat hash-verifiable DELIVERY or one terminal BLOCKED result. Codex must independently audit every declared byte and gate before integration.`

`NO_LIVE_ACTIONS: TRUE`

`RECORDED_BY: Codex from the owner instruction above; this record is not a cryptographic owner signature and must not be treated as one for any other lane.`
