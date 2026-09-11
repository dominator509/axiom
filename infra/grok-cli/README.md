# Grok OAuth media CLI integration (not enabled)

The source-image patch targets exactly `xai-org/grok-build` commit
`37949780c144e37df692e3d669051a21fec24f20`. It is a candidate patch, not a
verified distributable CLI. AXIOM continues to reject video generation with 503
before launching a provider process.

## Source layout and patch

The patch expects the upstream checkout at `var/grok-source-37949780` under the
AXIOM repository. Its two relative Cargo dependencies point back to
`infra/grok-cli/input-guard`. Apply only to a clean checkout of the exact commit:

```sh
git -C var/grok-source-37949780 rev-parse HEAD
git -C var/grok-source-37949780 apply --check ../../infra/grok-cli/37949780-sealed-input.patch
git -C var/grok-source-37949780 apply ../../infra/grok-cli/37949780-sealed-input.patch
```

The patch initializes the inherited capability before CLI runtime setup and
replaces the image-to-video resolver's file, HTTPS and data-URL handling with
`read_inherited_image`. Missing capability fails closed; model input can only
name `axiom-input://image`. Existing full image validation then runs on the
snapshot. It still needs explicit decoded-image resource bounds.

This is a dedicated single-image AXIOM binary, not a drop-in upstream CLI:
`reference_to_video` shares this resolver and multiple image references will
fail on the second read. Filesystem, HTTPS and data-URL references are deliberately
unsupported. Do not advertise upstream multi-image behavior for this build.

Upstream is Apache-2.0 licensed. Any modified binary distribution must retain
applicable upstream license/notices and identify modifications. This repository
does not currently build or distribute that modified upstream binary.

## Evidence and remaining boundary

The patch's reverse applicability was checked against the modified pinned
checkout. The local upstream compile attempt did **not** reach compilation:
crates.io dependency downloads failed with TLS errors. No TLS verification was
disabled. The changed upstream dependency lock, full CLI build, binary digest
and actual resolver execution remain unverified. The upstream toolchain pin is
1.94.0; the unsuccessful WSL check used 1.96.0, not an equivalent release proof.
A subsequent disposable Docker attempt uses the upstream 1.94.0 pin; it is still
fetching dependencies at this milestone and supplies no completed build evidence.

The separately locked input guard and real Linux launch/exec fixture are tested
independently. They do not establish OAuth refresh, tenant/source authorization,
provider spending/outcome handling, or the asset/ToS/Relay lifecycle. In
particular, no caller currently supplies the new sandbox `imageLauncher` option
from the production generation path. Do not remove the video gate based on the
synthetic fixture or green application CI.
