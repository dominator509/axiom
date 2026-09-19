#!/usr/bin/env bash
# POSIX-safe strict mode: dash (sh) rejects "set -o pipefail", so guard it.
set -eu
if [ -n "${BASH_VERSION:-}" ]; then set -o pipefail; fi

# Read the ledger to find next phase
LEDGER=".agent/state/LEDGER.md"
if [ ! -f "$LEDGER" ]; then
    echo "NEXT P0"
    exit 0
fi

# A later phase entry cannot stand in for missing prerequisites. Match exact
# phase tokens, not prefixes (P00) or prose ranges (P0-P4).
for phase in P0 P1 P2 P3 P4; do
    if ! grep -qE "\| DONE $phase([[:space:]]|$)" "$LEDGER"; then
        echo "NEXT $phase"
        exit 0
    fi
done
echo "ALL_DONE"
