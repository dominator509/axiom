RESULT [grok] - AXIOM dashboard usability audit + UI polish PR

## Status recommendation
**status:done** — open UI-only PR + prioritized audit findings. Not blocked.

## Part 1 – Usability audit findings

Scope exercised:
- Live logged-out only at https://test.fanthynks.com (`/` → `/login`, `/signup` → `/login`) at 1440px and ~375px.
- Local polished login (`pnpm dev` on packages/dashboard) for after shots.
- Logged-in flows: **code review only** (no seed DB / credentials; did not create accounts or touch live data).

Screenshots (worker box):
- Before live: `/workspace/ops-hub-13/desktop/02-login.png`, `/workspace/ops-hub-13/mobile/02-login.png`, `/workspace/ops-hub-13/mobile/02-login-full.png`
- After local: `/workspace/ops-hub-13/after/desktop-login.png`, `/workspace/ops-hub-13/after/mobile-login.png`
Drive folder: https://drive.google.com/drive/folders/1DSAAzeLYNeWl2zUO4n6-oD_oaW3dAZ6Z
Audit notes doc: https://docs.google.com/document/d/14XRIB-5vNCESbMhW3V9skmfUIby08NFKhTD-jnkaaO0/edit

### P1
1. **Mobile login CTA below the fold** — `/login` @ ~375×812: hero + fields fill the first viewport; Sign in (and live Create-account CTA) require scroll. **Fix:** tighten mobile story/panel padding (shipped in PR).
2. **Identical primary weight for Sign in vs Create account (live deploy)** — both full pink `.btn` on test.fanthynks.com. Confusing hierarchy for first-time vs returning users. **Fix:** secondary should use `.btn.secondary` (CSS helper shipped; live FanThynks create-account button is deploy-only, not on `main` LoginForm — left for product/auth owner).

### P2
3. **No public signup route** — `/signup` 307 → `/login`. New users have no dedicated signed-out signup page on live. **Fix:** product decision (auth out of scope); until then clarify copy / secondary CTA styling.
4. **Empty/error states inconsistent** — Audit/Incidents/Killswitch used bare muted paragraphs or inline `color: var(--bad)`; empty tables still rendered. Confusing vs Home’s richer empty-state. **Fix:** shared `empty-state` / `notice error` on audit, killswitch, home hint, model-not-found (shipped; incidents skipped due to PR #17 overlap).
5. **Kill-switch banner shouty / no action** — ALL-CAPS banner with no link to Safety. **Fix:** clearer copy + link to `/killswitch` (shipped).
6. **New talent modal: Create before Cancel; no busy state** — easy misclick; no disabled/“Creating…” feedback. **Fix:** Cancel secondary then Create, busy disable (shipped).

### P3
7. **Low-contrast footnote / placeholders** on login — hard to read on dark panel. **Fix:** bumped footnote/placeholder contrast tokens (shipped).
8. **Placeholder `operator@axiom.local`** on live — looks like a default account / leaks internal naming. **Fix:** neutral `you@studio.com` on `main` LoginForm (shipped).
9. **Tables on narrow screens** — horizontal overflow without clear wrap. **Fix:** `.table-wrap` + min-width (shipped on audit).
10. **Live branding FanThynks vs repo AXIOM** — deploy/rebrand drift (F mark + Create FanThynks account). Not a code bug on `main`; note for Instinct.
11. **Signed-out “landing” is just login** — `/` redirects; no marketing landing. Product choice; no polish change.

### Not exercised live (logged-in)
Nav, model tabs, create/edit forms with real API data, settings, empty/loading against seed DB. Code review covered structure (sidebar/mobile nav, ModelTabs horizontal scroll, NewModelForm modal, GenerateForm busy/error patterns).

## Part 2 – Polish PR
- **PR:** https://github.com/dominator509/axiom/pull/30
- **Branch:** `grok/ui-polish-ops-hub-13`
- **CI run:** https://github.com/dominator509/axiom/actions/runs/35977816308
  - ✅ lint, typecheck, build
  - ❌ security (pre-existing pnpm/cargo audit vulns; dep upgrades forbidden)
  - ❌ test/container canceled after security fail; `@axiom/dashboard:test` passed in log; local dashboard lint/typecheck/test green

### Files changed (9)
- `packages/dashboard/app/globals.css`
- `packages/dashboard/app/login/page.tsx`
- `packages/dashboard/components/LoginForm.tsx`
- `packages/dashboard/components/NewModelForm.tsx`
- `packages/dashboard/app/page.tsx`
- `packages/dashboard/app/audit/page.tsx`
- `packages/dashboard/app/killswitch/page.tsx`
- `packages/dashboard/components/KillSwitchBanner.tsx`
- `packages/dashboard/app/models/[id]/page.tsx`

### Findings not fixed (and why)
- Live dual Sign-in/Create CTA on FanThynks deploy — auth/product surface; not on `main` LoginForm; no auth changes.
- Dedicated signup flow — auth out of scope.
- Incidents empty/error polish — **overlap with open PR #17** (`incidents/page.tsx`); skipped.
- Logged-in visual polish / loading skeletons wired into pages — needs seed/local stack; skeleton CSS utility added only.
- Dependency vulns failing security CI — upgrades forbidden by guardrails.
- `layout.tsx` / `NavLinks` — touched by open PRs; avoided.

### Overlap with #16–#29
None of the 9 PR files are in the heavy-change set. Closest avoided files: `layout.tsx` + `incidents/page.tsx` (PR #17), Linkbio/analytics/Provider panels (#20–#29).

### Guardrails
No auth/middleware/session, no schema/API, no new deps, no deploy/CI/env edits, no live account creation, PR not merged.
