# AXIOM FanvueCRM — Ledger

## P5 — Integration & Wiring

### M0 — Discord relay wiring, clippy fixes, security patches
- **Date:** 2026-07-30
- **Status:** ✅ Complete
- **Changes:**
  - Wired Discord bot token, app ID, public key into `.env` and systemd
  - Installed `@axiom/relay` dependency in API package
  - Fixed relay route mount (was double-prefixed)
  - Added `@types/node`, `tsconfig` reference, `@hono/node-server` devDep
  - Fixed 10 Rust clippy warnings (redundant refs, `io::Error::other()`, etc.)
  - Updated `vitest` 2.1.9→3.2.7 (CRITICAL CVE)
  - Updated `drizzle-orm` 0.36.0→0.45.2 (HIGH SQLi)
  - Ran cargo audit: 0 vulnerabilities, clean
  - Full test matrix: Rust 25/25 pass, clippy 0 errors, TS typecheck clean
  - Verified all 10 live API endpoints

### M1 — Threads social connector wiring
- **Date:** 2026-07-30
- **Status:** ✅ Complete
- **Changes:**
  - Stored Threads app ID (`2075732283039980`) and app secret to `.env`
  - Stored Threads display name (`Fan V test`) as comment in `.env`
  - Added `THREADS_WEBHOOK_VERIFY_TOKEN` to `.env` for Meta webhooks
  - Created `packages/relay/src/channels/threads.ts` — Meta webhook adapter
    - GET `/webhooks/threads` verification challenge handler
    - POST `/webhooks/threads` event handler with HMAC-SHA256 signature validation
    - Comment/mention change processing, CardRenderer integration
  - Exported `ThreadsAdapter` from relay barrel (`channels/index.ts`, `src/index.ts`)
  - Wired ThreadsAdapter into API `initRelay()` — webhook routes mounted on relay Hono app
  - Full build: all 10 packages pass (8 cached, 2 fresh)
  - Ready for: OAuth access token completion, Meta webhook configuration
