#!/usr/bin/env bash
# POSIX-safe strict mode: dash (sh) rejects "set -o pipefail", so guard it.
set -eu
if [ -n "${BASH_VERSION:-}" ]; then set -o pipefail; fi

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
