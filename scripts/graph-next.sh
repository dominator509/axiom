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

# Find the last completed phase (ledger lines are timestamped: "2026-07-29T17:53:00Z | DONE P0 - ...").
# Anchor on the pipe-delimited structure ("| DONE Px") so prose mentioning "DONE P0-P4" in later
# entries (e.g. an audit note) can never be mistaken for a phase marker.
LAST=$(grep -oE '\| DONE P[0-4]' "$LEDGER" 2>/dev/null | tail -1 | awk '{print $3}' || echo "")
case "$LAST" in
    "") echo "NEXT P0" ;;
    P0) echo "NEXT P1" ;;
    P1) echo "NEXT P2" ;;
    P2) echo "NEXT P3" ;;
    P3) echo "NEXT P4" ;;
    P4) echo "ALL_DONE" ;;
    *)  echo "BLOCKED $LAST" ;;
esac
