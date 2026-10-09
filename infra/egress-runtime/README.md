# AXIOM privileged egress runtime topology

These are deployment **artifacts**, not evidence that a host has installed or
activated them.  They split namespace administration from the egress control
plane and run outbound Node work in the already-provisioned model namespace.
They must be installed as one reviewed release with the matching
`egress-provisioner` binary and compiled worker package; the repository does
not claim an installed or activated instance.

## Identities and authority

| Component | Identity | Authority |
| --- | --- | --- |
| `axiom-egress-provisioner` | `root` | Typed namespace, veth, firewall, tunnel, sidecar, inspect and release operations for validated model IDs only. Its capability bound is exactly `NET_ADMIN`, `SYS_ADMIN`, and `SETPCAP`. |
| `axiom-egress-plane` | `axiom-egress` | Authenticated control-plane requests and health probes; no ambient or bounding capabilities. It resolves approved proxy/tunnel hostnames before signing a pinned IPv4 endpoint. |
| `axiom-egress-sidecar@<model>` | dynamic `axiom-egress-sidecar` | Unprivileged proxy listener inside one model namespace. It receives only that binding's short-lived encoded configuration and has no capabilities. |
| `axiom-egress-runner@<model>` | `axiom-egress-runner` | One bounded connector/MCP/scraper dispatch inside `/run/netns/egress_<model>`; no capabilities. |

The provisioner socket is local-only, group-readable by the control plane, and
never a TCP listener. Its request protocol rejects arbitrary executable paths,
raw shell, namespace names, interfaces, routes, and provider URLs. The root
process has only `AF_UNIX` and `AF_NETLINK`; it receives an already-resolved,
numeric IPv4 endpoint and cannot perform DNS or ordinary host-network
connections. It derives resource names only from a validated model identifier.
Credentials cross the local socket in a typed, HMAC-signed request and are
never logged or returned by inspection responses.

## Implemented provisioner protocol

The Rust `egress-provisioner` accepts versioned, HMAC-signed, bounded-TTL
`bind`, `inspect`, and `release` requests over its local Unix socket. It rejects
direct mode and unsafe IDs, uses each valid nonce once per process, creates a
default-deny namespace before bringing up its veth, installs only the signed
proxy or tunnel endpoint, and starts a model-scoped sidecar through systemd.
The persisted manifest at `/run/axiom/egress/provisioner-state.json` contains
only model IDs and is atomically written with private permissions. On restart,
the provisioner removes only resources derived from entries in that manifest;
an untracked namespace or veth collision causes a refusal instead of cleanup.

The root-owned `/etc/axiom/egress-provisioner.env` supplies
`AXIOM_EGRESS_LEASE_KEY` and `AXIOM_EGRESS_CONTROL_UID`. The plane reads the
same signing key through root-owned
`/etc/axiom/egress-provisioner-client.env`. Keep both files mode `0600`; the
plane's environment contains the key, while the sidecar unit never receives
it. The provisioner unit sets `AXIOM_EGRESS_RUNTIME_MODE=systemd` and the
installed sidecar executable path explicitly.

For proxy mode, the plane resolves the configured proxy once. The signed
binding carries its original host name for protocol/TLS behavior and its pinned
numeric address for firewall routing. For WireGuard/VPN, it signs the resolved
endpoint directly. The root service does not resolve hostnames. Before
starting the sidecar, it writes only that model's encoded configuration to a
root-only `/run/axiom/egress/sidecar-<model>.env`, starts the unprivileged
systemd instance in the named namespace, then removes the file. Sidecar output
and responses contain no proxy passwords or tunnel private keys.

The checked runner unit invokes the compiled worker entry directly, with a
model ID supplied by the systemd instance. It verifies that it is already in
the matching namespace before registering connectors, and its database claim
function can claim only that model's provider/scraper jobs. The global worker
uses the complementary non-egress claim function when confinement is required.
This is source-level enforcement only: the actual installed worker bundle,
systemd identity and namespace join still require target acceptance.

```
plane --signed local UDS--> provisioner --> closed egress_<model> netns
                                             |-- pinned proxy or WireGuard endpoint
                                             |-- sidecar@<model> in the same netns
worker@<model> --systemd NetworkNamespacePath--^
```

The egress plane does not install kernel state itself in production mode. It
accepts a bind only after the provisioner returns a matching request ID,
namespace, mode, default-deny state, veth, and pinned endpoint. Failed or
uncertain binds trigger a release attempt; when release cannot be confirmed,
the subnet remains reserved for reconciliation. Replacing or releasing a
binding stops the model runner and sidecar before deleting its veth and
namespace. The runner never creates a namespace or alters its network. It
verifies the namespace selected by systemd and claims only relationally-derived
work for that model. Shared helper-based egress fetches reject non-runner
callers when required confinement is enabled.

## Acceptance required before activation

Run `node scripts/check-egress-runtime-units.mjs` for source-level unit checks
and `node scripts/rehearse-egress.mjs --isolated-fixture` for the disposable
Docker lifecycle rehearsal. Before activation on an owner or production host,
the approved non-production target must additionally prove:

- effective `systemd-analyze security` and `systemctl show` values match these
  units; the plane and runner have empty capability sets;
- the provisioner accepts a valid typed request and rejects a malformed model,
  cross-tenant model, arbitrary path, route and namespace request;
- a real connector, MCP call and scraper run through a runner with its proxy
  deliberately omitted; an external canary receives zero traffic on that
  negative path and receives the expected model egress on the positive path;
- WireGuard/proxy/DNS/rotation/restart/IPv4/IPv6 tests, two-tenant persistence
  and queue/Sev-1/Relay tests, plus browser Network-page acceptance all have
  reviewed receipts.

The Docker rehearsal runs in its own labeled container with networking
disabled and test-only capabilities; it does not start the existing development
Compose stack or change the host firewall. Do not enable these units, grant
capabilities, create users/groups, or start a runner on an owner or production
host from this source checkout. Those actions require the approved target and
release-specific operator change.
