# Startup readiness against a fresh database

The catalog rehearsal executes the application's compiled `assertDatabaseReady`
function against a fully migrated PostgreSQL container owned by that run. Its
query runs as `axiom_app` and derives required columns from the compiled schema.
It reads catalog metadata and privileges, not tenant rows.

Five cases formerly lived in `readiness.integration.test.ts`, gated by
`AXIOM_READINESS_FIXTURE` and a hard-coded historical container. They now execute
in CI's existing isolated catalog job:

1. Accept the migrated schema under the runtime role.
2. Reject an empty public schema.
3. Reject a missing required table.
4. Reject a missing required column.
5. Reject a missing SELECT grant.

Each fault runs in a transaction that rolls back, then the actual readiness
function must accept the restored catalog. Async checks are awaited before
recording success. SQL execution errors cannot masquerade as the expected
`Database schema is not ready` rejection. The same source-bound receipt records
these named assertions, existing RLS/tenant checks, failures, skips and cleanup.

Run `node scripts/rehearse-rls-catalog.mjs --isolated-fixture` with pinned Node and
a clean committed checkout. The documented `test-isolated-workspace.mjs
--isolated-fixture --database-readiness` entry point forwards to this harness
before inspecting any historical container. Other legacy workspace modes are
outside this change.

The harness uses a pinned image, generated fixture credentials, no network,
host mounts or published ports, and ownership-checked cleanup. It never loads
`.env`, an existing database URL, customer data or provider credentials.
This is startup schema/privilege and isolation evidence, not owner deployment,
provider acceptance, backup integrity or release approval.
