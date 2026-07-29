#!/usr/bin/env bash
set -euo pipefail

echo "AXIOM FanvueCRM — Preflight Check"
echo "=================================="

MISSING=0

# Use real binary paths, not aliases (which may go through RTK)
check_cmd() {
    local bin=""
    # Try common locations
    for p in /usr/bin/$1 /usr/local/bin/$1 /root/.cargo/bin/$1 /root/.local/share/pnpm/$1 /root/.nvm/versions/node/*/bin/$1; do
        [ -x "$p" ] && bin="$p" && break
    done
    if [ -z "$bin" ]; then
        # fallback to command -v
        bin=$(command -v "$1" 2>/dev/null || true)
    fi
    if [ -z "$bin" ]; then
        echo "  MISSING: $1"
        MISSING=1
    else
        echo "  FOUND: $1 ($bin)"
    fi
}

check_cmd node
check_cmd pnpm
check_cmd rustc
check_cmd cargo
check_cmd git
check_cmd psql
check_cmd docker
check_cmd ufw

# Check blueprint pack
if [ -f "L0-governance/L0.0-governance-and-invariants.md" ]; then
    echo "  FOUND: Blueprint pack"
else
    echo "  MISSING: Blueprint pack"
    MISSING=1
fi

# Check .agent directories
mkdir -p .agent/execplans
for d in .agent/markers .agent/state .agent/execplans; do
    if [ -d "$d" ]; then
        echo "  FOUND: $d/"
    else
        echo "  MISSING: $d/"
        MISSING=1
    fi
done

if [ "$MISSING" -eq 0 ]; then
    echo "preflight: ok"
else
    echo "preflight: fail — missing items above"
    exit 1
fi
