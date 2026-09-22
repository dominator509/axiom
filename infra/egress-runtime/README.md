# AXIOM privileged egress runtime topology

These are deployment **artifacts**, not evidence that a host has installed or
activated them.  They split namespace administration from the egress control
plane and run outbound Node work in the already-provisioned model namespace.
They must be installed as one reviewed release with the matching
`egress-provisioner` and `worker-egress-dispatch` binaries; the repository does
not claim an installed or activated instance.

## Identities and authority

| Component | Identity | Authority |
| --- | --- | --- |
| `axiom-egress-provisioner` | `root` | Typed create, rotate, inspect and release operations for AXIOM-owned namespaces only.  Its capability bound is exactly `NET_ADMIN`, `SYS_ADMIN`, and `SETPCAP`. |
| `axiom-egress-plane` | `axiom-egress` | Authenticated control-plane requests and health probes; no ambient or bounding capabilities. |
| `axiom-egress-runner@<model>` | `axiom-egress-runner` | One bounded connector/MCP/scraper dispatch inside `/run/netns/egress_<model>`; no capabilities. |

The provisioner socket is local-only, group-readable by the control plane, and
never a TCP listener.  Its request protocol must reject arbitrary executable
paths, raw shell, namespace names, interfaces, routes, and provider URLs.  It
may derive these only from a validated model identifier and persisted approved
egress policy.  Credentials are accepted only in an encrypted or scoped
in-memory envelope and never logged or returned by inspection responses.

## Implemented provisioner protocol

The repository now emits the Rust `egress-provisioner` binary. It accepts only
a versioned, HMAC-signed, bounded-TTL create/inspect/release lease over its
local Unix socket. It derives the namespace solely from the signed model ID,
rejects direct mode and unsafe IDs, uses each valid nonce once, and creates a
closed IPv4/IPv6 namespace with blackhole defaults before returning `created`.
It does not accept a command line, path, route, interface, provider URL, or
raw namespace name. The socket service requires `AXIOM_EGRESS_LEASE_KEY` and
`AXIOM_EGRESS_CONTROL_UID` from the root-owned
`/etc/axiom/egress-provisioner.env` file.

`worker-egress-dispatch` is still not emitted. It remains a release gate, not
an optional command: it must accept only an already-authorized job envelope
from a Unix socket, not user arguments or a provider URL.

```
plane --local UDS--> provisioner --creates--> egress_<model> netns
worker queue --local UDS--> worker-egress-dispatch@<model> --joins--> egress_<model>
```

1. The provisioner validates the tenant/model/policy relationship and creates
   the namespace, default-deny rules, exact approved upstream path, sidecar,
   and namespace handle atomically. The current binary implements the signed
   lease, namespace derivation and closed-baseline portion; policy lookup,
   upstream attachment and sidecar lifecycle remain to be moved out of the
   unprivileged plane before activation.
2. It returns only a model-scoped opaque lease.  A failed probe removes the
   lease and runner start is refused.
3. The worker submits a bounded job envelope to the runner.  The runner never
   creates a host-network client and cannot select a namespace, executable,
   provider host, or proxy itself.
4. Release, credential rotation, stale namespace cleanup, and drain run
   through the provisioner.  The runner has no authority to alter its network.

## Acceptance required before activation

Run `node scripts/check-egress-runtime-units.mjs` in source review.  Before a
host activation, the approved non-production target must additionally prove:

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

Do not enable these units, grant capabilities, create users/groups, modify a
host firewall, or start a runner from this source checkout.  Those actions
require the approved target and release-specific operator change.
