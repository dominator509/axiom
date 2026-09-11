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

Remaining integration requirements:

- Patch the pinned Grok resolver before every path, URL or data-URL branch;
  missing capability must fail closed. Pin and verify the resulting binary.
- Transfer the descriptor through the real launch/isolation chain, close it on
  cancellation and launch failure, and prevent inheritance by unrelated children.
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
```
