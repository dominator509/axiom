# F-90 FanThynks platform affiliate/referral license and security review

Status: source-level review recorded; human/legal, browser, migration and runtime acceptance remain open.

## Scope

F-90 is the FanThynks/Axiom SaaS acquisition program. Partners refer creators to
FanThynks and receive attributable commissions. It is not a tenant-facing
affiliate builder, a creator referral feature, provider-earnings referral state,
or a resale/white-label control plane.

## Import decision

The implementation in this checkout is native. No OpenPartner, Refferq or RefKit
package, source tree, SDK, or runtime dependency is present in `package.json`,
`pnpm-lock.yaml`, or `packages/`. The repository-wide source audit command was:

```text
rtk rg -n -i "openpartner|refferq|refkit" package.json pnpm-lock.yaml packages L5-verification --glob '!**/node_modules/**' --glob '!**/.next/**'
```

The only matches are architecture and execution-plan references to candidate
evaluation. That is evidence that no candidate code was imported; it is not a
security certification of any upstream project.

The architecture records OpenPartner and Refferq as MIT candidates and RefKit's
application as AGPL-3.0 with a separate MIT SDK/CLI/MCP split. Those findings
permit further legal review but do not prove dependency, SBOM, vulnerability,
authentication, webhook, payout, or operational hardening. The stronger
"already made and hardened" requirement was not met by available evidence, so
the native implementation is the accepted engineering direction. No imported
license obligations are introduced by the current source.

## Source security boundary reviewed

- The database contract is platform-scoped and separate from provider earnings
  `referrals` state.
- The API mounts the affiliate router behind authentication and owner-only
  authorization; partner and creator tenants do not receive this control plane.
- Mutation paths use the existing idempotency middleware and route-level audit
  keys.
- Attribution and conversion writes use immutable event keys; conversion
  reconciliation is retry-safe and refund/reversal-aware at the source-contract
  level.
- Payout output is an explicitly non-transfer CSV export. The route emits
  `X-Fanthynks-Payout-Transfer: none`; it does not call a payment provider.
- Partner activation requires disclosure acceptance. Holds are operator-resolved
  and audited.
- The dashboard is owner-only and exposes partner, campaign, report, export and
  hold controls through the same API contract.

## Evidence completed

- Native schema, API and dashboard implementation exists in the current source.
- Focused DB schema/migration tests, API route behavior tests, middleware tests,
  dashboard interaction tests and production builds pass as recorded in the
  current handoff.
- No live migration, payout, provider, deployment, credential or browser action
  is claimed by this document.

## Remaining acceptance gates

1. Human/legal review of the platform affiliate terms, disclosures, commission
   policy, tax/consumer obligations and the final commercial license posture.
2. Independent dependency/SBOM and security review of the native implementation.
3. Browser acceptance on desktop and mobile for owner navigation, partner
   onboarding, disclosure gating, campaign/report, export and hold resolution.
4. Migration rehearsal and runtime acceptance for migration 0054; it is authored
   only and has not been applied to a live database.
5. Provider/payment integration remains intentionally absent until an explicit
   reviewed payout adapter and owner-approved operational boundary exist.

Conclusion: the current source has a defensible native license/import decision
and functional source-level controls, but F-90 is not production-accepted until
the remaining legal, security, browser, migration and runtime gates pass.
