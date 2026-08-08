#!/usr/bin/env bash
# POSIX-safe strict mode: dash (sh) rejects "set -o pipefail", so guard it.
set -eu
if [ -n "${BASH_VERSION:-}" ]; then set -o pipefail; fi

echo "AXIOM Build"
echo "==========="

# Build TypeScript packages
if [ -f "package.json" ]; then
    echo "Building TypeScript..."
    pnpm build
else
    echo "  SKIP: package.json not found"
fi

# Build Rust crates
if [ -d "crates" ]; then
    echo "Building Rust crates..."
    cargo build --workspace
else
    echo "  SKIP: crates/ not found"
fi

echo "build: ok"
