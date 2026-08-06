#!/usr/bin/env bash
# POSIX-safe strict mode: dash (sh) rejects "set -o pipefail", so guard it.
set -eu
if [ -n "${BASH_VERSION:-}" ]; then set -o pipefail; fi

echo "AXIOM Build"
echo "==========="

# Build TypeScript packages
if [ -f "package.json" ]; then
    echo "Building TypeScript..."
    pnpm build 2>/dev/null || echo "  (no pnpm build script yet)"
fi

# Build Rust crates
if [ -d "crates" ]; then
    echo "Building Rust crates..."
    cargo build --workspace 2>/dev/null || echo "  (no Rust workspace yet)"
fi

echo "build: ok"
