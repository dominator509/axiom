#!/usr/bin/env bash
# POSIX-safe strict mode: dash (sh) rejects "set -o pipefail", so guard it.
set -eu
if [ -n "${BASH_VERSION:-}" ]; then set -o pipefail; fi

LEDGER=".agent/state/LEDGER.md"
echo "AXIOM Verification Gate"
echo "======================="

# Check preflight while preserving its diagnostics for audit output.
PREFLIGHT_OUTPUT=$(sh scripts/preflight.sh 2>&1) || {
    printf '%s\n' "$PREFLIGHT_OUTPUT"
    echo "FAIL: preflight"
    exit 1
}
printf '%s\n' "$PREFLIGHT_OUTPUT"
if ! printf '%s\n' "$PREFLIGHT_OUTPUT" | grep -q "preflight: ok"; then
    echo "FAIL: preflight did not emit the required success marker"
    exit 1
fi
echo "  PASS: preflight"

# Check phases complete (ledger lines are timestamped: "… | DONE P0 - …"; anchor on the
# pipe-delimited structure so prose mentioning "DONE P0-P4" in audit entries can't false-positive)
for phase in P0 P1 P2 P3 P4; do
    if grep -q "| DONE $phase" "$LEDGER" 2>/dev/null; then
        echo "  PASS: $phase complete"
    else
        echo "  FAIL: $phase not complete"
        exit 1
    fi
done

# Check markers exist for completed phases
for phase in P0 P1 P2 P3 P4; do
    if grep -q "| DONE $phase" "$LEDGER" 2>/dev/null; then
        marker_dir=".agent/markers/L4.$(( ${phase#P} + 1 ))"
        set -- "$marker_dir"/*.done
        if [ -e "$1" ]; then marker_count=$#; else marker_count=0; fi
        if [ "$marker_count" -gt 0 ]; then
            echo "  PASS: $phase markers ($marker_count present)"
        else
            echo "  FAIL: $phase has no markers"
            exit 1
        fi
    fi
done

echo "verify: ok"
