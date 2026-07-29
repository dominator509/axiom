#!/usr/bin/env bash
set -euo pipefail

LEDGER=".agent/state/LEDGER.md"
echo "AXIOM Verification Gate"
echo "======================="

# Check preflight
if ! sh scripts/preflight.sh 2>&1 | grep -q "preflight: ok"; then
    echo "FAIL: preflight"
    exit 1
fi
echo "  PASS: preflight"

# Check phases complete
for phase in P0 P1 P2 P3 P4; do
    if grep -q "^DONE $phase" "$LEDGER" 2>/dev/null; then
        echo "  PASS: $phase complete"
    else
        echo "  PASS: $phase (not yet complete)"
    fi
done

# Check markers exist for completed phases
for phase in P0 P1 P2 P3 P4; do
    if grep -q "^DONE $phase" "$LEDGER" 2>/dev/null; then
        marker_count=$(find ".agent/markers/L4.${phase#P}" -name "*.done" 2>/dev/null | wc -l)
        if [ "$marker_count" -gt 0 ]; then
            echo "  PASS: $phase markers ($marker_count present)"
        else
            echo "  FAIL: $phase has no markers"
            exit 1
        fi
    fi
done

echo "verify: ok"
