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
git -C var/grok-source-37949780 apply --check ../../infra/grok-cli/37949780-sealed-input-lock.patch
git -C var/grok-source-37949780 apply ../../infra/grok-cli/37949780-sealed-input-lock.patch
```

The companion lock patch records Cargo's resolved graph, including the guard,
libc 0.2.189, and reconciled dependency edges from the published upstream lock.
It is intentionally separate from the resolver code patch. Subsequent checks
must use `--locked`; do not silently re-resolve it as part of a release build.

## Isolated build tooling

`Dockerfile.build` is an x86_64 Linux build environment, not a deployment image.
It uses the upstream Rust 1.94.0 pin and protoc 29.3 archive/checksum from the
pinned `bin/protoc`. The supported `PROTOC` override avoids dependence on the
dotslash launcher or host checkout line endings. Debian build packages remain
repository-resolved; this is not yet a bit-for-bit reproducible release recipe.

```sh
docker build -f infra/grok-cli/Dockerfile.build -t axiom-grok-build:local infra/grok-cli
```

Mount only the pinned patched source at `/axiom/var/grok-source-37949780` and
the guard read-only at `/axiom/infra/grok-cli/input-guard`. Keep build output at
`/build-target` and dependency cache separate from any user credential store.
The default command checks `xai-grok-tools --locked`; it does not link the CLI
binary, perform login, or call a provider. Never mount the application root or
any real credential directory into this build container.

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
checkout. The initial WSL attempt failed during dependency downloads with TLS
errors. No TLS verification was disabled. A subsequent Docker attempt using
upstream Rust 1.94.0 reached compilation, then failed on missing protoc (and the
CRLF dotslash wrapper). The build tooling above addresses that prerequisite;
the full CLI build, binary digest and actual resolver execution remain unverified.
The final tooling image built successfully as
`sha256:3ac685f0b531aa9ccb7c23c787bac090c4e587d07be3aaad2264cd930f212922`.
The read-only-source `--locked` check is still running with isolated caches;
download retries are not a completed build result.

The separately locked input guard and real Linux launch/exec fixture are tested
independently. They do not establish OAuth refresh, tenant/source authorization,
provider spending/outcome handling, or the asset/ToS/Relay lifecycle. In
particular, no caller currently supplies the new sandbox `imageLauncher` option
from the production generation path. Do not remove the video gate based on the
synthetic fixture or green application CI.
