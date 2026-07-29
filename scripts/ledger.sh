#!/usr/bin/env bash
set -euo pipefail

LEDGER=".agent/state/LEDGER.md"

case "${1:-}" in
    append)
        echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) | $2" >> "$LEDGER"
        ;;
    tail)
        tail -n "${2:-30}" "$LEDGER" 2>/dev/null || echo "(empty ledger)"
        ;;
    *)
        cat "$LEDGER" 2>/dev/null || echo "(empty ledger)"
        ;;
esac
