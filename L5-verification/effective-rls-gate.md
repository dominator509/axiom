# Effective tenant RLS gate

Baseline main: `79167310aecd2ee4d9439eda191bdc4acc9f59ad`,
[CI 37165632873](https://github.com/dominator509/axiom/actions/runs/37165632873):
8 successful jobs, 0 failed/cancelled. That CI counted source statements and
did not detect the locale INSERT policy composition failure.

## Change and scope

The gate now derives 74 tenant tables from Drizzle schema exports. The existing
14 global exceptions (authentication identities, global capability revocation,
platform affiliate acquisition) are shared with the source-migration regression;
none was added. It inspects the migrated public catalog for real tables, enabled
and forced RLS, an applicable all-command org_isolation policy, and the absence
of additional applicable permissive policies. The actual runtime connection must
be neither superuser nor BYPASSRLS, cannot inherit membership of an elevated role,
and cannot own the protected tables.

PostgreSQL combines permissive policies with OR. Migration 0053 added an INSERT
policy whose organization-default branch was true regardless of org context.
The application role could therefore insert into another organization, write a
preference for another user, and insert without a tenant context. Migration 0077
recreates only that policy as RESTRICTIVE; it now intersects with org_isolation.
Existing migrations/checksums, grants and legitimate locale behavior are retained.
The API already supplies the user context needed by the restrictive check.

No SQL has been executed on an owner, shared, recovery or production database.
The new migration is tested only in disposable fixtures; merge does not authorize
applying it to an existing deployment.

## Reproduction and validation

Run `node scripts/rehearse-rls-catalog.mjs --isolated-fixture` from a clean committed
checkout using Node 22.23.3 and pnpm 9.14.0. On Windows the harness invokes the
selected Node distribution's Corepack directly so a global pnpm.cmd cannot switch
back to its adjacent Node 24 binary.

The harness builds the committed schema, archives the exact migration source,
creates a labeled network-disabled PostgreSQL container with no bind mounts or
published ports, and applies the real migration runner twice. The database image
is pinned to `timescale/timescaledb:2.29.2-pg16@sha256:289d55704b1b3ee8263cd3805c6930f9cd54506835a8f19f9b85dad17d5c5a8a`.
It never reads .env or uses an existing database URL. Inspection output omits
environment values; cleanup verifies ownership and removes the immutable container
ID and its anonymous volumes. Receipts and private logs are under ignored
`var/rls-rehearsal/<id>/`.

The twenty assertion groups include a real app-role catalog read, nine rollback-only
negative controls, restored-catalog verification, eight locale behavior cases,
and fixture rollback verification. Negative controls require a passing baseline
before testing the fault; an already-unsafe catalog cannot yield false-positive
fault-detection results. Read/update invisibility and explicit DELETE privilege
denial are separate assertions within the foreign-row behavior case.

Before-fix hosted regression head: `e42a79974ed5247a664ff06a4ef163a902926abd`.
The [test job in CI 37166986531](https://github.com/dominator509/axiom/actions/runs/37166986531/job/111331844661)
ran the exact command above and reported **5 passed/15 failed/0 skipped**, with
cleanup verified. Actions checked out integration commit
`2be7f4f50c989beff944a2bd94cd96e3beef199b`, recorded in the receipt itself; the PR
head and tested integration SHA are deliberately distinguished. Eleven failures
are the unsafe catalog and the safe-baseline prerequisite of its fault controls;
four are the denied-write assertions that the permissive policy violates.
An initial local iteration also had an incorrectly specified DELETE expectation;
that was corrected before this hosted regression head, without granting DELETE.

At fix commit `4622d742dc2e773316feefc3db3cd49d07ceb9d3`, the unchanged security
assertions run with the corrected DELETE contract reported 20 passed/0 failed/0
skipped locally on Node 22.23.3; cleanup succeeded. Focused source-migration/API
locale tests reported 34 passed/0 failed/0 skipped. Final hosted receipts and
post-merge verification are required before this readiness item is accepted.

The post-merge receipt is now available at main SHA
`d8bfb217b4549e8b53c513de71fd92c1ea499c95`: [CI run 37211855138](https://github.com/dominator509/axiom/actions/runs/37211855138),
[test job 111464478851](https://github.com/dominator509/axiom/actions/runs/37211855138/job/111464478851).
The exact `node scripts/rehearse-rls-catalog.mjs --isolated-fixture` step used
Node 22.23.3 and reported **20 passed/0 failed/0 skipped**, with cleanup verified.
The lane's evidence register records this result and its raw job-log digest.
The Windows local attempt did not run the fixture: its Node 24.14.1 failed the
pinned-version guard before Docker or PostgreSQL started; it is not counted as
an acceptance result.

## Limits

Catalog flags and policy composition do not prove arbitrary policy-expression
semantics. The existing database-backed cross-tenant suite remains required;
the new behavioral matrix specifically covers locale preferences. It does not
claim exhaustive CRUD fixtures for every schema table, deployed-state inspection,
owner database remediation, provider acceptance or full L5 release approval.
