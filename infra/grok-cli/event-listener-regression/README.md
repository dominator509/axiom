# Event-listener security regression

This standalone test-only package covers RUSTSEC-2026-0221. It is not linked
into AXIOM or the distributed Grok CLI. The normal manifest pins the patched
5.4.2 release; `baseline/Cargo.toml` deliberately pins vulnerable 5.4.1 solely
to demonstrate that the negative tests detect the original defect.

Run the patched gate (also wired into the CI test job):

```sh
cargo test --locked --manifest-path infra/grok-cli/event-listener-regression/Cargo.toml
```

Three unit tests preserve same-thread non-Send tags, cross-thread unit
notifications, and Send-but-not-Sync tag compatibility. Three compile-fail
doctests reject Send/Sync for `StackSlot<Rc<_>>` and transfer through the public
`listener!` macro. These tests do not invoke undefined behavior at runtime.

For the negative control only:

```sh
cargo test --locked --manifest-path infra/grok-cli/event-listener-regression/baseline/Cargo.toml --doc
```

The baseline must fail all three doctests specifically because forbidden code
compiled successfully. A download, compiler setup, or unrelated build error is
not evidence of reproduction. Do not substitute the baseline for the CI gate
or treat its vulnerable dependency as a production dependency or advisory waiver.

Both outcomes were verified on Windows. The actual Grok normalization-cache
compatibility run also passed all 14 tests offline on Linux after adding the
test-only missing Base64 trait import to the upstream test harness. This is
consumer compatibility evidence, not proof of a rebuilt or deployed CLI or
successful authenticated media generation.
