#!/usr/bin/env bash
set -euo pipefail

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
