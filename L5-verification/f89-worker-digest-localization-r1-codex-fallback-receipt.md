# F89 worker digest localization — Codex fallback receipt

This receipt records the source decision after the Hermes transport correction.
It is not a claim that the malformed Hermes envelope was accepted.

## Source and transport

- Source baseline: `462cdaf31ee06e7263057df4489d7fbd14b4cd35`
- Hermes delivery root: `/srv/fanthynks-bridge/hermes/inbox/codex-f89-worker-digest-localization-r1-republish/delivery`
- Seven declared source files and `SHA256SUMS.txt` were fetched into the local review tree and independently matched byte-for-byte.
- The first Hermes DELIVERY reused `SEQ: 1` and was rejected.
- Hermes correction `SEQ: 4` used `STATE: ACK`, which fails the checked-in `ACK-NACK-1` validator; the validator reports `ACK must be READ or ACCEPTED`.
- Codex correction `SEQ: 5` was sent with a fresh WIRE and requires a republish-only DELIVERY at the next logical sequence. No source edit or test rerun is requested for that republish.

## Product integration decision

- `NO_HERMES_ARTIFACT_ACCEPTED: TRUE` — the transport envelope is not accepted as a valid DELIVERY.
- `CODEX_FALLBACK_INTEGRATION: TRUE` — the independently hash-verified source bytes were integrated locally because the protocol lane stalled at the malformed ACK.
- `HERMES_SOURCE_PROVENANCE: PRESERVED` — the exact delivery files, manifest and review evidence remain under `L5-verification/` and are not treated as a Git source authority.
- `LIVE_ACTIONS: NONE` — no deployment, installer, migration, database, provider, OAuth, credential, permission, network or service action occurred.

## Focused verification

- Core digest-card tests: `17/17`, exit `0`.
- Worker digest tests: `5/5`, exit `0`.
- Core build: exit `0`.
- Worker typecheck after rebuilding the core project reference: exit `0`.
- `git diff --check`: exit `0`.

## Integrated source slice

- `packages/core/src/digest-card.ts`
- `packages/core/src/digest-card.test.ts`
- `packages/core/src/index.ts`
- `packages/core/src/locale-catalogs.ts`
- `packages/core/src/locale.ts`
- `packages/worker/src/executors/digest.ts`
- `packages/worker/src/executors/digest.test.ts`

The worker now resolves the organization locale through the existing preference
contract and renders the durable digest card with catalog-backed copy,
locale-aware number formatting, and an explicit UTC date policy. Provider
platform names remain data and the card continues to record that no external
delivery was attempted.
