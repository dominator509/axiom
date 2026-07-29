#!/usr/bin/env bash
set -euo pipefail

echo "AXIOM FanvueCRM — Preflight Check"
echo "=================================="

# Check required tooling
MISSING=0

check_cmd() {
    if ! command -v "$1" &>/dev/null; then
        echo "  MISSING: $1"
        MISSING=1
    else
        echo "  FOUND: $1 ($(command -v "$1"))"
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

# Check .agent directory
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
