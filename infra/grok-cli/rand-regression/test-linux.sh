#!/bin/sh
# Test-only syscall backend: libc may service entropy without a syscall.
# Never apply these compiler flags to the production CLI build.
set -eu
cd "$(dirname "$0")"
cargo test --locked "$@"
RUSTFLAGS='--cfg getrandom_backend="linux_raw"' cargo test --locked --features entropy-fault-injection "$@"
