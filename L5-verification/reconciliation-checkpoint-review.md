# Uncommitted feature reconciliation checkpoint review

This checkpoint preserves the accumulated API, database, worker and dashboard implementation, including migrations 0027 through 0034. It is a source checkpoint, not a deployment or production acceptance receipt.

Review findings requiring follow-up:

- Media transforms validate the bounded service receipt and exact output key, then copy/hash/validate the actual output into tenant-scoped durable storage before recording a library asset and variant link. Completed operation results have authenticated previews for editors and readers, including WebM; source approval is not inherited. Migration 0035 adds the output link and transformed origin. 65 focused storage/executor/API/UI tests and DB/worker build plus worker/API/dashboard typechecks pass. Live migration, actual media-service transform, browser playback, legacy-variant reconciliation and approval reuse remain open. Intermediate files and unreferenced copies after retries require storage reconciliation/retention work.
- Image transform bounds are enforced at both API and Rust execution boundaries: source-contained crops, nonzero dimensions, 16384 per-axis ceiling and conservative decoded-output allocation budget. Eight API tests and API typecheck pass; media-plane suite has 13 passing tests and one explicitly ignored FFmpeg rehearsal. This does not establish output metadata integrity, variant preview or approval usability.

- Variant outcome follow-up: summaries now use outcomeAt and include conversion counts. Recording first verifies experiment organization/model, then locks the assignment with SELECT FOR UPDATE; identical repeats preserve timestamps. Four route tests and API typecheck pass. Live PostgreSQL concurrency/tenant enforcement and conversion display in the GUI remain open.
- Scraper response consumption now uses the shared bounded streaming reader at 512 KB with a 30-second body deadline, cancels HTTP-error bodies and rejects malformed/empty envelopes without echoing response content. Nine focused tests and worker typecheck pass. Provider-specific response contracts and model egress routing still require verification.
- Scrape/media failure recovery now updates operation state inside the lease-checked job recovery transaction: queued on retry, failed on terminal failure, completed rows preserved. Sixteen worker tests and typecheck pass; real PostgreSQL rollback/lease-race rehearsal and deployed GUI failure visibility remain open.
- The reconciliation plan's earlier source-complete/test assertions need evidence review for the new feature routes; typechecking does not prove functional completeness.

Current verification:

- Saved-media reuse is implemented through the existing protected/idempotent bundle POST. Owned JPEG/PNG/MP4 bytes are checked before a new pending bundle and tos.scan job are inserted in one transaction. The library exposes caption/destination entry and stable retry handling; WebM directs the user to MP4 adaptation. 146 API/middleware tests and five dashboard tests pass. Real transaction rollback, deployed browser acceptance and completed scan-to-approval remain unverified.

- WireGuard importer/credentials: 21 focused tests passed and dashboard typecheck passed before checkpoint review.
- Workspace test command reaches the dashboard prerequisite build, which fails because API_ORIGIN is not configured for production. This is an environment prerequisite, not a successful full test run.
- DB tests reported 140 passed and 12 skipped during that run. Skipped runtime checks remain open.
- Full workspace typecheck passed: 22/22 Turbo tasks, including prerequisite builds (14 cached).
- Full workspace test command exited 1. In addition to missing API_ORIGIN, subscription process-lifecycle tests reported four failures and EPERM cleanup errors. LLM gateway reported 366 passed / 4 failed. These need diagnosis; this checkpoint does not classify their cause as proven environmental.

No live migration, deployment, social publication or provider generation is authorized by this checkpoint commit itself.
