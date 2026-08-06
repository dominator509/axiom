# AXIOM Project Ledger
2026-07-29T17:53:00Z | DONE P0 - Foundation complete
2026-07-29T18:17:27Z | DONE P1 - Connectors & Network complete
2026-07-29T18:37:10Z | DONE P2 - Intelligence complete
2026-07-29T18:37:10Z | DONE P3 - Control & Learning complete
2026-07-29T18:48:42Z | DONE P4 - Surface complete
2026-07-30T01:30:33Z | FIX Discord env var wiring — APPLICATION_ID missing from server .env
2026-07-30T01:30:33Z | FIX Relay routing — double /api/v1 prefix corrected, routes mounted at /
2026-07-30T01:30:33Z | FIX API build — added @hono/node-server, @types/node, @axiom/relay deps, tsconfig references
2026-07-30T01:30:33Z | FIX Security — vitest 2.1.9→3.2.7 (CRITICAL CVE), drizzle-orm 0.36.0→0.45.2 (HIGH SQLi)
2026-07-30T01:30:33Z | AUDIT cargo-audit — installed v0.22.2, 0 vulnerabilities, 291 deps scanned
2026-07-30T01:30:33Z | FIX Clippy — 10 warnings resolved (redundant refs, io::Error::other, assert!, redundant closure, import, clippy.toml)
2026-07-30T01:30:33Z | TEST Rust — 25/25 passed, 7 suites
2026-07-30T01:30:33Z | TEST TypeScript — typecheck clean, build 10/10 packages
2026-07-30T01:30:33Z | TEST Live endpoints — health 200, relay card 200, incidents 200, metrics 200, viral exemplars 200, killswitch disabled
2026-07-30T01:30:33Z | TEST Discord adapter — initialized and logged in, bot token verified (72 chars)
2026-07-30T01:30:33Z | TEST Database — 15 tables, pgvector healthy
2026-07-30T01:30:33Z | GATE verify — preflight: ok, verify: ok
2026-07-31T22:10:41Z | OAuth hardening: Fanvue PKCE /authorize + state-validated callback, token persistence to .env, loopback-only bind (127.0.0.1:3001), systemd axiom-api.service, 9 vitest tests, uuid 11.1.1 + esbuild override (audit clean), secret-exposure audit clean
2026-07-31T23:02:14Z | L5.0 test matrix: 1033 vitest tests green across 9 TS packages (auth 6, api 95, connectors 243, db 83, fanvue-mcp 48, link-bio 33, llm-gateway 220, mcp-server 66, relay 239), tsc --noEmit clean all packages, 7 source bugs fixed by tests, pnpm audit clean, core types-only
2026-08-01T00:02:57Z | Schema alignment: job.attempts/max_attempts text->integer, viral_exemplar.embedding vector(1536) added to drizzle schema (migration 0000 truth); drift tests become alignment guards; 1034 tests green, preflight/verify ok
2026-08-01T00:51:48Z | LLM gateway integration: dotenv path fixed (../../../.env), Mistral/Lightning/Google(Gemini) providers registered + dispatched (chat+stream), router mounted at /api/v1/llm, structured JSON errors, aggregate fallback-chain error surfaces primary provider, 1049 tests green, live /providers + /chat verified
2026-08-01T01:50:28Z | LLM gateway live: DeepSeek key from Hermes config wired into .env (bashrc key was stale/invalid). Fixed empty-model bug (options.model ?? default -> || default) so defaultModel actually applies; deepseek default updated deepseek-chat->deepseek-v4-flash (API rejects old name). Live verified: GET /api/v1/llm/providers lists deepseek, POST /chat returns real v4-flash response, POST /chat/stream yields chunks
2026-08-01T04:54:48Z | [P2][M3] Mistral API key wired live: .env+bashrc+Hermes config; fixed stale gateway.test.ts ENV_KEYS (3 failing->232); 1049/1049 tests, typecheck/preflight/verify ok; commit ddedfd3
2026-08-02T00:02:46Z | [P2][M3] Gemini key wired live: .env+bashrc+Hermes config; default model gemini-2.0-flash->gemini-flash-latest (old retired, verified live 200); /chat + /chat/stream verified through API; 1049/1049 tests, gates ok
2026-08-06T05:44:55Z | [P2][M3] Lightning key wired live: .env (chmod 600); provider rewritten from dead OpenAI-style api.lightning.ai/v1/chat/completions (401 even with valid key) to Anthropic Messages protocol https://lightning.ai/v1/messages (Bearer auth, system hoisting, max_tokens default 1024, no temperature — claude-opus-4-7 rejects it); registry default lightning-v2->claude-opus-4-7 (live-verified model); SSE parser handles Anthropic content_block_delta; +2 tests, 1051/1051 green, typecheck/preflight/verify ok, /chat + /chat/stream verified live through API
2026-08-06T06:05:20Z | [P2][M3] Grok key wired live (.env chmod 600): provider was already correct (api.x.ai OpenAI-compat); default model grok-2-latest -> grok-3-latest (grok-2/grok-2-latest 400 Model not found; grok-3/grok-3-latest both 200 resolve to grok-4.3). Venice key REJECTED 401 (full + stripped label forms, all auth styles; /models public endpoint only) — key dead, provider default updated llama-3.1-70b/venice-xl -> venice-uncensored-1-2 (real model from live 108-model list). 1051/1051 tests, typecheck/preflight/verify ok, /chat + /chat/stream verified live for grok
