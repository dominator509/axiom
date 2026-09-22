# F-02 / F-04 / F-43 — M990 runtime acceptance

## Verdict

**Isolated Linux sidecar acceptance: PASS. Full feature/production acceptance:
OPEN.** This is not a deployment receipt, an all-caller isolation proof, or a
statement that these three features are complete.

Authority: `L1-product/L1.1-feature-catalog.md`,
`L2-architecture/L2.6-network-isolation-failclosed.md`,
`L2-architecture/L2.12-security-architecture.md`, and
`L4-execution/L4.2-execplan-p1-connectors-network.md`. Existing phase markers
and `verify: ok` do not override the outstanding requirements below.

Base revision: `a0af08b29595108d13078a22f3283eb5af53c2cf`.
Implementation milestone: `[AXIOM][P1][M990]` (use its Git commit, not a moving
branch tip, to reproduce). Unrelated viral-insight and historical Hermes
changes in the workspace are excluded from this milestone. Hermes remains
disabled.

## Implemented and tested

| Requirement | Change and executed evidence |
| --- | --- |
| Explicit configuration; no silent direct fallback | Missing API `egressMode` returns 400. Missing/invalid sidecar upstream aborts. Explicit direct remains distinguishable from missing configuration. |
| Real HTTPS upstream proxy | TLS certificate and hostname validation before CONNECT; private CA support without verification bypass. Trusted TLS passes; untrusted CA and wrong hostname fail. A 407 reason containing `200` cannot pass the status parser. |
| Selective kernel boundary | IPv4 and IPv6 default-deny INPUT/OUTPUT/FORWARD, blackhole defaults, exact resolved proxy IP/port/protocol, tunnel-interface-only traffic. Real proxy traffic passes while host-port, UDP, cross-model and connected IPv6 canaries are denied. |
| Real WireGuard | Generated test keys, actual kernel handshake, and echo of the actual observed peer address. Taking down the peer makes the path unhealthy without falling back to the parent network. |
| Accurate proxy handshake | HTTP CONNECT and SOCKS success responses are sent only after upstream connection succeeds. Authentication failure and dead targets do not receive success. IPv4/IPv6 SOCKS addresses and variable reply tails are parsed explicitly. |
| Unprivileged data plane | Sidecar capability sets, including bounding/ambient/inheritable, are zero; `NoNewPrivs=1`. DB credentials and the vault DEK are not inherited. The privileged test controller is separate from this assertion. |
| Lifecycle and kill switch | Bind/sync/health changes are serialized. The child handle remains registered across health-probe I/O so drain can kill it; a held probe cannot resurrect a drained binding. Reserved subnets are released on failure/drain. |
| Continuing health checks | Bounded configurable `EGRESS_HEALTH_INTERVAL_SECS` (default 30; valid 1–3600), real echo parsing, bounded body/status/redirect checks, approved-only failover. A running monitor detects a failed echo without an operator request. |
| Secret-safe handling | Sensitive tracing arguments are skipped, upstream debug output is redacted, and additional credential/decrypted buffers are zeroized. A captured tracing test includes a positive logging control and rejects key/envelope fields. This is not a claim that every temporary credential copy in every process has been audited. |
| Proxy performance | Transport clients are reused by exact proxy/timeout, never by cached health results. Eleven paired real direct/proxied echo requests measured median additional latency **329 microseconds**, below the unchanged **5,000-microsecond** gate. This is a local debug-build measurement, not an Internet latency promise. |

Source: `crates/egress-plane/src/{proxy,netns,tunnel,health,lib,main,config,crypto,db}.rs`,
`packages/api/src/routes/egress.ts`, and the corresponding regression tests.
`infra/Dockerfile.rust` includes `setpriv` via util-linux but does **not** grant
additional production privileges.

## Reproducible receipt and execution boundary

Run from the repository root:

```sh
rtk node scripts/rehearse-egress.mjs --isolated-fixture
```

The runner builds a source-only temporary Docker context. Build dependency
downloads use the build network; the actual tests run with `--network none`,
no host bind mounts, no Docker socket, no published ports and no live data or
provider credentials. Only generated keys/certificates and real local peer
servers are used. This is an actual Linux kernel test, not a simulated
namespace, but it still shares the Docker VM's kernel.

The disposable test container uses root for provisioning, drops the default
capability set, and adds only NET_ADMIN, SYS_ADMIN and SETPCAP. It also uses
no-new-privileges, an unconfined AppArmor profile, memory/CPU/PID limits and
tmpfs `/run`. **This elevated test configuration must not be copied into a
host-network production service.** Every spawned egress sidecar drops all
capabilities. Cleanup removes only the UUID-labelled test container and its
new temporary source directory; evidence and the built image are retained.

Final exact-source run: `b4fbc5a3-ad2c-407a-b8e5-4a7e47aae562`.

| Evidence | Value |
| --- | --- |
| Container image ID | `sha256:6c4c961a949ed7759110f87db927e9fa531dd9ec8a978ff088efaf48331f8e5a` |
| Cargo exit | `0` |
| Rust tests | **64 passed: 44 unit, 16 integration, 4 TLS/protocol; 0 ignored** |
| Named mandatory runtime tests missing | `0` |
| Copied source/recipe files re-hashed against checkout | `24`, all identical |
| Source manifest SHA-256 | `05ec8d4cde23481f65680b0648e98f105562e7f8119413738543fa26740aff06` |
| Runtime receipt SHA-256 | `40e728d22ca8c7673d9e8c1f6cc85127ea49204d17685234c866cae1f65e64c7` |
| Combined test output SHA-256 | `99a4b83f96e6219aa5078ac4dbda3ddf4ece2137d9014e9a952d0bb88842ec73` |

Full local artifacts are in ignored
`var/egress-rehearsal/b4fbc5a3-ad2c-407a-b8e5-4a7e47aae562/`.
The committed `egress-runtime-receipt.json` preserves the source-bound receipt.
The independent `egress-rehearsal` CI job repeats the runner and prints its
receipt, including failed verdicts, into the job output. It does not depend on
the unrelated JS matrix succeeding. A new hosted run is not implied by local
YAML or Docker success.

Other executed checks:

- `rtk cargo fmt --package egress-plane -- --check`: PASS.
- `rtk cargo clippy --locked --offline -p egress-plane --all-targets -- -D warnings`: PASS.
- Focused Vitest: **59/59** (API egress 31, API network 12, gateway egress 11,
  worker connection 5). Exact include paths excluded historical review copies;
  `envFile:false`; no live database/provider calls. These existing TS tests
  establish source contracts, not deployed process isolation.
- API and LLM-gateway `typecheck`: PASS. Their package `lint` commands exit 0
  with **221** and **16** warnings respectively; no claim of warning-free lint.
- Workflow YAML parse, `git diff --check`, and `sh scripts/verify.sh`: PASS.
- Windows cargo run: 55 tests pass, but it excludes Linux-only coverage and
  is not a substitute for the 64-test Linux receipt.

## Preserved failures, not erased or reclassified

`a81e30eb-21d5-4724-aee6-bf1a57104250` failed because test cleanup attempted to
unbind an already-drained model. The assertion was corrected, not the drain.

`281a52a6-ed39-4252-8975-308407439c48` failed the 5 ms performance gate at
9,529 microseconds. Repeated HTTP-client/trust-root construction was removed
by transport reuse; the threshold was not changed.

`b75f5e50-8596-4abd-a3fe-6b996cd4627c` passed performance at 420 microseconds
but failed the new IPv6 test because address-filtered `ip addr` output did not
contain a MAC address. The test now reads `ip -j link` explicitly.

`5ce1556d-5fb8-4235-984f-bad086f7c1f4` passed all 64 tests at 622 microseconds.
The final run above repeats this after documentation comments were corrected
to stop claiming that a sidecar also confines host-network Node callers.

## Remaining execution gates — do not mark F-02/F-04/F-43 complete

1. **Production privilege/provisioner topology (F-04).** The shipped image
   runs as UID 1001; CI's deployment smoke recipe grants NET_ADMIN only.
   `ip netns add/exec` requires additional namespace/mount privilege. The
   negative runtime test retains NET_ADMIN, removes SYS_ADMIN and proves
   namespace creation fails. Linux also documents the relevant
   [setns capability requirements](https://man7.org/linux/man-pages/man2/setns.2.html).
   Design and review a narrowly scoped provisioner/launcher, then test the
   actual deployment recipe as its real UID/capability set. Do not solve this
   by giving the whole service SYS_ADMIN, `--privileged`, or host networking.

2. **Caller confinement (F-04/F-43).** L2.6 requires connector/MCP/scraper work
   itself to be unable to bypass model egress. Current Node consumers use an
   injected proxy client, but remain capable of constructing a host-network
   socket. Implement a per-model execution boundary or equivalent mandatory
   OS policy, including control-plane exceptions. Acceptance must run the
   real worker/connector with its proxy setting deliberately omitted and
   prove a reachable external canary receives no traffic; then prove the
   intended model path works. A successful proxy request alone is insufficient.

3. **Explicit direct mode end to end (F-02/F-43).** The Rust direct bind and
   explicit API selection work, but persisted sync filters out direct rows;
   `resolveEgressProxy()` requires a nonempty sidecar address and worker
   connection helpers reject null. Implement an explicit, authorized direct
   result throughout this contract; never reinterpret missing/unhealthy as
   direct. Test isolated mode changes, persisted reload, and job dispatch in
   both directions, retaining no-fallback negative controls.

4. **Customer endpoint, DNS and deployed lifecycle (F-02/F-04/F-43).** The
   fixture's proxy/WG peer and echo are real but local to the test container.
   Prove a real controlled FQDN through the deployed WG resolver, route/NAT
   topology, authenticated HTTP/HTTPS/SOCKS proxy, credential rotation,
   restart, stale namespace recovery, and IPv4/IPv6 leak controls. The
   current veth implementation rejects IPv6-only upstream endpoints rather
   than silently substituting a route; supported endpoint policy must be
   explicit. This run does not prove generic non-WireGuard VPN compatibility.

5. **Persistence, tenant and failure workflow (F-02/F-43).** Exercise current
   migrations/RLS using an isolated production-shaped DB, two tenants and
   two models: save/import/decrypt/apply/health, credential rotation, deletion
   and restart. Verify DB health-write failures are not reported as current
   persisted health. Then prove actual job abort/backoff, repeated-failure
   Sev-1 creation and Relay pause action. The Rust monitor currently probes
   already-bound models; it does not itself implement that complete incident
   and queue workflow. No database was accessed or mutated by this rehearsal.

6. **Operator/deployment acceptance (all three).** After gates 1–5, use an
   explicitly approved test target, release digest, model/tenant, endpoint,
   backup and rollback procedure. Verify the real Network page's save/apply,
   health/latency/IP/drift and failure states, then the same real worker path
   before and after disruption. Keep production acceptance OPEN until that
   evidence is reviewed. No SSH, installer, live migration, grant, provider
   request, service restart or production firewall change occurred here.

The next implementation step is gates 1–2, not another UI localization pass,
an unrelated feature, or another Hermes protocol lane. Any deployment or
privileged host change needs the exact target and reviewed change scope;
this receipt does not grant that authority.
