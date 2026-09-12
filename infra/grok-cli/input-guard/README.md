# Grok CLI source-image capability

This Linux-only library is an integration component, **not an enabled video
provider**. AXIOM still rejects video before launching Grok.

Trusted launch code supplies authorized image bytes to `seal_image`. Linux
seals prevent writes, growth and shrinkage; the finalized descriptor is not
inherited across exec by default. Patched CLI initialization must take ownership
of the explicitly transferred descriptor exactly once and construct one
`AuthorizedImage` per request. The model supplies only `axiom-input://image`.
`read_once` returns the bounded snapshot, never a path to reopen. Seal inspection
does not establish caller authorization: the launch chain must bind the
descriptor to the authenticated request's authorized source bytes.

Contract: [Linux memfd and file seals](https://man7.org/linux/man-pages/man2/memfd_create.2.html).
The separately locked libc dependency is the same version already used by the
application workspace. Hosted CI explicitly tests and audits this independent
CLI-build workspace; it is not silently excluded by the application's fixed
crate lists.

The launcher now reads an exact, bounded binary transfer from stdin, seals it,
and execs the fixed `/grok` target inside the existing bubblewrap boundary.
Descriptor 3 is reserved for this handoff. Early CLI initialization duplicates it
to a close-on-exec descriptor, closes the original, and caches success **or
failure** once per process. Later tool calls cannot reinitialize the capability
after descriptor reuse; forked processes cannot use the guard API.

`scripts/rehearse-grok-handoff.mjs --isolated-fixture` exercises the production
sandbox builder with a synthetic Rust probe, empty credentials, real bubblewrap
and exec. It covers valid transfer, descriptor collision/reuse, missing input,
child exec isolation, incorrect lengths, exec failure and killing a stalled
transfer. This is not an actual Grok resolver or OAuth/provider test. CI runs the
fixture with sudo because hosted Ubuntu can restrict user namespaces; a passing
CI fixture does not establish rootless production support.

The candidate source patch is documented in [the upstream integration notes](../README.md).
Remaining integration requirements:

- Compile and exercise the patched pinned Grok resolver; pin and verify the
  resulting binary. The candidate removes all path/URL/data-URL branches.
- Wire binary stdin and bounded cancellation into the production subscription
  runner. The isolated launcher fixture does not verify that runner's lifecycle.
- Preserve the guard across tool calls: re-creating it would reset single-use
  enforcement. This guard alone does not limit image-generation calls or prove
  exactly-once provider side effects.
- Decode the returned snapshot under image format, pixel-count and resource
  limits before provider upload. This library bounds bytes, not decoded pixels.
- Exercise actual CLI resolver, OAuth refresh, provider generation and complete
  asset/ToS/Relay lifecycle before removing the current 503 video gate.

Run on Linux:

```sh
cargo test --locked --manifest-path infra/grok-cli/input-guard/Cargo.toml
cargo clippy --locked --manifest-path infra/grok-cli/input-guard/Cargo.toml --all-targets -- -D warnings
cargo build --locked --manifest-path infra/grok-cli/input-guard/Cargo.toml --bins --examples
pnpm --filter @axiom/llm-gateway build
node scripts/rehearse-grok-handoff.mjs --isolated-fixture
```
