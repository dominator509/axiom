# Grok OAuth media CLI integration (live acceptance pending)

The source-image patch targets exactly `xai-org/grok-build` commit
`37949780c144e37df692e3d669051a21fec24f20`. It is a candidate patch, not a
verified distributable CLI. Video transport now requires explicit installation
configuration: `AXIOM_GROK_VIDEO_CLI` must name this dedicated patched executable
and `AXIOM_GROK_IMAGE_LAUNCHER` the built sealed-input launcher, both absolute
Linux paths. Missing configuration returns 503; there is no stock-CLI fallback.
Transport wiring tests are not evidence of a real generated video.
Set `AXIOM_GROK_CLI` to the same patched executable for login, status, image
generation and text operations; otherwise those operations use the stock path.

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
git -C var/grok-source-37949780 apply --check ../../infra/grok-cli/37949780-bounded-image.patch
git -C var/grok-source-37949780 apply ../../infra/grok-cli/37949780-bounded-image.patch
```

The companion lock patch records Cargo's resolved graph, including the guard,
libc 0.2.189, and reconciled dependency edges from the published upstream lock.
It is intentionally separate from the resolver code patch. Subsequent checks
must use `--locked`; do not silently re-resolve it as part of a release build.

## Isolated build tooling

`Dockerfile.build` is an x86_64 Linux build environment, not a deployment image.

The installed runtime is currently a Linux host installation, not a verified
production worker-container integration. The worker runner image is Alpine;
the patched CLI build is glibc-based and also requires the bubblewrap sandbox.
Do not assume that copying the binary into that image is sufficient. Deployment
must provide the verified runtime/launcher and sandbox, the per-user credential
home, and the same private media directory to worker, API, media plane and vision
engine (read-only for API/vision where practical, compatible service UIDs).
The development Compose file currently mounts its media volume only into the
media and vision sidecars. End-to-end container generation is still unverified.

Media job dispatch is committed only after local transport preparation succeeds,
immediately before the subprocess launch. Missing credentials or sandbox setup
does not create an uncertain paid-attempt marker. Once committed, that marker
still prevents automatic repetition after an unknown provider outcome.
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
snapshot. The separate bounded-image candidate patch adds an AXIOM-only
validator without changing the generic upstream validator. It accepts static
PNG/JPEG up to 20 MiB encoded, 8,192 pixels per side and 16,000,000 pixels total,
with a 256 MiB best-effort decoder allocation budget. These are application
policy, not provider limits or a process-wide memory/CPU guarantee. Animated
PNG and trailing bytes after PNG IEND are rejected; bytes are not silently
normalized. Full corruption validation remains required after the bounded
header probe. The actual patched `xai-grok-image` crate compiled and passed all
46 tests, including six AXIOM-specific regressions for valid bit depths,
dimension/pixel boundaries, allocation exhaustion, corruption, unsupported
formats and PNG animation/trailing bytes. Independent review identified a
remaining JPEG Extended XMP CPU-amplification path before decoder dimension
limits. An offline, one-CPU, 512 MiB, 15-second-bounded reproducer against the
actual tested library confirmed acceptance of repeated empty Extended XMP
segments: 1,000/2,000/4,000 segments took approximately 106/318/1,234 ms for
80/159/317 kB inputs, versus under 1 ms for the ordinary JPEG. These are local
debug-build observations, not production performance guarantees. The candidate
now includes a linear JPEG marker prevalidation before decoder construction,
limiting APP/comment metadata to 512 segments and 2 MiB across all scans. The
repeated-XMP regression now fails before decoder reassembly, while ordinary
JPEG remains accepted; all 47 actual image-crate tests pass. Full CLI and
deployment verification remain open.

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
these were historical build failures, not the current build result.
The initial tooling image built successfully as
`sha256:3ac685f0b531aa9ccb7c23c787bac090c4e587d07be3aaad2264cd930f212922`.
The read-only-source `cargo check --locked -p xai-grok-tools` completed
successfully in 19m14s. This verifies compilation of the patched resolver and
guard, not execution. The separate `cargo build --locked -p xai-grok-pager-bin
--bin xai-grok-pager` subsequently completed in 12m18s after the corrections below.

The first full-binary build failed with compiler output I/O errors after the
Windows C: volume filled. Only its disposable compiler-output directory was
removed; source, dependency cache, credentials and database data were preserved.
The retry uses the same read-only source and locked dependencies, with compiler
output on `F:/AXIOM-build-cache/grok-37949780-20260911`. This is a local build
location, not a deployment prerequisite. That retry
subsequently failed because jemalloc invokes `make`, which was absent. The
build recipe now installs it explicitly; the updated tooling image built
successfully. After the image-validator tests passed, the full CLI build was
restarted with the updated tooling and bounded-image candidate.

Hosted run `34607243164` completed successfully for AXIOM commit
`8523c594b7f4515da6a613bd2e35b263306a813a`: test, security, build, container,
typecheck and lint all passed, including the real Linux synthetic handoff
fixture. PR #14 remains open with review required. These application checks do
not build the patched upstream CLI or verify a live OAuth media generation.

Completion subprocess cancellation now targets the owned POSIX process group
or Windows process tree, and waits for confirmed closure before prompt cleanup.
If termination cannot be confirmed within the deadline, it reports 503 and
retains the prompt. Tests exercise a real wrapper/native-child pair on both
platforms. This is not a hostile-native-code sandbox: subprocesses deliberately
escaping the owned process group require stronger OS containment. Grok media
still requires bubblewrap, and remote provider cancellation is not implied.
The separate OAuth login command lifecycle and artifact-retention policy remain
outside this completion-runner change.

The separately locked input guard and real Linux launch/exec fixture are tested
independently. They do not establish OAuth refresh, tenant/source authorization,
provider spending/outcome handling, or the asset/ToS/Relay lifecycle. In
particular, the transport now supplies the sandbox `imageLauncher` option,
copies the authorized input buffer, transfers it through stdin and exposes
only `axiom-input://image` in the prompt. No source-image file is created.
All 323 gateway tests and typechecking pass, including image/video command
wiring. The installed binary must include all three patches above; the stock
upstream CLI is not safe for this configuration. The earlier full binary was
observed on disk and ran `--version` successfully offline as 1.0.24; a rebuild
including JPEG metadata bounds completed successfully in 12m18s. The final
binary starts offline as 1.0.24 and rejects missing sealed input before runtime
startup. These smoke checks used no credentials or network access. API/asset/ToS/worker integration,
authenticated real generation remain unverified.

## Local runtime and frame-scan evidence (2026-09-11)

The final CLI SHA-256 is
`5d9f09f7406253d1397a0dcbc963ac4dff90df72988efc6ec36fe712e600f638`.
The freshly built Linux launcher SHA-256 is
`0e5555e9814495d3af920478b662e7c0ac63ddd10d841782ef088d5ee423f722`.
Both were installed into a private versioned WSL directory using
`scripts/install-grok-runtime.sh`. The installer refuses an existing destination
and checks the supplied CLI hash before installing; it does not access credentials.
`scripts/rehearse-grok-installed-runtime.mjs` passed for both the actual CLI and
the actual launcher/CLI pair inside bubblewrap with networking disabled and an
empty credential directory. This proves startup and sealed transfer, not execution
of the provider's media tool or OAuth authentication. Node 22.23.2 is now
installed in a private AXIOM WSL runtime directory. The initial nvm binary
download failed with a TLS record error; a Windows download from the official
Node release site was checked against its SHA-256 list before installation by
`scripts/install-node-runtime.sh`. No TLS verification was disabled and system
Node defaults were not replaced. The current compiled API imports successfully
under this Node 22 runtime with an empty credential environment. This import
check is not an authenticated server/database readiness check.

The media plane now exposes authenticated `POST /media/video/frames` for MP4
clips up to 12 seconds/256 MiB/16 million pixels. A private snapshot is hashed,
probed and decoded with deadlines, restricted protocols and one concurrent
extraction. Its versioned policy samples at 2fps into bounded 512-pixel PNGs.
Complete frame sets are retained under `var/media/tos-video-v1/<source-hash>`
for audit/retries; retention/garbage collection remains an operational requirement.
The worker verifies source hash/coverage and classifies every returned frame.
Any block survives aggregation; otherwise sampled videos require human review
of the full video and audio. This is not full-frame or audio classification.
The filter follows the [official FFmpeg fps documentation](https://ffmpeg.org/ffmpeg-filters.html#fps).

Executed evidence: real FFmpeg 6s/10s fixtures produced 12/20 decodable frames,
cache reuse passed and corrupt MP4 was rejected. Eleven Rust unit tests and
Clippy with warnings denied passed; the real FFmpeg test is explicitly invoked
with `cargo test -p media-plane real_ffmpeg_short_clip_coverage_and_cache -- --ignored`.
Worker ToS/media generation tests passed 30, API generation tests 12, dashboard
form tests 7 and subscription lifecycle tests 32 (with Windows process-control
permission). The image aspect ratio now reaches the worker/provider request.
These are not live vision-model, browser approval, migrated database or real
Grok generation acceptance results. No real credential has been connected yet.

The frame inference boundary was subsequently exercised with the pinned real
ONNX model in `axiom-vision-engine:rehearsal-45f96d5`: all 12 frames of the 6s
fixture and all 20 frames of the 10s fixture passed inference-contract checks
through both classification endpoints, without overrides, in network-disabled
containers. This proves model execution, not classifier accuracy or the final
worker/database/dashboard journey. Invoke `scripts/rehearse-vision.mjs
--isolated-fixture <fixture-source-sha256>` after the real FFmpeg test to repeat
it. Current API dependency builds passed. The worker's authorized roles now
match the API (`owner`, `manager`, `operator`); all eight media-worker tests pass.

## Recovered local database boundary

The existing `axiom-recovery-postgres` container was stopped. Its persisted
volume and loopback port matched the saved application connection; starting
that same container restored access without replacing credentials or data.
The local runtime account is neither superuser nor BYPASSRLS. The scoped
`scripts/start-local-grok-api.mjs` launcher brings up the existing API using
DB/auth/Grok configuration only; unrelated social adapters and workers remain
stopped. The actual dashboard sign-in page was rendered in the browser.

Read-only inventory via `scripts/check-local-runtime.mjs --schema-shape` checked
47 current schema tables. The recovered DB lacks `mcp_token_revocation`,
`media_generation_attempt`, `consent_record.org_id` and
`content_bundle.publish_intent`. The migration checksum ledger is absent.
`--migration-contracts` additionally found the old `claim_job` body does not
match 0018, `load_model_network_configs` is absent, and the expected consent,
viral-exemplar and pending-relay identity indexes are absent. Existing resolver
functions do revoke PUBLIC execution and have BYPASSRLS owners; authentication
tables grant the runtime role all four required CRUD operations. No configured
`MIGRATOR_DATABASE_URL` is present. This is evidence of an upgrade gap, not
permission to infer a baseline or blindly replay the historical migration set.
Back up and rehearse the upgrade against a copy before mutating this database.

`scripts/rehearse-media-attempt.mjs --isolated-fixture` passed the new 0025
migration's actual PostgreSQL forced-RLS, cross-tenant access, protected dispatch
fields, duplicate suppression, rollback persistence and completion-update
contracts in a fresh disposable DB. It supplies only the org foreign-key
prerequisite, so it does not establish a successful full recovered-schema
upgrade. Its disposable DB was removed; the recovered schema was unchanged.

The recovered source was subsequently backed up through existing owner socket
access, with a checksum-verified owner-only copy preserved outside the container.
`scripts/rehearse-recovery-upgrade.mjs --restore-copy` restored that archive into
an access-restricted new database: 45 public tables, 394 rows, application-role
CONNECT denied. `scripts/upgrade-recovery-copy.mjs --rehearsal-copy` applied
0014–0025 on that copy only. All 12 migrations passed, preserving existing table
row counts and satisfying consent backfill, identity-index and dispatch-RLS
checks. This does not establish value-by-value preservation, complete schema
conformance, or a valid historical checksum baseline. The original recovered
database has not been upgraded; the private rehearsal copy is retained.

`scripts/compare-recovery-schema.mjs --rehearsal-copy` subsequently built a
fresh reference from all 26 migrations in the labeled CI fixture and compared
`scripts/schema-contract.sql` metadata. No differences remained in 47 table RLS
flags, 468 exact column types/defaults/nullability definitions, 135 indexes,
163 constraints, 42 policies, four application function bodies/security
properties, table grants or per-column update grants. Enum, view and
non-internal-trigger sets were also equal (empty). Temporary reference DBs were
removed. Extension-owned functions/internal schemas and data-value fingerprints
are outside this comparison; it is not a live workflow or production readiness
claim. The original recovery database was unchanged at this checkpoint.

## Guarded recovery cutover completed locally

`scripts/guarded-recovery-upgrade.mjs` was rehearsed on a fresh restored copy,
then run against the configured original recovery DB. It captures fingerprints
of every existing table's original column values under write-blocking locks,
applies 0014–0025 in one transaction, verifies metadata against the reconciled
reference and validates data preservation/consent backfill before recording all
26 migration checksums and committing. The first copy attempt rolled back due
to a verifier record-variable collision; the corrected copy and original runs
passed. Post-commit read-only inventory found no missing current tables/columns;
the runtime role remains neither superuser nor BYPASSRLS. Backups are retained.

Migration files are now pinned LF in `.gitattributes`. Fourteen Windows checkout
files were mechanically normalized to their existing Git blob bytes before the
original baseline was recorded; no historical SQL content changed. This keeps
the existing byte-based checksum algorithm portable to Linux checkouts.
The earlier rehearsal copy contains pre-normalization checksums and must not
be used as a deployment baseline. Publishing workers remain stopped and real
Grok authorization/generation/dashboard approval acceptance is still pending.

### Temporary phone access

The scoped Linux launcher accepts one optional exact HTTPS Microsoft Dev
Tunnels origin. Omit it for loopback-only login configuration. Wildcards,
credentials, ports, non-root paths, query strings and fragments are rejected
before URL normalization. `node scripts/test-local-grok-origin.mjs` exercises
this boundary without loading credentials or starting the API.

Set the dashboard server's `BETTER_AUTH_URL` to that same exact public origin
when behind the tunnel. Its authentication middleware uses this configured
origin for redirects instead of the internal loopback request URL. Caller
`Host` or `X-Forwarded-Host` headers must not become configuration authority.

This argument does not create a tunnel or grant access. Remote operation
requires explicit operator consent to transit login/session traffic through
Microsoft, an owner-only tunnel ACL, and a bounded tunnel lifetime. Preserve
the caller's Origin header and configure the exact tunnel URL; never use
anonymous access or a wildcard trusted origin. Serve the built dashboard,
keep both local listeners on loopback, and leave publishing workers stopped.
GitHub tunnel authentication is separate from AXIOM and Grok authentication.

For explicitly authorized first-time local onboarding, set
`AXIOM_ENABLE_LOCAL_SIGNUP=1` on the dashboard server to show the account
creation toggle on `/login`. It uses the existing Better Auth signup API;
it does not assign an organization or elevate a role. This is a UI switch,
not an API signup authorization control. Keep the private tunnel owner-only.
The user chooses their password privately; the operator then assigns the
verified new identity to an appropriate isolated workspace. Do not grant
access to recovered tenants merely to connect Grok. Once assigned, visit
`/connections/grok` to connect without creating a model or generating media.
Omit the switch after onboarding to hide the first-time UI again.

### Full CLI advisory assessment (2026-09-11, incomplete)

AXIOM's root/guard audit does not cover the pinned upstream CLI lockfile.
An explicit audit of that lockfile (1,347 dependencies) reported three
vulnerability advisories plus 20 maintenance/unsoundness warnings. Registry
yank checks also timed out; this was not a completed clean scan.

- `quick-xml 0.39.4`: RUSTSEC-2026-0194 and RUSTSEC-2026-0195. The lockfile's
  consumer is `wayland-scanner 0.31.10`; the direct Grok tools dependency is
  already `quick-xml 0.41.0`. Downloaded scanner source uses a plain `Reader`
  in compile-time procedural macros opening protocol files, not `NsReader`
  or a generated-media input. This distinguishes build-input exposure from
  runtime media exposure; it does not waive the duplicate-attribute advisory.
  [Namespace advisory](https://rustsec.org/advisories/RUSTSEC-2026-0195)
  explicitly distinguishes plain readers from namespace resolution.
- `rsa 0.9.10`: RUSTSEC-2023-0071 concerns observable private-key operations.
  The login crate's direct RSA dependency is test-only, but `jsonwebtoken`
  also selects RSA through its crypto provider. Inspected production OIDC
  code verifies provider signatures using public keys. This is not proof
  that every selected runtime path is unaffected.
  [RSA advisory](https://rustsec.org/advisories/RUSTSEC-2023-0071).

The selected Linux `xai-grok-pager-bin` dependency-tree checks completed with
`--locked --offline --edges normal,build` in the existing M94 build image.
They confirm the old XML version enters through the Wayland scanner procedural
macro and clipboard dependencies. RSA remains selected through `jsonwebtoken`
by both `xai-grok-login` and `gcloud-auth`/`gcloud-storage`/`xai-file-utils`;
it cannot be dismissed as a test-only dependency. This graph establishes
selection, not exploitability of private-key operations in the deployed mode.
The remaining unsoundness warnings, runtime call-path assessment and any
necessary upgrades/rebuilds remain open. No advisory suppression or installed
binary replacement has been made on the strength of this assessment.

### XML dependency candidate verified (2026-09-11)

The companion lock patch now selects `wayland-scanner 0.31.11`, removing the
last `quick-xml 0.39.4` copy and retaining `quick-xml 0.41.0`. A precise Cargo
update preview and offline update agreed on that change. Review of the patch
delta found only the scanner version/checksum, old XML removal, unambiguous XML
dependency names, and resulting hunk offsets; existing sealed-input changes
were preserved. Reverse patch applicability and whitespace checks pass.

The complete patched CLI built with `cargo build --locked --offline -p
xai-grok-pager-bin --bin xai-grok-pager` in 7m53s. Its candidate SHA-256 is
`649c1a79d457a1fcf909195a45de63772d9da71b3ec120e3b1f99e2758f9c0e0`;
it reports version 1.0.24 in a read-only, network-disabled container without
credential mounts. **This candidate is not installed.** The installed binary
and hashes documented above remain unchanged.

`cargo test -p wayland-scanner` from the Grok workspace cannot run that external
crate's dev-dependencies. Running `cargo test --locked --offline` in the
published scanner crate instead passes all five parsing/client/server/interface
tests once Rust 1.94.0's `rustfmt` component is added to the disposable test
container. One upstream documentation test remains ignored. The original three
test failures were missing-formatter failures; no test was weakened or skipped
to obtain the five passes.

A refreshed `cargo audit --file var/grok-source-37949780/Cargo.lock --no-yanked
--json` against advisory DB commit `b50980aad8b8f14f77e25a97b32dd94bf008b0af`
reports neither XML advisory for the candidate's 1,346 dependencies. It still
exits 1 for RSA RUSTSEC-2023-0071 and reports ten unmaintained plus ten unsoundness
warnings. This focused check excludes registry-yank verification and is not a
clean full CLI security gate. No advisory exceptions were added. No account
login, runtime replacement, or provider generation was performed for this work.
