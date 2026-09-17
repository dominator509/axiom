# R2 verification route repair — M324

Outcome: **fixed in source**, not deployed or live-bucket verified.

The dashboard POSTed bucket verification to the configuration route, while the
gateway implements POST on `/subscriptions/grok/r2-storage/verify`. Its two storage
middleware registrations matched only the configuration route, leaving the nested
verification handler outside the local authentication/origin and no-store checks.
The production API has an outer authenticated role boundary; this is not evidence
of anonymous access to production credentials. An authenticated browser request
must nevertheless pass the same exact-origin guard before a bucket probe.

The narrow repair points the button to `/verify` and applies the existing storage
middleware to the storage subtree (including its root, as confirmed by Hono tests).
Save/read/delete semantics and credential isolation remain unchanged. No credentials,
provider requests or real bucket writes were used in this verification.

Regression-first evidence:

- Gateway test before fix: nested anonymous request returned 502 instead of 401;
  legitimate nested response lacked no-store. Two failures.
- Dashboard test before fix: exact requested URL omitted `/verify`. One failure.
- After fix: anonymous requests return 401; absent, foreign, opaque `null`, and
  lookalike origins return 403 with zero provider fetches. Valid-origin route test
  completes the captured write/read/delete transport and returns verified status.
- Existing encryption, user/workspace isolation, tamper rejection and root-route
  save/read/delete tests still pass.

Commands and results:

- `pnpm --filter @axiom/llm-gateway test -- src/grok-r2-storage.test.ts`: 7 passed.
- `pnpm --filter @axiom/dashboard test -- components/GrokR2Storage.test.tsx`: 3 passed.
- Both package `typecheck` commands: exit 0.
- Dashboard `lint`: exit 0, three pre-existing test warnings.
- `git diff --check`: exit 0.
- Full gateway `test`: sandbox run had four process-tree cleanup failures (370
  passed). Terminal run repeated with host process-control access: 374/374 passed,
  exit 0. No source changes between those runs.

Changed paths: gateway `src/routes.ts`, `src/grok-r2-storage.test.ts`; dashboard
`components/GrokR2Storage.tsx`, `components/GrokR2Storage.test.tsx`.

The fix-finding skill drove regression-first checks and equivalent-origin bypass
coverage. Deployment, authenticated browser acceptance and a real R2 probe remain
open. Separately, Creator Grok navigation/storage presentation is inconsistent
with scoped permissions and still needs reconciliation before role activation.
