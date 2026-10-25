# Zod bounded-collection backport

`GHSA-mrhx-c7xc-m3w5` affects the installed Zod 3.25.76 and 4.4.3.
Upstream fixes v4 in 4.6.6. The application and zod-to-json-schema still use
v3 APIs, so v4 is upgraded while v3 receives a source-verified backport.

Reference: [upstream collection-size fix](https://github.com/colinhacks/zod/commit/a0ebf97)
and [advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).
Oversized arrays/sets must fail their upper bound before allocating per-element
results or invoking element refinements. The package also ships an older v4
interpreter: its leading array/set/map size checks receive the same protection,
including the mini entry point. A preceding overwrite still runs before a later
bound, preserving transform order. No implicit limit is added to schemas that
have no upper bound; request/body-size limits remain necessary.

The patch includes distributed CJS/ESM and corresponding TypeScript source.
Public v3 types and validator APIs remain unchanged. Oversized collections now
return the size error without accumulating element errors, which is the intended
security behavior change. Valid collections, lower-bound failures, nested issue
paths and asynchronous parsing are covered by regressions.

`node scripts/check-zod-size-patch.mjs` enumerates active dependency paths,
requires the exact v3 version and pinned source hashes, tests all public runtime
families, reverses the patch in an owned temporary copy and requires that
original-source control to fail. Copies are removed in `finally`. Any failed
enumeration, unexpected version, source mismatch, regression or negative control
blocks audit recognition. The audit only recognizes the exact advisory for
findings whose versions are all 3.25.76; this is not an upstream-risk exception.
Upstream v4 is pinned to 4.6.6 and is still checked by the public advisory feed.

Remove this backport and its audit recognition when the remaining v3 consumers
can use an upstream-patched API without breaking their schema contracts.
