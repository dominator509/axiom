# Braces depth mitigation

`braces@3.0.3.patch` applies only the five runtime files from
https://github.com/micromatch/braces/pull/72 at immutable upstream commit
`28d440b5dd449dbf1fe6f3506cf94ecca4d02660`.
The proposal is unmerged and npm still publishes 3.0.3. This is a maintained
local mitigation of GHSA-vfj7-8cjw-p6xm, not a claim of an upstream fixed release
or an accepted vulnerability exception. Replace it when a verified upstream
release is available.

Parsing limits combined brace/parenthesis nesting to 100. Compile, expand and
stringify also check caller-supplied AST depth. Expansion rejects cyclic parent
chains. The limit cannot be raised through maxDepth; callers may lower it.
Inputs deeper than 100 now throw a deliberate validation error. Ordinary glob
semantics and escapeInvalid behavior remain covered by regression tests.

`pnpm install --frozen-lockfile` binds the patch through the pnpm lock hash.
`node scripts/check-braces-patch.mjs` enumerates every active braces dependency
using pnpm, verifies its exact version and the normalized SHA-256 hashes of all
five patched files, then runs 39 behavioral checks per distinct installation.
Unknown, absent, changed or unpatched installations fail closed. Hashes and
upstream provenance are recorded in `braces-security-source.json`.

The audit runs this verification before recognizing the exact braces advisory
as locally mitigated. Its high/critical threshold and the existing, separate
node-forge exception are unchanged. The registry still reports this advisory;
do not describe it as absent from raw `pnpm audit` output.

Initial Node 22.23.3 comparison used the same 39 checks: pristine installed
3.0.3 had 11 passing and 28 failing; the pinned candidate had 39 passing and
zero failing/skipped. Full repository and container acceptance must also pass
on the AXIOM commit carrying this patch before this lane can be accepted.
