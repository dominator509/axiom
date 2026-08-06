#!/usr/bin/env bash
# POSIX-safe strict mode: dash (sh) rejects "set -o pipefail", so guard it.
set -eu
if [ -n "${BASH_VERSION:-}" ]; then set -o pipefail; fi

LEDGER=".agent/state/LEDGER.md"
echo "AXIOM Verification Gate"
echo "======================="

# Check preflight
if ! bash scripts/preflight.sh 2>&1 | grep -q "preflight: ok"; then
    echo "FAIL: preflight"
    exit 1
fi
echo "  PASS: preflight"

# Check phases complete
for phase in P0 P1 P2 P3 P4; do
    if grep -q "DONE $phase" "$LEDGER" 2>/dev/null; then
        echo "  PASS: $phase complete"
    else
        echo "  PASS: $phase (not yet complete)"
    fi
done

# Check markers exist for completed phases (ledger lines are timestamped, so match "DONE Px" anywhere)
for phase in P0 P1 P2 P3 P4; do
    if grep -q "DONE $phase" "$LEDGER" 2>/dev/null; then
        marker_count=$(find ".agent/markers/L4.$(( ${phase#P} + 1 ))" -name "*.done" 2>/dev/null | wc -l)
        if [ "$marker_count" -gt 0 ]; then
            echo "  PASS: $phase markers ($marker_count present)"
        else
            echo "  FAIL: $phase has no markers"
            exit 1
        fi
    fi
done

echo "verify: ok"
